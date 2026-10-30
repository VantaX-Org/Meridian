"""The command palette's search: one query across records, rules, objects, runs, people and actions.

GET /api/v1/command?q=<text>&limit=20 -> {"groups": [{"kind", "label", "items": [{"id", "title", "href"}]}]}

Read-only. Records come from the work list of the current state (api/routes/work.py's own record filter, so a key
prefix, a key value with or without its leading zeros and a name prefix match the way Fix work's search does), rules
from the tenant's rules table, objects from the current state, runs from finished runs, people from the tenant's
users. The Actions group lists only what the caller may do (api/services/rbac.py). Every query carries the tenant
id and runs after ``app.tenant_id`` is set (RLS), so nothing of another tenant can come back. Empty groups are left out.
"""
import re
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.objects import _label
from api.routes.record_issues import _rls
from api.routes.work import _allowed, _records_where, _Rows
from api.services.api_keys import NOT_SERVICE_USER_SQL
from api.services.current_state import current_pairs
from api.services.rbac import require_permission
from api.services.version_status import finished_sql

router = APIRouter(prefix="/api/v1", tags=["command"])

GROUP_CAP = 5  # items per group; records and rules are limited to five by the contract, the others follow it
GROUP_LABELS = {"record": "Records", "rule": "Rules", "object": "Objects", "run": "Runs", "person": "People",
                "action": "Actions"}


class CommandItemOut(BaseModel):
    id: str
    title: str
    href: str


class CommandGroupOut(BaseModel):
    kind: str
    label: str
    items: list[CommandItemOut]


class CommandOut(BaseModel):
    groups: list[CommandGroupOut]


def slug(value: str) -> str:
    """"ECC production" -> "ecc-production"; "material_master" -> "material-master" (the v2 route segments)."""
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def _like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")


def _key_value(record_key: str) -> str:
    """The first part of a record key as SAP shows it: "MATNR=000101|WERKS=3000" -> "000101"."""
    first = record_key.split("|", 1)[0]
    return first.split("=", 1)[1] if "=" in first else first


def _object_href(system_name: Optional[str], module: str, tail: str = "") -> str:
    return f"/v2/o/{slug(system_name)}/{slug(module)}{tail}" if system_name else f"/v2/work{tail}"


async def _records(db: AsyncSession, tenant: Tenant, request: Request, q: str, pairs: list[dict], n: int) -> list[dict]:
    if not pairs:
        return []
    where, p = _records_where(tenant, _Rows(None, None, pairs), request, None, None, None, None, None, None, q)
    rows = (await db.execute(text(f"""
        SELECT w.module, w.record_key, w.name, s.name AS system_name FROM work_records w
          LEFT JOIN sap_systems s ON s.tenant_id = w.tenant_id AND s.id::text = w.scope
         WHERE {' AND '.join(where)} ORDER BY w.sev_rank, w.module, w.record_key LIMIT :n"""), {**p, "n": n})).mappings().all()
    out = []
    for r in rows:
        rid = f"{r['module']}:{r['record_key']}"
        title = f"{_label(r['module'])} {_key_value(r['record_key'])}" + (f" · {r['name']}" if r["name"] else "")
        out.append({"id": rid, "title": title,
                    "href": _object_href(r["system_name"], r["module"], f"?open=record:{quote(rid, safe=':=|')}")})
    return out


async def _rules(db: AsyncSession, tenant: Tenant, q: str, n: int) -> list[dict]:
    rows = (await db.execute(text(
        "SELECT DISTINCT ON (split_part(name, ':', 1)) split_part(name, ':', 1) AS check_id, "
        "trim(CASE WHEN strpos(name, ':') > 0 THEN substr(name, strpos(name, ':') + 1) ELSE '' END) AS title "
        "FROM rules WHERE tenant_id = CAST(:t AS uuid) "
        "AND (split_part(name, ':', 1) ILIKE :pre OR name ILIKE :any) "
        "ORDER BY split_part(name, ':', 1) LIMIT :n"),
        {"t": str(tenant.id), "pre": _like(q) + "%", "any": "%" + _like(q) + "%", "n": n})).mappings().all()
    return [{"id": r["check_id"], "title": f"{r['check_id']} · {r['title']}" if r["title"] else r["check_id"],
             "href": f"/v2/r/{quote(r['check_id'], safe='')}"} for r in rows]


async def _objects(db: AsyncSession, tenant: Tenant, q: str, pairs: list[dict], n: int) -> list[dict]:
    term = q.lower()
    hits = [p for p in pairs if not term or term in _label(p["module"]).lower() or term in p["module"].lower()][:n]
    if not hits:
        return []
    systems = {r[0]: r[1] for r in (await db.execute(text(
        "SELECT av.id::text, s.name FROM analysis_versions av JOIN sap_systems s "
        "ON s.tenant_id = av.tenant_id AND s.id::text = av.metadata->>'system_id' "
        "WHERE av.tenant_id = CAST(:t AS uuid) AND av.id = ANY(CAST(:ids AS uuid[]))"),
        {"t": str(tenant.id), "ids": [p["version_id"] for p in hits]})).fetchall()}
    return [{"id": p["module"], "title": _label(p["module"]),
             "href": _object_href(systems.get(p["version_id"]), p["module"]) if systems.get(p["version_id"]) else "/v2"}
            for p in hits]


async def _runs(db: AsyncSession, tenant: Tenant, q: str, n: int) -> list[dict]:
    rows = (await db.execute(text(
        f"SELECT id::text AS id, label, run_number, run_at FROM analysis_versions WHERE tenant_id = CAST(:t AS uuid) "
        f"AND {finished_sql()} AND (label ILIKE :any OR to_char(run_at, 'YYYY-MM-DD HH24:MI') LIKE :any) "
        f"ORDER BY run_at DESC, id LIMIT :n"),
        {"t": str(tenant.id), "any": "%" + _like(q) + "%", "n": n})).mappings().all()
    return [{"id": r["id"],
             "title": (r["label"] or (f"Run {r['run_number']}" if r["run_number"] else "Run"))
                      + f" · {r['run_at']:%Y-%m-%d}",
             "href": f"/v2/run/{r['id']}"} for r in rows]


async def _people(db: AsyncSession, tenant: Tenant, q: str, n: int) -> list[dict]:
    rows = (await db.execute(text(
        f"SELECT id::text AS id, name FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active "
        f"AND {NOT_SERVICE_USER_SQL.format(col='email')} AND (name ILIKE :any OR email ILIKE :any) "
        f"ORDER BY name, id LIMIT :n"),
        {"t": str(tenant.id), "any": "%" + _like(q) + "%", "n": n})).mappings().all()
    return [{"id": r["id"], "title": r["name"], "href": f"/v2/people?open=person:{r['id']}"} for r in rows]


async def _actions(db: AsyncSession, tenant: Tenant, request: Request, role: str, q: str) -> list[dict]:
    """Static actions, filtered by the words of the query (every word starts a keyword) and by what the caller may do."""
    words = q.lower().split()
    v2 = request.cookies.get("mn_ui") == "v2"  # the v2 shell links into /v2/work
    candidates: list[tuple[str, str, str, str, tuple[str, ...]]] = []  # (permission, id, title, href, keywords)

    if await _allowed(db, tenant, request, role, "approve"):
        waiting = (await db.execute(text(
            "SELECT count(DISTINCT b.id) FROM remediation_batches b "
            "JOIN remediation_items i ON i.batch_id = b.id AND i.tenant_id = b.tenant_id "
            "WHERE b.tenant_id = CAST(:t AS uuid) AND b.status = 'draft' AND i.accepted"), {"t": str(tenant.id)})).scalar() or 0
        candidates.append(("approve", "approvals", f"Approvals waiting {int(waiting)}", "/v2/work?filter=approvals" if v2 else "/inbox?kind=approvals",
                           ("approve", "approvals", "approval", "waiting", "inbox")))
    if await _allowed(db, tenant, request, role, "export"):
        candidates.append(("export", "export-fix-sheet", "Export fix sheet", "/v2/work?export=1" if v2 else "/fix?action=export",
                           ("export", "fix", "sheet", "download")))
    if await _allowed(db, tenant, request, role, "trigger_sync"):
        for r in (await db.execute(text(
                "SELECT id::text AS id, name FROM sap_systems WHERE tenant_id = CAST(:t AS uuid) AND is_active "
                "ORDER BY name, id"), {"t": str(tenant.id)})).mappings().all():
            candidates.append(("trigger_sync", f"extract:{r['id']}", f"Extract {r['name']}", f"/systems?extract={r['id']}",
                               ("extract", "sync", "refresh", *r["name"].lower().split())))
    return [{"id": cid, "title": title, "href": href} for _perm, cid, title, href, kws in candidates
            if all(any(k.startswith(w) for k in kws) for w in words)]


@router.get("/command", response_model=CommandOut)
async def command(request: Request, q: str = Query("", max_length=200), limit: int = Query(20, ge=1, le=50),
                  db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
                  role: str = Depends(require_permission("view"))):
    """Search records, rules, objects, runs, people and actions. ``limit`` caps the items over all groups."""
    await _rls(db, tenant)
    q = q.strip()
    pairs = await current_pairs(db, tenant.id)
    n = min(GROUP_CAP, limit)
    found: dict[str, list[dict]] = {k: [] for k in GROUP_LABELS}
    if q:
        found["record"] = await _records(db, tenant, request, q, pairs, n)
        found["rule"] = await _rules(db, tenant, q, n)
        found["run"] = await _runs(db, tenant, q, n)
        found["person"] = await _people(db, tenant, q, n)
    found["object"] = await _objects(db, tenant, q, pairs, n)
    found["action"] = (await _actions(db, tenant, request, role, q))[:n]

    groups, left = [], limit
    for kind in ("record", "rule", "object", "run", "person", "action"):
        items = found[kind][:left]
        if items:
            groups.append({"kind": kind, "label": GROUP_LABELS[kind], "items": items})
            left -= len(items)
    return {"groups": groups}


class NLMatchOut(BaseModel):
    phrase: str
    slot: str
    value: str | bool
    label: str


class NLOut(BaseModel):
    filter: dict[str, str | bool]             # the parameters GET /work/records accepts
    href: str                                 # /v2/work with the filter in the query string
    explanation: str
    unmatched_words: list[str]
    matched: list[NLMatchOut]
    llm_used: bool = False


@router.get("/command/nl", response_model=NLOut)
async def command_nl(q: str = Query(..., min_length=1, max_length=300), db: AsyncSession = Depends(get_db),
                     tenant: Tenant = Depends(get_tenant), _role: str = Depends(require_permission("view"))):
    """A sentence to a ledger filter, by keyword and synonym tables (api/services/nl_query.py). With
    MERIDIAN_NL_LLM=1 and an LLM configured, words the tables do not know may be mapped onto the same closed
    vocabulary by the model; it never sees record data."""
    from api.services import nl_query

    await _rls(db, tenant)
    t = str(tenant.id)
    systems = [dict(r) for r in (await db.execute(text(
        "SELECT id::text AS id, name, system_type FROM sap_systems WHERE tenant_id = CAST(:t AS uuid) AND is_active "
        "ORDER BY name, id"), {"t": t})).mappings().all()]
    people = [dict(r) for r in (await db.execute(text(
        f"SELECT id::text AS id, name, email FROM users WHERE tenant_id = CAST(:t AS uuid) AND is_active "
        f"AND {NOT_SERVICE_USER_SQL.format(col='email')} ORDER BY name, id"), {"t": t})).mappings().all()]
    vocab = nl_query.tenant_vocab(systems, people)
    out = nl_query.parse(q, vocab)
    used = False
    if out["unmatched_words"] and nl_query.llm_enabled():
        mapped = nl_query.classify_unmatched(out["unmatched_words"], vocab)
        if mapped:
            used = True
            words = " ".join(mapped.get(w, w) for w in nl_query.words_of(q))
            out = nl_query.parse(words, vocab)
    return {**out, "href": nl_query.href(out["filter"]), "llm_used": used}
