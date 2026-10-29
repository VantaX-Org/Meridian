"""OIDC single sign-on: the public sign-in flow and the administrator's configuration.

Public (no session): GET /api/v1/auth/oidc/config, /start, /callback.
Admin (manage_users): GET/PUT/DELETE /api/v1/admin/sso and POST /api/v1/admin/sso/test.

Flow: /start stores state, nonce and the PKCE verifier in a signed, httponly, 10-minute cookie bound to the
browser and redirects to the IdP. /callback compares state in constant time, redeems the code, verifies the
id_token (api/services/oidc.py), maps the identity to a user (external_subject, else email), and issues the same
session as password login. A new person is provisioned only when their email domain is allowed, with the
tenant's default role (viewer) and no grants, so SSO never widens access. The browser lands on /sign-in with the
session token in the URL fragment (never sent to a server, never logged); the page stores it and continues.

The redirect URI is built from the deployment's configured base URL (MERIDIAN_APP_URL / SERVER_DOMAIN), never
from the request. The IdP-side `error` text and tokens are never echoed or logged; failures redirect to /sign-in
with a short code the page turns into a sentence.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from urllib.parse import urlencode

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from api.deps import Tenant, get_db, get_sync_engine_or_create, get_tenant
from api.middleware.licence import get_cached_manifest
from api.routes.auth import DEV_TENANT_ID, _set_auth_cookie, cookie_secure
from api.services import oidc
from api.services.crypto import decrypt_api_key, encrypt_api_key
from api.services.local_auth import create_access_token, generate_jwt_secret
from api.services.rate_limiter import rate_limit
from api.services.rbac import require_permission, write_audit

log = logging.getLogger("meridian.auth_oidc")

router = APIRouter(prefix="/api/v1/auth/oidc", tags=["auth"])
admin_router = APIRouter(prefix="/api/v1/admin/sso", tags=["admin"])

_oidc_rate_limit = rate_limit("auth_oidc", limit=20, window_s=60, key_by="ip")

STATE_COOKIE = "mn_oidc_state"
STATE_PURPOSE = "oidc_state"
CALLBACK_PATH = "/api/v1/auth/oidc/callback"
DEFAULT_ROLE = "viewer"
_DOMAIN = re.compile(r"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")

# Short codes the sign-in page turns into sentences (frontend components/auth/sso.ts keeps the same table).
ERROR_SENTENCES: dict[str, str] = {
    "not_configured": "Single sign-on is not set up. Use your email and password.",
    "provider_unreachable": "The identity provider could not be reached. Try again in a minute.",
    "denied": "Sign-in was cancelled or refused by your identity provider.",
    "expired": "That sign-in took too long or was started in another browser. Start again.",
    "invalid_token": "Your identity could not be verified. Try signing in again.",
    "email_missing": "Your identity provider did not share a verified email address.",
    "domain_not_allowed": "Your email domain is not allowed to sign in here. Ask an administrator.",
    "suspended": "This account is suspended. Ask an administrator to reactivate it.",
    "subject_conflict": "This account is already linked to a different identity. Ask an administrator.",
    "seats_full": "Licence seats are full, so a new account could not be created. Ask an administrator.",
    "failed": "Single sign-on failed. Try again, or use your email and password.",
}


def _redirect_uri() -> str:
    """The callback URL registered at the IdP: the deployment's own base URL, never request input."""
    from workers.tasks.send_user_invitation import _resolve_app_base_url

    return f"{_resolve_app_base_url()}{CALLBACK_PATH}"


def _error_redirect(code: str) -> RedirectResponse:
    resp = RedirectResponse(f"/sign-in?{urlencode({'sso_error': code})}", status_code=302)
    resp.delete_cookie(STATE_COOKIE, path=router.prefix)
    return resp


def _client_secret(cfg: dict[str, Any], jwt_secret: str) -> str:
    return decrypt_api_key(str(cfg.get("client_secret_encrypted") or ""), jwt_secret)


def _audit(conn: Any, tenant_id: str, action: str, user_id: str | None, email: str | None, after: dict[str, Any],
           status: int = 200) -> None:
    conn.execute(
        text("INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, "
             "method, path, status_code, after_json) "
             "VALUES (:t, :u, :e, :a, 'user', :ei, 'GET', :p, :s, CAST(:af AS jsonb))"),
        {"t": tenant_id, "u": user_id, "e": email or "unknown", "a": action, "ei": user_id or "",
         "p": CALLBACK_PATH, "s": status, "af": json.dumps(after)},
    )


# ── Public: config, start, callback ──────────────────────────────────────────

class OidcPublicConfig(BaseModel):
    enabled: bool
    display_name: str | None = None
    enforce: bool = False


@router.get("/config", response_model=OidcPublicConfig)
def oidc_config() -> OidcPublicConfig:
    """What the sign-in page needs to know. Public; says nothing about the provider beyond its display name."""
    with get_sync_engine_or_create().connect() as conn:
        conn.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": DEV_TENANT_ID})
        cfg = oidc.load_config(conn, DEV_TENANT_ID)
    if not oidc.is_configured(cfg) or cfg is None:
        return OidcPublicConfig(enabled=False)
    return OidcPublicConfig(enabled=True, display_name=str(cfg.get("display_name") or "single sign-on"),
                            enforce=bool(cfg.get("enforce")))


@router.get("/start", dependencies=[Depends(_oidc_rate_limit)])
def oidc_start(request: Request, next: str | None = None) -> RedirectResponse:
    """Send the browser to the identity provider."""
    engine = get_sync_engine_or_create()
    with engine.connect() as conn:
        conn.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": DEV_TENANT_ID})
        cfg = oidc.load_config(conn, DEV_TENANT_ID)
        jwt_secret = conn.execute(text("SELECT jwt_secret FROM tenants WHERE id = :t"), {"t": DEV_TENANT_ID}).scalar()
    if not oidc.is_configured(cfg) or cfg is None or not jwt_secret:
        return _error_redirect("not_configured")
    try:
        discovery = oidc.fetch_discovery(str(cfg["issuer"]))
    except oidc.OidcError:
        return _error_redirect("provider_unreachable")

    state, nonce = oidc.new_random(), oidc.new_random()
    verifier, challenge = oidc.new_pkce()
    now = datetime.now(timezone.utc)
    cookie = jwt.encode(
        {"purpose": STATE_PURPOSE, "state": state, "nonce": nonce, "cv": verifier, "nxt": oidc.safe_next(next),
         "iat": now, "exp": now + timedelta(seconds=oidc.STATE_TTL_SECONDS)},
        jwt_secret, algorithm="HS256")
    url = oidc.build_authorization_url(discovery, client_id=str(cfg["client_id"]), redirect_uri=_redirect_uri(),
                                       state=state, nonce=nonce, code_challenge=challenge)
    resp = RedirectResponse(url, status_code=302)
    resp.set_cookie(STATE_COOKIE, cookie, max_age=oidc.STATE_TTL_SECONDS, path=router.prefix, httponly=True,
                    samesite="lax", secure=cookie_secure(request))
    return resp


def _seats_full(conn: Any, tenant_id: str) -> bool:
    manifest = get_cached_manifest()
    limit = manifest.get("seats", manifest.get("max_users"))
    if not isinstance(limit, (int, float)) or isinstance(limit, bool) or limit <= 0:
        return False
    used = conn.execute(text("SELECT COUNT(*) FROM users WHERE tenant_id = :t AND is_active"), {"t": tenant_id}).scalar()
    return int(used or 0) >= int(limit)


class _Refused(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _resolve_user(conn: Any, cfg: dict[str, Any], ident: dict[str, str]) -> tuple[Any, bool]:
    """(users row, created) for a verified identity; raises _Refused. Row columns: id, email, name, role,
    is_active, token_version. Maps by external_subject, else by email (domain must be allowed), else provisions."""
    cols = "id, email, name, role, is_active, token_version"
    tid, sub, email = DEV_TENANT_ID, ident["sub"], ident["email"]
    row = conn.execute(text(f"SELECT {cols} FROM users WHERE tenant_id = :t AND external_subject = :s"),
                       {"t": tid, "s": sub}).fetchone()
    if row:
        if not row[4]:
            raise _Refused("suspended")
        return row, False

    if not oidc.email_domain_allowed(email, list(cfg.get("allowed_domains") or [])):
        raise _Refused("domain_not_allowed")

    row = conn.execute(text(f"SELECT {cols}, external_subject FROM users WHERE tenant_id = :t AND LOWER(email) = :e"),
                       {"t": tid, "e": email}).fetchone()
    if row:
        if not row[4]:
            raise _Refused("suspended")
        if row[6] and row[6] != sub:
            raise _Refused("subject_conflict")
        conn.execute(text("UPDATE users SET external_subject = :s WHERE id = :u AND external_subject IS NULL"),
                     {"s": sub, "u": str(row[0])})
        return row[:6], False

    if _seats_full(conn, tid):
        raise _Refused("seats_full")
    new_id = str(uuid.uuid4())
    # No grants and no password: the tenant default role (viewer) is all a new SSO user holds.
    conn.execute(
        text("INSERT INTO users (id, tenant_id, email, name, role, is_active, external_subject) "
             "VALUES (:i, :t, :e, :n, :r, true, :s)"),
        {"i": new_id, "t": tid, "e": email, "n": ident["name"][:200], "r": cfg.get("default_role") or DEFAULT_ROLE, "s": sub})
    created = conn.execute(text(f"SELECT {cols} FROM users WHERE id = :i"), {"i": new_id}).fetchone()
    return created, True


@router.get("/callback", dependencies=[Depends(_oidc_rate_limit)])
def oidc_callback(request: Request, code: str | None = None, state: str | None = None,
                  error: str | None = None) -> RedirectResponse:
    """Finish sign-in: validate, map or provision the user, issue the session, land on /sign-in."""
    if error:  # the IdP's text is not echoed anywhere
        return _error_redirect("denied")
    raw_cookie = request.cookies.get(STATE_COOKIE)
    if not raw_cookie or not code or not state or len(code) > 4096 or len(state) > 512:
        return _error_redirect("expired")

    engine = get_sync_engine_or_create()
    audit_email: str | None = None
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": DEV_TENANT_ID})
            cfg = oidc.load_config(conn, DEV_TENANT_ID)
            jwt_secret = conn.execute(text("SELECT jwt_secret FROM tenants WHERE id = :t"), {"t": DEV_TENANT_ID}).scalar()
            if not oidc.is_configured(cfg) or cfg is None or not jwt_secret:
                return _error_redirect("not_configured")

            try:
                saved = jwt.decode(raw_cookie, jwt_secret, algorithms=["HS256"])
            except jwt.PyJWTError:
                return _error_redirect("expired")
            if saved.get("purpose") != STATE_PURPOSE or not all(
                    isinstance(saved.get(k), str) for k in ("state", "nonce", "cv")):
                return _error_redirect("expired")
            if not oidc.same_secret(state, saved["state"]):
                return _error_redirect("expired")

            client_secret = _client_secret(cfg, jwt_secret)
            if not client_secret:
                log.warning("OIDC client secret could not be decrypted; an administrator must enter it again")
                return _error_redirect("failed")
            redirect_uri = _redirect_uri()
            discovery = oidc.fetch_discovery(str(cfg["issuer"]))
            tokens = oidc.exchange_code(discovery, client_id=str(cfg["client_id"]), client_secret=client_secret,
                                        code=code, code_verifier=saved["cv"], redirect_uri=redirect_uri)
            claims = oidc.verify_id_token(tokens["id_token"], discovery, client_id=str(cfg["client_id"]),
                                          nonce=saved["nonce"])
            ident = oidc.identity_from_claims(claims)
            audit_email = ident["email"]

            try:
                row, created = _resolve_user(conn, cfg, ident)
            except _Refused as refused:  # nothing was written before a refusal
                _audit(conn, DEV_TENANT_ID, "auth.sso_refused", None, audit_email,
                       {"reason": refused.code, "issuer": cfg["issuer"]}, status=403)
                conn.commit()
                return _error_redirect(refused.code)
            except IntegrityError:  # a concurrent first sign-in created the same identity
                conn.rollback()
                return _error_redirect("failed")

            user_id = str(row[0])
            conn.execute(
                text("UPDATE users SET last_login = :now, failed_login_count = 0, locked_until = NULL WHERE id = :u"),
                {"now": datetime.now(timezone.utc), "u": user_id})
            if created:
                _audit(conn, DEV_TENANT_ID, "auth.sso_user_created", user_id, row[1],
                       {"role": row[3], "issuer": cfg["issuer"], "grants": 0})
            _audit(conn, DEV_TENANT_ID, "auth.sso_login", user_id, row[1], {"issuer": cfg["issuer"], "created": created})
            conn.commit()

            token = create_access_token(user_id=user_id, tenant_id=DEV_TENANT_ID, email=row[1], role=row[3],
                                        secret=jwt_secret, token_version=int(row[5]))
    except oidc.OidcError as e:
        log.info("OIDC sign-in refused: %s", e.code)
        return _error_redirect(e.code if e.code in ERROR_SENTENCES else "failed")
    except Exception:  # noqa: BLE001 - never a stack trace to the browser
        log.exception("OIDC callback failed")
        return _error_redirect("failed")

    fragment = urlencode({"sso_token": token, "next": saved.get("nxt") or "/home"})
    resp = RedirectResponse(f"/sign-in#{fragment}", status_code=302)
    _set_auth_cookie(resp, token, request)
    resp.delete_cookie(STATE_COOKIE, path=router.prefix)
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ── Admin: configure ─────────────────────────────────────────────────────────

class SsoConfigOut(BaseModel):
    configured: bool
    issuer: str = ""
    client_id: str = ""
    has_secret: bool = False  # the secret itself is write-only and never returned
    display_name: str = ""
    allowed_domains: list[str] = []
    default_role: str = DEFAULT_ROLE
    enforce: bool = False
    redirect_uri: str = ""


class SsoConfigIn(BaseModel):
    issuer: str = Field(min_length=1, max_length=512)
    client_id: str = Field(min_length=1, max_length=256)
    client_secret: str | None = Field(default=None, max_length=1024)  # omitted/empty keeps the stored secret
    display_name: str = Field(min_length=1, max_length=60)
    allowed_domains: list[str] = Field(default_factory=list, max_length=50)
    default_role: Literal["viewer"] = DEFAULT_ROLE
    enforce: bool = False


class SsoTestIn(BaseModel):
    issuer: str | None = Field(default=None, max_length=512)


class SsoTestOut(BaseModel):
    ok: bool
    message: str


def _out(cfg: dict[str, Any] | None) -> SsoConfigOut:
    if not cfg:
        return SsoConfigOut(configured=False, redirect_uri=_redirect_uri())
    return SsoConfigOut(
        configured=True, issuer=str(cfg.get("issuer") or ""), client_id=str(cfg.get("client_id") or ""),
        has_secret=bool(cfg.get("client_secret_encrypted")), display_name=str(cfg.get("display_name") or ""),
        allowed_domains=[str(d) for d in cfg.get("allowed_domains") or []],
        default_role=str(cfg.get("default_role") or DEFAULT_ROLE), enforce=bool(cfg.get("enforce")),
        redirect_uri=_redirect_uri())


async def _load(db: AsyncSession, tenant: Tenant) -> dict[str, Any] | None:
    await db.execute(text(f"SET app.tenant_id = '{str(tenant.id)}'"))
    cfg = (await db.execute(text("SELECT sso_config FROM tenants WHERE id = :t"), {"t": str(tenant.id)})).scalar()
    return cfg if isinstance(cfg, dict) else None


def _clean_domains(raw: list[str]) -> list[str]:
    out: list[str] = []
    for item in raw:
        d = item.strip().lower().lstrip("@")
        if not d:
            continue
        if not _DOMAIN.match(d):
            raise HTTPException(status_code=422, detail=f"\"{item.strip()}\" is not a valid email domain, for example example.com.")
        if d not in out:
            out.append(d)
    return out


def _audit_view(cfg: dict[str, Any] | None) -> dict[str, Any] | None:
    """The config as written to the audit log: everything except the secret, which is only noted as present."""
    if not cfg:
        return None
    return {**{k: v for k, v in cfg.items() if k != "client_secret_encrypted"},
            "has_secret": bool(cfg.get("client_secret_encrypted"))}


@admin_router.get("", response_model=SsoConfigOut, dependencies=[Depends(require_permission("manage_users"))])
async def get_sso(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)) -> SsoConfigOut:
    return _out(await _load(db, tenant))


@admin_router.put("", response_model=SsoConfigOut)
async def put_sso(body: SsoConfigIn, request: Request, db: AsyncSession = Depends(get_db),
                  tenant: Tenant = Depends(get_tenant),
                  _role: str = Depends(require_permission("manage_users"))) -> SsoConfigOut:
    """Save the sign-in configuration. The secret is encrypted at rest and cannot be read back."""
    before = await _load(db, tenant)
    try:
        issuer = oidc.validate_issuer(body.issuer)
    except oidc.OidcError as e:
        raise HTTPException(status_code=422, detail=e.message) from None
    client_id = body.client_id.strip()
    domains = _clean_domains(body.allowed_domains)

    jwt_secret = (await db.execute(text("SELECT jwt_secret FROM tenants WHERE id = :t"), {"t": str(tenant.id)})).scalar()
    if not jwt_secret:
        jwt_secret = generate_jwt_secret()
        await db.execute(text("UPDATE tenants SET jwt_secret = :s WHERE id = :t"), {"s": jwt_secret, "t": str(tenant.id)})

    secret_in = (body.client_secret or "").strip()
    if secret_in:
        encrypted = encrypt_api_key(secret_in, jwt_secret)
    else:
        encrypted = str((before or {}).get("client_secret_encrypted") or "")
        if not encrypted:
            raise HTTPException(status_code=422, detail="Enter the client secret.")
        if before and (before.get("issuer") != issuer or before.get("client_id") != client_id):
            raise HTTPException(status_code=422, detail="Enter the client secret again when you change the issuer or client ID.")

    if body.enforce:
        try:
            await run_in_threadpool(oidc.fetch_discovery, issuer)
        except oidc.OidcError as e:
            raise HTTPException(status_code=422, detail=f"Enforcing is refused until the provider is reachable. {e.message}") from None
        n = (await db.execute(
            text("SELECT COUNT(*) FROM users WHERE tenant_id = :t AND is_active AND password_hash IS NOT NULL "
                 "AND role = ANY(:r)"), {"t": str(tenant.id), "r": list(oidc.BREAK_GLASS_ROLES)})).scalar()
        if not n:
            raise HTTPException(status_code=422, detail="Enforcing would leave no administrator able to sign in with a password. Keep one administrator with a password.")

    cfg = {"issuer": issuer, "client_id": client_id, "client_secret_encrypted": encrypted,
           "display_name": body.display_name.strip(), "allowed_domains": domains,
           "default_role": body.default_role, "enforce": body.enforce}
    await db.execute(text("UPDATE tenants SET sso_config = CAST(:c AS jsonb) WHERE id = :t"),
                     {"c": json.dumps(cfg), "t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "sso.config_change", "tenant", str(tenant.id),
                      _audit_view(before), _audit_view(cfg))
    await db.commit()
    return _out(cfg)


@admin_router.delete("", response_model=SsoConfigOut)
async def delete_sso(request: Request, db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                     _role: str = Depends(require_permission("manage_users"))) -> SsoConfigOut:
    """Turn single sign-on off. Linked users keep their accounts and sign in with a password again."""
    before = await _load(db, tenant)
    await db.execute(text("UPDATE tenants SET sso_config = NULL WHERE id = :t"), {"t": str(tenant.id)})
    await write_audit(db, tenant.id, request, "sso.config_remove", "tenant", str(tenant.id), _audit_view(before), None)
    await db.commit()
    return _out(None)


@admin_router.post("/test", response_model=SsoTestOut, dependencies=[Depends(require_permission("manage_users"))])
async def test_sso(body: SsoTestIn | None = None, db: AsyncSession = Depends(get_db),
                   tenant: Tenant = Depends(get_tenant)) -> SsoTestOut:
    """Fetch the provider's discovery document (the entered issuer, else the saved one) and say what happened."""
    issuer = (body.issuer if body and body.issuer else None) or str((await _load(db, tenant) or {}).get("issuer") or "")
    if not issuer.strip():
        return SsoTestOut(ok=False, message="Enter the issuer first.")
    try:
        doc = await run_in_threadpool(oidc.fetch_discovery, issuer)
    except oidc.OidcError as e:
        return SsoTestOut(ok=False, message=e.message)
    return SsoTestOut(ok=True, message=f"Reached {doc['issuer']}. Register {_redirect_uri()} as the redirect URI at your provider.")
