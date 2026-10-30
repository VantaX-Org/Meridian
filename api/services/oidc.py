"""OpenID Connect sign-in: authorization code with PKCE (S256), implemented on httpx and PyJWT.

authlib is not a dependency of this repo, so the flow is written out here: discovery, authorization URL, code
exchange, and id_token verification (signature against the issuer's JWKS, iss, aud, azp, exp, nonce). Protocol
functions plus one error type, then a few small helpers that read the tenant's stored configuration through a
connection the caller opened (tenant context already set). Routes (api/routes/auth_oidc.py) own the rest.

Security properties kept here:
- the id_token algorithm must be an asymmetric one the caller allows; ``none`` and HMAC are refused, so a token
  cannot be forged with the public key or without a signature;
- the discovery document's ``issuer`` must equal the configured issuer, and the token's ``iss`` must equal it;
- nonce is compared in constant time;
- tokens, codes, verifiers and the client secret are never logged and never put in an error message;
- every error is an OidcError carrying one plain sentence for the person signing in or the admin testing.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import secrets
from collections.abc import Callable
from typing import Any
from urllib.parse import quote, urlencode, urlparse

import httpx
import jwt

logger = logging.getLogger("meridian.oidc")

HTTP_TIMEOUT_S = 10.0
STATE_TTL_SECONDS = 600  # 10 minutes: the time a person has to finish signing in at the IdP
CLOCK_LEEWAY_S = 60
# Asymmetric only. HS* would let anyone who knows the client id/secret forge a token; none is no signature.
ALLOWED_ALGS = ("RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512")
SCOPES = "openid email profile"

# Tests replace this to serve a mocked issuer (httpx.MockTransport) without a network.
HttpClientFactory = Callable[[], httpx.Client]


def _default_client() -> httpx.Client:
    return httpx.Client(timeout=HTTP_TIMEOUT_S, follow_redirects=False)


http_client_factory: HttpClientFactory = _default_client


class OidcError(Exception):
    """A sign-in or configuration problem, as one plain sentence safe to show to the caller."""

    def __init__(self, message: str, code: str = "failed") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


def _is_local_host(host: str) -> bool:
    return host in ("localhost", "127.0.0.1", "::1")


def validate_issuer(issuer: str) -> str:
    """The issuer URL without a trailing slash, or OidcError. https only (http for localhost, for development)."""
    value = (issuer or "").strip()
    parsed = urlparse(value)
    if not parsed.hostname or parsed.scheme not in ("https", "http"):
        raise OidcError("The issuer must be a full web address, for example https://login.example.com/tenant.")
    if parsed.scheme == "http" and not _is_local_host(parsed.hostname):
        raise OidcError("The issuer must use https.")
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise OidcError("The issuer must not contain a query, fragment or credentials.")
    return value.rstrip("/")


def fetch_discovery(issuer: str) -> dict[str, Any]:
    """The issuer's OpenID configuration, checked: same issuer, the three endpoints we use, https endpoints,
    and S256 PKCE not ruled out. Raises OidcError with a sentence on any problem."""
    base = validate_issuer(issuer)
    url = f"{base}/.well-known/openid-configuration"
    try:
        with http_client_factory() as client:
            resp = client.get(url, headers={"Accept": "application/json"})
    except httpx.HTTPError:
        raise OidcError("The identity provider could not be reached. Check the issuer address.", "provider_unreachable") from None
    if resp.status_code != 200:
        raise OidcError(f"The identity provider answered {resp.status_code} for its configuration. Check the issuer address.", "provider_unreachable")
    try:
        doc = resp.json()
    except ValueError:
        raise OidcError("The identity provider's configuration is not valid JSON.") from None
    if not isinstance(doc, dict):
        raise OidcError("The identity provider's configuration is not valid.")
    if str(doc.get("issuer", "")).rstrip("/") != base:
        raise OidcError("The identity provider reports a different issuer than the one entered.")
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        value = doc.get(key)
        parsed = urlparse(value) if isinstance(value, str) else None
        if not parsed or not parsed.hostname or parsed.scheme not in ("https", "http"):
            raise OidcError(f"The identity provider's configuration has no valid {key.replace('_', ' ')}.")
        if parsed.scheme == "http" and not _is_local_host(parsed.hostname):
            raise OidcError(f"The identity provider's {key.replace('_', ' ')} does not use https.")
    methods = doc.get("code_challenge_methods_supported")
    if isinstance(methods, list) and "S256" not in methods:
        raise OidcError("The identity provider does not support PKCE with S256, which Meridian requires.")
    return doc


# ── PKCE, state, nonce ───────────────────────────────────────────────────────

def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def new_pkce() -> tuple[str, str]:
    """(code_verifier, S256 code_challenge). The verifier is 64 URL-safe characters (RFC 7636: 43 to 128)."""
    verifier = _b64url(secrets.token_bytes(48))
    return verifier, _b64url(hashlib.sha256(verifier.encode("ascii")).digest())


def new_random() -> str:
    """An unguessable value for `state` or `nonce`."""
    return _b64url(secrets.token_bytes(32))


def same_secret(a: str, b: str) -> bool:
    """Constant-time equality for state and nonce."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def build_authorization_url(discovery: dict[str, Any], *, client_id: str, redirect_uri: str, state: str, nonce: str,
                            code_challenge: str) -> str:
    """The IdP URL to send the browser to. `redirect_uri` comes from deployment configuration, never a request."""
    query = urlencode({
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": SCOPES,
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    })
    endpoint = discovery["authorization_endpoint"]
    return f"{endpoint}{'&' if '?' in endpoint else '?'}{query}"


# ── Code exchange ────────────────────────────────────────────────────────────

def exchange_code(discovery: dict[str, Any], *, client_id: str, client_secret: str, code: str, code_verifier: str,
                  redirect_uri: str) -> dict[str, Any]:
    """Redeem the authorization code at the token endpoint. Returns the token response (never logged)."""
    form = {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri,
            "code_verifier": code_verifier, "client_id": client_id}
    headers = {"Accept": "application/json"}
    supported = discovery.get("token_endpoint_auth_methods_supported")
    if isinstance(supported, list) and "client_secret_basic" not in supported and "client_secret_post" in supported:
        form["client_secret"] = client_secret
    else:  # client_secret_basic is the default when the provider names no method (OIDC Discovery 1.0)
        creds = f"{quote(client_id, safe='')}:{quote(client_secret, safe='')}"
        headers["Authorization"] = "Basic " + base64.b64encode(creds.encode()).decode()
        form.pop("client_id")
    try:
        with http_client_factory() as client:
            resp = client.post(discovery["token_endpoint"], data=form, headers=headers)
    except httpx.HTTPError:
        raise OidcError("The identity provider could not be reached to finish sign-in. Try again.", "provider_unreachable") from None
    if resp.status_code != 200:
        logger.warning("OIDC token endpoint answered %s", resp.status_code)
        raise OidcError("The identity provider refused the sign-in. Try again, or ask an administrator to check the client secret.")
    try:
        body = resp.json()
    except ValueError:
        raise OidcError("The identity provider's answer was not valid.") from None
    if not isinstance(body, dict) or not isinstance(body.get("id_token"), str) or not body["id_token"]:
        raise OidcError("The identity provider did not return an identity token.")
    return body


# ── id_token verification ────────────────────────────────────────────────────

def _fetch_jwks(discovery: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        with http_client_factory() as client:
            resp = client.get(discovery["jwks_uri"], headers={"Accept": "application/json"})
        keys = resp.json().get("keys") if resp.status_code == 200 else None
    except (httpx.HTTPError, ValueError, AttributeError):
        keys = None
    if not isinstance(keys, list) or not keys:
        raise OidcError("The identity provider's signing keys could not be fetched. Try again.", "provider_unreachable")
    return [k for k in keys if isinstance(k, dict)]


def verify_id_token(id_token: str, discovery: dict[str, Any], *, client_id: str, nonce: str) -> dict[str, Any]:
    """The verified claims of an id_token, or OidcError("...", "invalid_token").

    Checks, in order: header algorithm is allowed; a JWKS key matches (kid, or the only key); the signature;
    iss equals the discovery issuer; aud contains client_id (and azp equals it when there are several
    audiences); exp (a minute of leeway); nonce equals the one issued for this sign-in; sub is present."""
    bad = "The identity token could not be verified. Try signing in again."
    try:
        header = jwt.get_unverified_header(id_token)
    except jwt.PyJWTError:
        raise OidcError(bad, "invalid_token") from None
    alg = header.get("alg")
    if alg not in ALLOWED_ALGS:
        raise OidcError(bad, "invalid_token")
    keys = _fetch_jwks(discovery)
    kid = header.get("kid")
    candidates = [k for k in keys if k.get("kid") == kid] if kid else (keys if len(keys) == 1 else [])
    if not candidates:
        raise OidcError(bad, "invalid_token")
    claims: dict[str, Any] | None = None
    for jwk in candidates:
        try:
            key = jwt.PyJWK(jwk).key
            claims = jwt.decode(
                id_token, key, algorithms=[alg], audience=client_id, issuer=str(discovery["issuer"]),
                leeway=CLOCK_LEEWAY_S, options={"require": ["exp", "iss", "aud", "sub"]},
            )
            break
        except jwt.PyJWTError:
            continue
    if claims is None:
        raise OidcError(bad, "invalid_token")
    aud = claims.get("aud")
    if isinstance(aud, list) and len(aud) > 1 and claims.get("azp") != client_id:
        raise OidcError(bad, "invalid_token")
    token_nonce = claims.get("nonce")
    if not isinstance(token_nonce, str) or not same_secret(token_nonce, nonce):
        raise OidcError(bad, "invalid_token")
    if not isinstance(claims.get("sub"), str) or not claims["sub"]:
        raise OidcError(bad, "invalid_token")
    return claims


def identity_from_claims(claims: dict[str, Any]) -> dict[str, str]:
    """{sub, email, name} from verified claims. The email is `email`, else an address-shaped `preferred_username`
    or `upn` (Entra ID often omits `email`). A provider that says the email is unverified is refused."""
    if claims.get("email_verified") is False:
        raise OidcError("Your identity provider has not verified your email address.", "email_missing")
    email = ""
    for field in ("email", "preferred_username", "upn"):
        value = claims.get(field)
        if isinstance(value, str) and "@" in value and " " not in value.strip():
            email = value.strip().lower()
            break
    if not email:
        raise OidcError("Your identity provider did not share an email address, which Meridian needs to match you to an account.",
                        "email_missing")
    name = claims.get("name")
    return {"sub": claims["sub"], "email": email, "name": name.strip() if isinstance(name, str) and name.strip() else email.split("@")[0]}


def email_domain_allowed(email: str, allowed_domains: list[str]) -> bool:
    """True when the email's domain is in `allowed_domains` (case-insensitive, exact match; an empty list allows none)."""
    domain = email.rsplit("@", 1)[-1].strip().lower()
    return bool(domain) and domain in {d.strip().lower().lstrip("@") for d in allowed_domains if d and d.strip()}


def safe_next(path: str | None) -> str:
    """A same-site path to land on after sign-in; anything else (absolute URL, //host, backslash) is / (the landscape)."""
    if path and path.startswith("/") and not path.startswith("//") and "\\" not in path and len(path) <= 512 \
            and not any(ord(c) < 32 for c in path):
        return path
    return "/"


# ── Stored configuration (tenants.sso_config) ────────────────────────────────

BREAK_GLASS_ROLES = ("platform_admin", "admin")


def load_config(conn: Any, tenant_id: str) -> dict[str, Any] | None:
    """The tenant's raw sso_config (including the encrypted secret) or None. Callers never return it as is."""
    from sqlalchemy import text

    row = conn.execute(text("SELECT sso_config FROM tenants WHERE id = :t"), {"t": str(tenant_id)}).fetchone()
    cfg = row[0] if row else None
    return cfg if isinstance(cfg, dict) else None


def is_configured(cfg: dict[str, Any] | None) -> bool:
    """SSO can be offered: an issuer, a client id and a stored secret."""
    return bool(cfg and cfg.get("issuer") and cfg.get("client_id") and cfg.get("client_secret_encrypted"))


def is_enforced(cfg: dict[str, Any] | None) -> bool:
    return is_configured(cfg) and bool(cfg and cfg.get("enforce"))


def holds_break_glass(conn: Any, tenant_id: str, user_id: str | None, role: str | None) -> bool:
    """True for a user who may still sign in with a password while SSO is enforced: users.role is admin or
    platform_admin, or an unscoped grant of one of them."""
    from sqlalchemy import text

    if role in BREAK_GLASS_ROLES:
        return True
    if not user_id:
        return False
    row = conn.execute(
        text("SELECT 1 FROM user_role_scopes WHERE tenant_id = :t AND user_id = :u AND role_key = ANY(:keys) "
             "AND system_id IS NULL AND module IS NULL AND (expires_at IS NULL OR expires_at > now()) LIMIT 1"),
        {"t": str(tenant_id), "u": str(user_id), "keys": list(BREAK_GLASS_ROLES)},
    ).fetchone()
    return row is not None
