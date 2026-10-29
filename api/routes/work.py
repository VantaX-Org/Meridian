"""Fix work: the steward work list read from work_groups / work_records (api/services/worklist.py).

  GET  /work/summary                       per object: records to fix, issues, by work status
  GET  /work/groups                        what fails, ranked: (check × object) with counts
  GET  /work/records                       failing records, worst first, keyset paged; each with its age and suggestion
  GET  /work/records/{module}/{key}        one record: every failing check, current and suggested value, status
  GET  /work/search                        a record by key or name, across objects
  POST /work/decide                        accept / edit / not an issue / undo / assign, for records
  POST /work/groups/{check_id}/accept-all  every machine-proposed value of a group, into my draft batch

Every decision is the existing machinery: a value goes into the user's draft fix batch
(remediation_items, four eyes on approval), a sign-off is a record_issues status with its event.
"""
import base64
import json
import re
import uuid
from typing import Literal, NamedTuple, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.middleware.cache import cached_json
from api.routes.record_issues import _rls
from api.routes.sync_trigger import module_label
from api.services import sandbox, undo, work_analytics, work_counts, worklist
from api.services.worklist import CLEANING_VALUE_MATCH
from api.services.current_state import current_pairs, pairs_clause, run_ids
from api.services.rbac import (Scope, _grants_allow, actions_for, current_user_id, current_user_label,
                               dev_role_override, grants_for, has_permission, require_permission)
from api.services.record_issues import scope_of
from api.services.run_context import latest_run

router = APIRouter(prefix="/api/v1/work", tags=["work"])

Status = Literal["to_fix", "proposed", "approved", "sent", "not_an_issue", "fixed"]
OPEN = ("to_fix", "proposed", "approved", "sent")
PAGE = 50
COUNT_CAP = 100_000
MAX_ACCEPT = 50_000
SEVERITIES = ("critical", "high", "medium", "low")
_SINCE_DESC = ("a baseline run id: only records failing a check they did not fail in that run (the monitor's new "
               "failing records); needs one run, not scope=current")


async def _run(db: AsyncSession, tenant: Tenant, version_id: Optional[uuid.UUID]) -> tuple[str, str]:
    """(run id, scope) of the requested run, else the latest; 404 when there is none."""
    vid = str(version_id) if version_id else await latest_run(db, tenant.id)
    if not vid:
        raise HTTPException(status_code=404, detail="No finished run yet.")
    meta = (await db.execute(text("SELECT metadata FROM analysis_versions WHERE id = CAST(:v AS uuid) "
                                  "AND tenant_id = :t"), {"v": vid, "t": str(tenant.id)})).fetchone()
    if not meta:
        raise HTTPException(status_code=404, detail="Run not found.")
    return vid, scope_of(meta[0] or {})


async def _built(db: AsyncSession, vid: str) -> bool:
    """True once the run's work list build finished (api/services/worklist.py build sets the marker last)."""
    return bool((await db.execute(text("SELECT metadata ? 'worklist_built_at' FROM analysis_versions "
                                       "WHERE id = CAST(:v AS uuid)"), {"v": vid})).scalar())


WorkScope = Literal["run", "current"]
_SCOPE = Query("run", description="current: every object at the latest complete run of its lineage (Home's scope), "
                                  "each read from its own run; exclusive with version_id")


class _Rows:
    """Which work rows a read covers: one run (``vid``), or the current state (``pairs``: each object once, with the
    run it is read from; api/services/current_state.py)."""

    def __init__(self, vid: Optional[str], scope: Optional[str], pairs: Optional[list[dict]]):
        self.vid, self.scope, self.pairs = vid, scope, pairs

    @property
    def current(self) -> bool:
        return self.pairs is not None

    def where(self, alias: str, p: dict) -> str:
        if self.pairs is not None:
            return pairs_clause(alias, self.pairs, p)
        p["v"] = self.vid
        return f"{alias}.version_id = CAST(:v AS uuid)"

    def version_of(self, module: str) -> Optional[str]:
        """The run a module is read from (the run itself for one run)."""
        if self.pairs is None:
            return self.vid
        return next((x["version_id"] for x in self.pairs if x["module"] == module), None)


async def _rows(db: AsyncSession, tenant: Tenant, version_id: Optional[uuid.UUID], scope: str) -> _Rows:
    """One run (the requested one, else the latest), or with ``scope=current`` the current state; 404 when the
    tenant has no finished run."""
    if scope == "current":
        if version_id is not None:
            raise HTTPException(status_code=422, detail="version_id and scope=current are exclusive")
        pairs = await current_pairs(db, tenant.id)
        if not pairs:
            raise HTTPException(status_code=404, detail="No finished run yet.")
        return _Rows(None, None, pairs)
    vid, rscope = await _run(db, tenant, version_id)
    return _Rows(vid, rscope, None)


def _auto_runs(sel: _Rows) -> str:
    """Findings of the runs ``sel`` reads (bound by ``sel.where``): the proposed values of a fix sheet."""
    return "f.version_id = ANY(CAST(:cv AS uuid[]))" if sel.current else "f.version_id = CAST(:v AS uuid)"


async def _unbuilt(db: AsyncSession, tenant: Tenant, rows: _Rows) -> list[str]:
    """The runs of ``rows`` whose work list is not built yet, newest first."""
    ids = run_ids(rows.pairs) if rows.pairs is not None else [rows.vid]
    return list((await db.execute(text(
        "SELECT id::text FROM analysis_versions WHERE tenant_id = :t AND id = ANY(CAST(:ids AS uuid[])) "
        "AND NOT (COALESCE(metadata, '{}'::jsonb) ? 'worklist_built_at') ORDER BY run_at DESC"),
        {"t": str(tenant.id), "ids": ids})).scalars().all())


# The oldest failing issue of a work record: its age (as _row_extras reports it as first_seen_at).
_FIRST_SEEN = """LEFT JOIN LATERAL (SELECT min(ri.first_seen_at) AS first_seen_at FROM record_issues ri
                    WHERE ri.tenant_id = CAST(:t AS uuid) AND ri.scope = w.scope AND ri.record_key = w.record_key
                      AND ri.check_id = ANY(w.checks)) fs ON true"""
# Sort keys of /work/records as never-null expressions, so one keyset comparison pages any order. Numeric keys are
# ascending expressions (a descending key is the negated expression); "age" descending is the oldest first. A record
# without the value (first-seen time, value at risk, due date, assignee) sorts last either way. Text keys (owner)
# cannot be negated: the descending form orders the same kind of expression DESC (_SORT_DIR) with the unassigned
# prefix flipped so they still come last.
_OWNER_TEXT = ("lower(COALESCE(NULLIF(u.name, ''), u.email, '')) || chr(1) || lower(COALESCE(u.email, ''))")
_SORT_KEYS = {
    ("severity", False): "w.sev_rank",
    ("severity", True): "-w.sev_rank",
    ("age", True): "COALESCE(EXTRACT(EPOCH FROM fs.first_seen_at)::float8, 'Infinity'::float8)",
    ("age", False): "COALESCE(-EXTRACT(EPOCH FROM fs.first_seen_at)::float8, 'Infinity'::float8)",
    ("value", False): "COALESCE(val.v, 'Infinity'::float8)",
    ("value", True): "COALESCE(-val.v, 'Infinity'::float8)",
    ("due", False): "COALESCE(EXTRACT(EPOCH FROM w.due_at)::float8, 'Infinity'::float8)",
    ("due", True): "COALESCE(-EXTRACT(EPOCH FROM w.due_at)::float8, 'Infinity'::float8)",
    ("owner", False): f"(CASE WHEN w.assigned_to IS NULL THEN '1' ELSE '0' || {_OWNER_TEXT} END) COLLATE \"C\"",
    ("owner", True): f"(CASE WHEN w.assigned_to IS NULL THEN '0' ELSE '1' || {_OWNER_TEXT} END) COLLATE \"C\"",
}
_SORT_DIR = {("owner", True): "DESC"}
_SORT_CAST = {"severity": "int", "age": "float8", "value": "float8", "due": "float8", "owner": "text"}
_SORT_NAMES = "severity, age, value, due and owner"
# The value at risk of a record, as the per-object export attributes it: each failing check's cost at risk shared
# over the records the check fails on, summed; null when none of its checks is priced (no cost model).
_VALUE_JOIN = """LEFT JOIN LATERAL (SELECT sum(vf.cost_at_risk::float8 / vf.affected_count)
                                       FILTER (WHERE vf.cost_at_risk IS NOT NULL AND vf.affected_count > 0) AS v
                                  FROM findings vf WHERE vf.tenant_id = w.tenant_id AND vf.version_id = w.version_id
                                   AND vf.check_id = ANY(w.checks)) val ON true"""


def _parse_sort(sort: Optional[str]) -> list[tuple[str, bool]]:
    """``severity,-age`` -> [("severity", False), ("age", True)]; a leading minus is descending. Default: severity."""
    keys: list[tuple[str, bool]] = []
    for part in (sort or "severity").split(","):
        part = part.strip()
        if not part:
            continue
        key = (part.lstrip("-"), part.startswith("-"))
        if key not in _SORT_KEYS:
            raise HTTPException(status_code=422, detail=f"sort takes {_SORT_NAMES}, each optionally with a leading minus; not {part!r}")
        if any(k == key[0] for k, _ in keys):
            continue
        keys.append(key)
    return keys or [("severity", False)]


def _cursor(sort: list[tuple[str, bool]], row) -> str:
    return base64.urlsafe_b64encode(json.dumps(
        [[f"{'-' if d else ''}{k}" for k, d in sort], [getattr(row, f"s{i}") for i in range(len(sort))],
         row.module, row.record_key]).encode()).decode()


def _uncursor(sort: list[tuple[str, bool]], c: str) -> tuple[list, str, str]:
    cast = {"int": int, "float8": float, "text": str}
    try:
        spec, values, module, key = json.loads(base64.urlsafe_b64decode(c.encode()))
        if spec != [f"{'-' if d else ''}{k}" for k, d in sort] or len(values) != len(sort):
            raise ValueError("cursor of another sort")
        return [cast[_SORT_CAST[k]](v) for (k, _), v in zip(sort, values)], str(module), str(key)
    except Exception:
        raise HTTPException(status_code=422, detail="after is not a cursor from this list")


def _after(order: list[tuple[str, bool]], exprs: list[str]) -> str:
    """The keyset condition: rows after the cursor (:as0.., :am, :ak) in the sort's order. One row comparison when every
    key ascends; else the same lexicographic comparison with each key's own direction."""
    marks = [f"CAST(:as{i} AS {_SORT_CAST[k]})" for i, (k, _) in enumerate(order)]
    dirs = [_SORT_DIR.get(key, "ASC") for key in order]
    if all(d == "ASC" for d in dirs):
        return f"({', '.join(exprs)}, w.module, w.record_key) > ({', '.join(marks)}, :am, :ak)"
    cols = list(zip([*exprs, "w.module", "w.record_key"], [*marks, ":am", ":ak"], [*dirs, "ASC", "ASC"]))
    ors = []
    for i, (e, m, d) in enumerate(cols):
        eq = [f"{x} = {y}" for x, y, _ in cols[:i]]
        ors.append("(" + " AND ".join([*eq, f"{e} {'<' if d == 'DESC' else '>'} {m}"]) + ")")
    return "(" + " OR ".join(ors) + ")"


@router.get("/summary")
async def summary(
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    module: Optional[str] = None,
    check_id: Optional[str] = None,
    severity: Optional[str] = Query(None, pattern="^(critical|high|medium|low|blocking)$"),
    status: Optional[str] = Query(None, pattern="^(open|all|to_fix|proposed|approved|sent|not_an_issue|fixed)$"),
    assigned: Optional[str] = Query(None, description="'me', 'unassigned' or a user id"),
    proposed: Optional[bool] = None,
    due: Optional[str] = Query(None, pattern="^(overdue|today)$"),
    part: Optional[str] = Query(None, max_length=200),
    system: Optional[str] = Query(None, max_length=100),
    q: Optional[str] = Query(None, max_length=200),
    since: Optional[uuid.UUID] = Query(None, description=_SINCE_DESC),
    scope: WorkScope = _SCOPE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    """Per object of the run (or, ``scope=current``, of the current state, each object from its own run): records
    and issues to fix, by work status, and its groups' size. ``unbuilt`` lists the runs whose work list is missing;
    ``built`` is false when no run read has one. With any of /work/records' filters, ``totals`` count the records
    that list shows (status defaults to open, as there) so the Fix work tiles follow the filters; ``objects`` follow
    module, check_id, severity and system only (every status), and stay unfiltered when none is passed."""
    await _rls(db, tenant)
    filters = {"version_id": version_id, "module": module, "check_id": check_id, "severity": severity, "status": status,
               "assigned": assigned, "proposed": proposed, "due": due, "part": part, "system": system, "q": q,
               "since": since, "scope": scope, "latest": await latest_run(db, tenant.id),
               # "me" is the caller: their own key
               "me": current_user_id(request) if assigned == "me" else None}

    async def produce() -> dict:
        return jsonable_encoder(await _summary(request, version_id, module, check_id, severity, status, assigned,
                                               proposed, due, part, system, q, since, scope, db, tenant))

    return await cached_json(SUMMARY_CACHE_PREFIX, "work_summary", tenant.id, filters, SUMMARY_TTL_SECONDS, produce)


SUMMARY_CACHE_PREFIX = "work"  # the landscape's prefix: one invalidation (mark_work_changed) drops both
SUMMARY_TTL_SECONDS = 30


class _SummaryRow(NamedTuple):
    module: str
    version_id: str
    status: str
    records: int
    issues: int
    critical: int
    proposed: int
    overdue: int


async def _summary(request: Request, version_id, module, check_id, severity, status, assigned, proposed, due, part,
                   system, q, since, scope, db: AsyncSession, tenant: Tenant) -> dict:
    sel = await _rows(db, tenant, version_id, scope)
    # objects follow module, check_id, severity and system when given (status, assignee and the rest stay off: the
    # chips count every status of the objects shown). work_counts (migration 108) answers every filter but check_id;
    # overdue (due_at < now()) is time-dependent, so it is always counted live, on the partial index of due records.
    owhere, p = _records_where(tenant, sel, request, module, check_id, severity, "all", None, None, None, None, None,
                               system)
    if check_id is None:
        cp: dict = {}
        cwhere = work_counts.where(sel, cp, module, severity, system)
        counted = (await db.execute(text(f"""
            SELECT c.module, c.version_id::text AS version_id, c.status, sum(c.count)::bigint AS records,
                   sum(c.issues_sum)::bigint AS issues,
                   COALESCE(sum(c.count) FILTER (WHERE c.severity = 'critical'), 0)::bigint AS critical,
                   sum(c.proposed_count)::bigint AS proposed
              FROM work_counts c WHERE {' AND '.join(cwhere)}
             GROUP BY c.module, c.version_id, c.status HAVING sum(c.count) <> 0"""),
            {**cp, "t": str(tenant.id)})).fetchall()
        overdue = {(r[0], r[1], r[2]): int(r[3]) for r in (await db.execute(text(f"""
            SELECT w.module, w.version_id::text, w.status, count(*) FROM work_records w
             WHERE {' AND '.join(owhere)} AND w.due_at < now() GROUP BY 1, 2, 3"""), p)).fetchall()}
        rows = [_SummaryRow(r.module, r.version_id, r.status, int(r.records), int(r.issues), int(r.critical),
                            int(r.proposed), overdue.get((r.module, r.version_id, r.status), 0)) for r in counted]
    else:
        rows = (await db.execute(text(f"""
            SELECT w.module, w.version_id::text AS version_id, w.status, count(*) AS records, sum(w.issues) AS issues,
                   count(*) FILTER (WHERE w.sev_rank = 0) AS critical, count(*) FILTER (WHERE w.proposed > 0) AS proposed,
                   count(*) FILTER (WHERE w.due_at < now()) AS overdue
              FROM work_records w WHERE {' AND '.join(owhere)}
             GROUP BY w.module, w.version_id, w.status"""), p)).fetchall()
    objects: dict[str, dict] = {}
    for r in rows:
        o = objects.setdefault(r.module, {"module": r.module, "version_id": r.version_id, "records": 0, "open": 0,
                                          "issues": 0, "critical": 0, "proposed": 0, "overdue": 0, "statuses": {}})
        o["records"] += r.records
        o["statuses"][r.status] = r.records
        if r.status in OPEN:
            o["open"] += r.records
            o["issues"] += int(r.issues or 0)
            o["critical"] += r.critical
            o["proposed"] += r.proposed
            o["overdue"] += r.overdue
    out = sorted(objects.values(), key=lambda o: (-o["critical"], -o["open"], o["module"]))
    unbuilt = await _unbuilt(db, tenant, sel)
    ids = run_ids(sel.pairs) if sel.pairs is not None else [sel.vid]
    totals = {k: sum(o[k] for o in out) for k in ("records", "open", "issues", "critical", "proposed", "overdue")}
    filters = (module, check_id, severity, status, assigned, proposed, due, part, system, q, since)
    if any(f is not None for f in filters):
        where, fp = _records_where(tenant, sel, request, module, check_id, severity, status or "open", assigned,
                                   proposed, q, due, part, system)
        await _since(db, tenant, sel, since, module, where, fp)
        if all(f is None for f in (check_id, assigned, proposed, due, part, q, since)):
            # module, severity, system and status only: work_counts, plus the live overdue count
            cp = {}
            cwhere = work_counts.where(sel, cp, module, severity, system, status or "open")
            c = (await db.execute(text(f"""
                SELECT COALESCE(sum(c.count), 0)::bigint AS records, COALESCE(sum(c.issues_sum), 0)::bigint AS issues,
                       COALESCE(sum(c.count) FILTER (WHERE c.severity = 'critical'), 0)::bigint AS critical,
                       COALESCE(sum(c.proposed_count), 0)::bigint AS proposed
                  FROM work_counts c WHERE {' AND '.join(cwhere)}"""), {**cp, "t": str(tenant.id)})).mappings().one()
            late = (await db.execute(text(f"SELECT count(*) FROM work_records w WHERE {' AND '.join(where)} "
                                          "AND w.due_at < now()"), fp)).scalar()
            f = {**c, "overdue": int(late or 0)}
        else:
            f = (await db.execute(text(f"""
                SELECT count(*) AS records, COALESCE(sum(w.issues), 0) AS issues,
                       count(*) FILTER (WHERE w.sev_rank = 0) AS critical, count(*) FILTER (WHERE w.proposed > 0) AS proposed,
                       count(*) FILTER (WHERE w.due_at < now()) AS overdue
                  FROM work_records w WHERE {' AND '.join(where)}"""), fp)).mappings().one()
        totals = {"records": int(f["records"]), "open": int(f["records"]), "issues": int(f["issues"]),
                  "critical": int(f["critical"]), "proposed": int(f["proposed"]), "overdue": int(f["overdue"])}
    return {"version_id": sel.vid, "scope": sel.scope, "mode": "current" if sel.current else "run",
            "version_ids": ids, "unbuilt": unbuilt, "built": len(unbuilt) < len(ids), "objects": out,
            "totals": totals}


@router.get("/groups")
async def groups(
    version_id: Optional[uuid.UUID] = None,
    module: Optional[str] = None,
    severity: Optional[str] = Query(None, pattern="^(critical|high|medium|low|blocking)$", description="blocking = critical or high"),
    proposed: Optional[bool] = Query(None, description="only groups with machine-proposed values"),
    q: Optional[str] = Query(None, max_length=200),
    limit: int = Query(200, ge=1, le=1000),
    scope: WorkScope = _SCOPE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    """What fails in the run (or the current state), worst first: one row per check, with its records by work
    status and the run it was found in."""
    await _rls(db, tenant)
    sel = await _rows(db, tenant, version_id, scope)
    p: dict = {"t": str(tenant.id), "limit": limit}
    where = ["work_groups.tenant_id = :t", sel.where("work_groups", p)]
    if module:
        where.append("module = :m")
        p["m"] = module
    if severity == "blocking":
        where.append("sev_rank <= 1")
    elif severity:
        where.append("severity = :s")
        p["s"] = severity
    if proposed:
        where.append("proposed > 0")
    if q:
        where.append("(check_id ILIKE :q OR message ILIKE :q OR field ILIKE :q)")
        p["q"] = f"%{q}%"
    rows = (await db.execute(text(f"""
        SELECT check_id, module, version_id::text AS version_id, severity, dimension, message, field, records,
               population, proposed, truncated, statuses
          FROM work_groups WHERE {' AND '.join(where)}
         ORDER BY sev_rank, records DESC, check_id LIMIT :limit"""), p)).mappings().all()
    total = (await db.execute(text(f"SELECT count(*) FROM work_groups WHERE {' AND '.join(where)}"), p)).scalar()
    if sel.current:  # as /work/summary: built once any run read has its work list
        built = len(await _unbuilt(db, tenant, sel)) < len(run_ids(sel.pairs))
    else:
        built = await _built(db, sel.vid)
    return {"version_id": sel.vid, "built": built, "total": int(total or 0),
            "groups": [{**dict(r), "open": sum(int((r["statuses"] or {}).get(s, 0)) for s in OPEN)} for r in rows]}


def _records_where(tenant: Tenant, sel: "_Rows | str", request: Request, module, check_id, severity, status, assigned,
                   proposed, q, due=None, part=None, system=None, batch_id=None) -> tuple[list[str], dict]:
    """``sel``: the rows read (one run or the current state), or one run's id."""
    if isinstance(sel, str):
        sel = _Rows(sel, None, None)
    p: dict = {"t": str(tenant.id)}
    where = ["w.tenant_id = :t", sel.where("w", p)]
    if module:
        where.append("w.module = :m")
        p["m"] = module
    if check_id:
        where.append("w.checks @> ARRAY[CAST(:c AS text)]")
        p["c"] = check_id
    if severity == "blocking":  # critical or high: what blocks SAP processes and the load
        where.append("w.sev_rank <= 1")
    elif severity:
        where.append("w.sev_rank = :sr")
        p["sr"] = SEVERITIES.index(severity)
    if system:
        where.append("w.scope = :sys")
        p["sys"] = system
    if batch_id:  # the records with an item in this fix batch, in any state of the batch
        where.append("EXISTS (SELECT 1 FROM remediation_items bi WHERE bi.tenant_id = w.tenant_id "
                     "AND bi.batch_id = CAST(:bid AS uuid) AND bi.scope = w.scope AND bi.module = w.module "
                     "AND bi.record_key = w.record_key AND bi.check_id = ANY(w.checks))")
        p["bid"] = str(batch_id)
    if status == "all":
        pass
    elif status == "open":
        where.append("w.status = ANY(:st)")
        p["st"] = list(OPEN)
    elif status:
        where.append("w.status = :st")
        p["st"] = status
    if assigned == "me":
        where.append("w.assigned_to = CAST(:a AS uuid)")
        p["a"] = current_user_id(request)
    elif assigned == "unassigned":
        where.append("w.assigned_to IS NULL")
    elif assigned:
        where.append("w.assigned_to = CAST(:a AS uuid)")
        p["a"] = assigned
    if proposed:
        where.append("w.proposed > 0")
    if part:  # one part of the key, e.g. BUKRS=1000: the records of one company code, plant, sales org
        field, _, value = part.partition("=")
        if not field or not value or not field.replace("_", "").isalnum():
            raise HTTPException(status_code=422, detail="part must look like FIELD=VALUE, e.g. BUKRS=1000")
        where.append("w.record_key ~ :part")
        p["part"] = rf"(^|\|){field.upper()}=0*{re.escape(value.lstrip('0') or '0')}($|\|)"
    if due == "overdue":
        where.append("w.due_at < now()")
    elif due == "today":
        where.append("w.due_at < now() + interval '1 day'")
    if q:
        term = q.strip()
        if "=" in term:  # a key as the record shows it: LIFNR=0000100234
            where.append("w.record_key LIKE :qk")
            p["qk"] = term.replace("%", r"\%").replace("_", r"\_") + "%"
        else:  # a name, or a key value with or without its leading zeros
            where.append("(lower(w.name) LIKE :qn OR w.record_key ~ :qr)")
            p["qn"] = term.lower().replace("%", r"\%").replace("_", r"\_") + "%"
            p["qr"] = r"(^|\|)[A-Z0-9_]+=0*" + "".join("\\" + ch if not ch.isalnum() else ch for ch in term.lstrip("0")) + r"($|\|)"
    return where, p


# The checks both runs evaluated in full: the ones the run compare (DIFF_SQL) counts, so "new" here is "new" there.
_COMPARABLE_SQL = """
    SELECT f2.check_id FROM findings f2
      JOIN findings f1 ON f1.version_id = CAST(:since AS uuid) AND f1.check_id = f2.check_id
     WHERE f2.version_id = CAST(:v AS uuid) AND f2.tenant_id = CAST(:t AS uuid) AND f1.tenant_id = f2.tenant_id
       AND f1.details->>'error' IS NULL AND f2.details->>'error' IS NULL
       AND NOT COALESCE((f1.details->>'failing_keys_truncated')::boolean, false)
       AND NOT COALESCE((f2.details->>'failing_keys_truncated')::boolean, false)
       AND (CAST(:m AS text) IS NULL OR f2.module = CAST(:m AS text))
"""


async def _since(db: AsyncSession, tenant: Tenant, sel: _Rows, since: Optional[uuid.UUID], module: Optional[str],
                 where: list[str], p: dict) -> None:
    """Narrow ``where`` to the records of the run that fail a check they did not fail in run ``since``.

    Read from ``finding_records`` of both runs, whose primary key (version_id, check_id, record_key) makes each probe
    an index lookup: the failing keys of the run's comparable checks, minus the baseline's. It never reads
    ``work_records`` beyond the rows the other filters leave, and never the findings' payloads."""
    if since is None:
        return
    if sel.current or not sel.vid:
        raise HTTPException(status_code=422, detail="since compares one run: pass version_id, not scope=current")
    known = (await db.execute(text("SELECT 1 FROM analysis_versions WHERE id = :s AND tenant_id = :t"),
                              {"s": since, "t": str(tenant.id)})).scalar()
    if not known:
        raise HTTPException(status_code=404, detail="Baseline run not found.")
    checks = list((await db.execute(text(_COMPARABLE_SQL), {"since": str(since), "v": sel.vid, "t": str(tenant.id),
                                                            "m": module})).scalars().all())
    if str(since) == sel.vid or not checks:
        where.append("FALSE")
        return
    where.append("""EXISTS (SELECT 1 FROM finding_records fr
                     WHERE fr.version_id = w.version_id AND fr.check_id = ANY(CAST(:since_checks AS text[]))
                       AND fr.record_key = w.record_key AND fr.module = w.module
                       AND NOT EXISTS (SELECT 1 FROM finding_records b WHERE b.version_id = CAST(:since AS uuid)
                                         AND b.check_id = fr.check_id AND b.record_key = fr.record_key))""")
    p.update(since=str(since), since_checks=checks)


@router.get("/records")
async def records(
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    module: Optional[str] = None,
    check_id: Optional[str] = None,
    severity: Optional[str] = Query(None, pattern="^(critical|high|medium|low|blocking)$", description="blocking = critical or high"),
    status: Optional[str] = Query("open", pattern="^(open|all|to_fix|proposed|approved|sent|not_an_issue|fixed)$"),
    assigned: Optional[str] = Query(None, description="'me', 'unassigned' or a user id"),
    proposed: Optional[bool] = None,
    due: Optional[str] = Query(None, pattern="^(overdue|today)$", description="SLA: past due, or due within a day"),
    part: Optional[str] = Query(None, max_length=200, description="a key part, FIELD=VALUE (BUKRS=1000)"),
    system: Optional[str] = Query(None, max_length=100, description="source system id, or 'upload'"),
    batch_id: Optional[uuid.UUID] = Query(None, description="only the records with an item in this fix batch, in any state"),
    q: Optional[str] = Query(None, max_length=200),
    after: Optional[str] = Query(None, description="cursor from the previous page"),
    limit: int = Query(PAGE, ge=1, le=500),
    sort: Optional[str] = Query(None, max_length=80, description="severity, age, value (value at risk), due and/or owner, comma "
                                                                 "separated, a leading minus for descending (-age: the oldest first, "
                                                                 "-value: the most at risk first); default severity"),
    since: Optional[uuid.UUID] = Query(None, description=_SINCE_DESC),
    scope: WorkScope = _SCOPE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    """Failing records of the run (or the current state), worst first unless ``sort`` says otherwise, a page at a time
    (keyset over the sort, then module and record key: no deep OFFSET at millions, and no page reorders the ones before
    it). Each record names the run it was found in (``version_id``): the run its decisions go to."""
    await _rls(db, tenant)
    sel = await _rows(db, tenant, version_id, scope)
    order = _parse_sort(sort)
    where, p = _records_where(tenant, sel, request, module, check_id, severity, status, assigned, proposed, q, due, part,
                              system, batch_id)
    await _since(db, tenant, sel, since, module, where, p)
    exprs = [_SORT_KEYS[k] for k in order]
    page_where = list(where)
    if after:
        values, mod, key = _uncursor(order, after)
        page_where.append(_after(order, exprs))
        p.update({f"as{i}": v for i, v in enumerate(values)}, am=mod, ak=key)
    rows = (await db.execute(text(f"""
        SELECT w.module, w.version_id::text AS version_id, w.record_key, w.name, w.issues, w.sev_rank, w.checks,
               w.proposed, w.status, w.due_at, w.assigned_to, u.email AS assignee_email, g.message AS top_message, g.field AS top_field,
               {', '.join(f"{e} AS s{i}" for i, e in enumerate(exprs))}
          FROM work_records w
          {_FIRST_SEEN if any(k == "age" for k, _ in order) else ""}
          {_VALUE_JOIN if any(k == "value" for k, _ in order) else ""}
          LEFT JOIN users u ON u.id = w.assigned_to
          LEFT JOIN work_groups g ON g.version_id = w.version_id AND g.check_id = w.checks[1]
         WHERE {' AND '.join(page_where)}
         ORDER BY {', '.join(f"{e} {_SORT_DIR.get(k, 'ASC')}" for e, k in zip(exprs, order))}, w.module, w.record_key
         LIMIT :lim"""), {**p, "lim": limit + 1})).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    extra = await _row_extras(db, tenant, rows)
    fields = await _row_fields(db, tenant, request, rows)
    total = (await db.execute(text(f"SELECT count(*) FROM (SELECT 1 FROM work_records w WHERE {' AND '.join(where)} "
                                   f"LIMIT {COUNT_CAP + 1}) x"), p)).scalar() or 0
    return {
        "version_id": sel.vid, "total": min(total, COUNT_CAP), "total_capped": total > COUNT_CAP,
        "next": _cursor(order, rows[-1]) if more and rows else None,
        "items": [{"module": r.module, "version_id": r.version_id, "record_key": r.record_key, "name": r.name, "issues": r.issues,
                   "severity": SEVERITIES[r.sev_rank] if r.sev_rank < 4 else "info", "checks": list(r.checks),
                   "proposed": r.proposed, "status": r.status,
                   "due_at": r.due_at.isoformat() if r.due_at else None,
                   "assigned_to": str(r.assigned_to) if r.assigned_to else None, "assignee_email": r.assignee_email,
                   "top_message": r.top_message, "top_field": r.top_field,
                   **extra.get((r.version_id, r.module, r.record_key), {"first_seen_at": None, "suggested_value": None}),
                   **fields.get((r.version_id, r.module, r.record_key), _NO_FIELDS)}
                  for r in rows],
    }


async def _row_extras(db: AsyncSession, tenant: Tenant, rows) -> dict[tuple[str, str, str], dict]:
    """Per row of one page, keyed (version_id, module, record_key): when the oldest of its failing issues was first seen (the
    record's age) and the first suggested value of its checks in check order (the rule's own fix for the record,
    else the rule's fix for its current value: the values ``proposed`` counts). Read for the page only."""
    if not rows:
        return {}
    keys = {"t": str(tenant.id), "kv": [r.version_id for r in rows], "km": [r.module for r in rows],
            "kk": [r.record_key for r in rows]}
    out = (await db.execute(text("""
        WITH k AS (SELECT * FROM unnest(CAST(:kv AS uuid[]), CAST(:km AS text[]), CAST(:kk AS text[]))
                                 AS k(version_id, module, record_key)),
             pw AS (SELECT w.* FROM work_records w JOIN k USING (version_id, module, record_key)),
             auto AS (SELECT f.version_id, f.check_id, e->>'record_key' AS record_key, e->>'proposed_value' AS value
                        FROM findings f, jsonb_array_elements(CASE WHEN jsonb_typeof(f.record_fixes) = 'array'
                                                                   THEN f.record_fixes ELSE '[]'::jsonb END) e
                       WHERE (f.version_id, f.check_id) IN (SELECT version_id, unnest(checks) FROM pw WHERE proposed > 0)
                         AND e->>'proposed_value' IS NOT NULL AND e->>'record_key' = ANY(CAST(:kk AS text[])))
        SELECT w.version_id::text AS version_id, w.module, w.record_key,
               (SELECT min(ri.first_seen_at) FROM record_issues ri
                 WHERE ri.tenant_id = CAST(:t AS uuid) AND ri.scope = w.scope AND ri.record_key = w.record_key
                   AND ri.check_id = ANY(w.checks)) AS first_seen_at,
               CASE WHEN w.proposed > 0 THEN (
                 SELECT COALESCE(a.value, CASE WHEN jsonb_typeof(f.value_fix_map) = 'object' THEN
                          f.value_fix_map -> (fr.field_values ->> (f.details->>'field_checked')) ->> 'suggested_value' END, cl.value)
                   FROM unnest(w.checks) WITH ORDINALITY c(check_id, n)
                   JOIN findings f ON f.version_id = w.version_id AND f.check_id = c.check_id
                   LEFT JOIN finding_records fr ON fr.version_id = w.version_id AND fr.check_id = c.check_id
                                               AND fr.module = w.module AND fr.record_key = w.record_key
                   LEFT JOIN auto a ON a.version_id = w.version_id AND a.check_id = c.check_id
                                   AND a.record_key = w.record_key
                   LEFT JOIN LATERAL (SELECT COALESCE(cq.record_data_after ->> (f.details->>'field_checked'),
                                                      cq.record_data_after ->> substring(f.details->>'field_checked' from '[^.]*$')) AS value
                                        FROM cleaning_queue cq
                                       WHERE """ + CLEANING_VALUE_MATCH + """ ORDER BY cq.detected_at DESC LIMIT 1) cl ON true
                  WHERE COALESCE(a.value, CASE WHEN jsonb_typeof(f.value_fix_map) = 'object' THEN
                          f.value_fix_map -> (fr.field_values ->> (f.details->>'field_checked')) ->> 'suggested_value' END, cl.value)
                        IS NOT NULL
                  ORDER BY c.n LIMIT 1) END AS suggested_value
          FROM pw w"""), keys)).fetchall()
    return {(r.version_id, r.module, r.record_key): {
        "first_seen_at": r.first_seen_at.isoformat() if r.first_seen_at else None,
        "suggested_value": r.suggested_value} for r in out}


def _field_value(check) -> Optional[str]:
    """A failing check's field value in the record: stored under TABLE.FIELD or the bare field name."""
    if not check:
        return None
    fv = check["field_values"] or {}
    field = check["field"]
    value = fv[field] if field in fv else fv.get(field.rpartition(".")[2])
    return None if value is None else str(value)


_NO_FIELDS = {"value_at_risk": None, "current_value": None, "field_description": None, "possible_values": None,
              "possible_values_total": None, "new_value": None, "resolution": None, "batch_id": None, "batch_name": None,
              "resolution_note": None, "resolved_by": None, "resolved_at": None}


async def _row_fields(db: AsyncSession, tenant: Tenant, request: Request, rows) -> dict[tuple[str, str, str], dict]:
    """The readable fields of one page of rows, keyed (version_id, module, record_key), from one batched read of the
    page's failing checks (no query per row): the value at risk (each check's cost at risk shared over the records it
    fails on, summed, as the per-object export attributes it; None when no check is priced), the first failing field's
    current value, description and the rule's possible values (api/services/fix_sheet.py, as the fix sheet writes
    them), the value waiting in the user's draft batch for a proposed record, and the sign-off's resolution."""
    if not rows:
        return {}
    from api.services import fix_sheet as fs

    keys = {"t": str(tenant.id), "kv": [r.version_id for r in rows], "km": [r.module for r in rows],
            "kk": [r.record_key for r in rows]}
    checks = (await db.execute(text("""
        WITH k AS (SELECT * FROM unnest(CAST(:kv AS uuid[]), CAST(:km AS text[]), CAST(:kk AS text[]))
                                 AS k(version_id, module, record_key))
        SELECT w.version_id::text AS version_id, w.module, w.record_key, c.check_id, f.details->>'field_checked' AS field,
               fr.field_values, f.module AS rule_module,
               COALESCE(NULLIF(f.rule_context->'valid_values_with_labels', 'null'::jsonb),
                        NULLIF(f.rule_context->'valid_values', 'null'::jsonb)) AS valid_values,
               f.affected_count, f.cost_at_risk
          FROM work_records w JOIN k USING (version_id, module, record_key)
          CROSS JOIN LATERAL unnest(w.checks) WITH ORDINALITY c(check_id, n)
          JOIN findings f ON f.tenant_id = w.tenant_id AND f.version_id = w.version_id AND f.check_id = c.check_id
          LEFT JOIN finding_records fr ON fr.version_id = w.version_id AND fr.check_id = c.check_id
                                      AND fr.module = w.module AND fr.record_key = w.record_key
         WHERE w.tenant_id = CAST(:t AS uuid)
         ORDER BY w.version_id, w.module, w.record_key, c.n"""), keys)).mappings().all()
    by_row: dict[tuple[str, str, str], list] = {}
    for c in checks:
        by_row.setdefault((c["version_id"], c["module"], c["record_key"]), []).append(c)

    uid = current_user_id(request)
    drafts: dict[tuple[str, str, str], str] = {}
    proposed = [r for r in rows if r.status == "proposed"]
    if proposed and uid:
        for d in (await db.execute(text("""
            SELECT DISTINCT ON (w.version_id, w.module, w.record_key) w.version_id::text AS version_id, w.module,
                   w.record_key, i.proposed_value
              FROM work_records w
              JOIN remediation_items i ON i.tenant_id = w.tenant_id AND i.scope = w.scope AND i.module = w.module
                                      AND i.record_key = w.record_key AND i.check_id = ANY(w.checks)
              JOIN remediation_batches b ON b.id = i.batch_id AND b.tenant_id = i.tenant_id
             WHERE w.tenant_id = CAST(:t AS uuid) AND b.status = 'draft' AND b.created_by = CAST(:u AS uuid)
               AND i.proposed_value IS NOT NULL
               AND (w.version_id, w.module, w.record_key) IN (SELECT * FROM unnest(CAST(:kv AS uuid[]),
                       CAST(:km AS text[]), CAST(:kk AS text[])))
             ORDER BY w.version_id, w.module, w.record_key, i.updated_at DESC"""), {**keys, "u": uid})).mappings().all():
            drafts[(d["version_id"], d["module"], d["record_key"])] = d["proposed_value"]
    resolutions: dict[tuple[str, str, str], dict] = {}
    signed = [r for r in rows if r.status == "not_an_issue"]
    if signed:
        for d in (await db.execute(text("""
            SELECT DISTINCT ON (w.version_id, w.module, w.record_key) w.version_id::text AS version_id, w.module,
                   w.record_key, ri.resolution, ri.resolved_at, e.note, COALESCE(NULLIF(u.name, ''), e.user_label) AS by
              FROM work_records w
              JOIN record_issues ri ON ri.tenant_id = w.tenant_id AND ri.scope = w.scope AND ri.record_key = w.record_key
                                   AND ri.check_id = ANY(w.checks) AND ri.resolution IN ('false_positive', 'accepted_risk')
              LEFT JOIN LATERAL (SELECT ev.note, ev.user_id, ev.user_label FROM record_issue_events ev
                                  WHERE ev.issue_id = ri.id AND ev.tenant_id = ri.tenant_id AND ev.action = 'status'
                                    AND ev.to_value = 'accepted' ORDER BY ev.created_at DESC LIMIT 1) e ON true
              LEFT JOIN users u ON u.id = e.user_id AND u.tenant_id = ri.tenant_id
             WHERE w.tenant_id = CAST(:t AS uuid) AND w.status = 'not_an_issue'
               AND (w.version_id, w.module, w.record_key) IN (SELECT * FROM unnest(CAST(:kv AS uuid[]),
                       CAST(:km AS text[]), CAST(:kk AS text[])))
             ORDER BY w.version_id, w.module, w.record_key, ri.updated_at DESC NULLS LAST"""), keys)).mappings().all():
            resolutions[(d["version_id"], d["module"], d["record_key"])] = dict(d)

    # the fix batch a record's proposed value sits in: one read of the page, the item changed last
    batches: dict[tuple[str, str, str], dict] = {}
    for d in (await db.execute(text("""
        SELECT DISTINCT ON (w.version_id, w.module, w.record_key) w.version_id::text AS version_id, w.module, w.record_key,
               b.id::text AS batch_id, b.name AS batch_name
          FROM work_records w
          JOIN remediation_items i ON i.tenant_id = w.tenant_id AND i.scope = w.scope AND i.module = w.module
                                  AND i.record_key = w.record_key AND i.check_id = ANY(w.checks)
          JOIN remediation_batches b ON b.id = i.batch_id AND b.tenant_id = i.tenant_id
         WHERE w.tenant_id = CAST(:t AS uuid)
           AND (w.version_id, w.module, w.record_key) IN (SELECT * FROM unnest(CAST(:kv AS uuid[]),
                   CAST(:km AS text[]), CAST(:kk AS text[])))
         ORDER BY w.version_id, w.module, w.record_key, (i.proposed_value IS NOT NULL) DESC, i.updated_at DESC, b.id"""), keys)).mappings().all():
        batches[(d["version_id"], d["module"], d["record_key"])] = dict(d)

    out: dict[tuple[str, str, str], dict] = {}
    for r in rows:
        key = (r.version_id, r.module, r.record_key)
        mine = by_row.get(key, [])
        sign = resolutions.get(key) if r.status == "not_an_issue" else None
        priced = [float(c["cost_at_risk"]) / c["affected_count"] for c in mine
                  if c["cost_at_risk"] is not None and (c["affected_count"] or 0) > 0]
        first = next((c for c in mine if c["field"]), None)  # the only failing field, else the first in check order
        allowed = _allowed_values(first["valid_values"], first["rule_module"], first["check_id"], limit=None) if first else None
        out[key] = {
            "value_at_risk": round(sum(priced), 2) if priced else None,
            "current_value": _field_value(first),
            "field_description": fs.field_label(first["field"]) if first else None,
            "possible_values": allowed[:fs.POSSIBLE_VALUES_SHOWN] if allowed else None,
            "possible_values_total": len(allowed) if allowed else None,
            "new_value": drafts.get(key) if r.status == "proposed" else None,
            "resolution": sign["resolution"] if sign else None,
            "batch_id": batches[key]["batch_id"] if key in batches else None,
            "batch_name": batches[key]["batch_name"] if key in batches else None,
            "resolution_note": sign["note"] if sign else None,
            "resolved_by": sign["by"] if sign else None,
            "resolved_at": sign["resolved_at"].isoformat() if sign and sign["resolved_at"] else None,
        }
    return out


@router.get("/search")
async def search(
    request: Request,
    q: str = Query(..., min_length=1, max_length=200),
    version_id: Optional[uuid.UUID] = None,
    scope: WorkScope = _SCOPE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    """A failing record by key or name across every object of the run or the current state (the top bar's search)."""
    await _rls(db, tenant)
    sel = await _rows(db, tenant, version_id, scope)
    where, p = _records_where(tenant, sel, request, None, None, None, None, None, None, q)
    rows = (await db.execute(text(f"""
        SELECT w.module, w.version_id::text AS version_id, w.record_key, w.name, w.issues, w.sev_rank, w.status
          FROM work_records w
         WHERE {' AND '.join(where)} ORDER BY w.sev_rank, w.module, w.record_key LIMIT 20"""), p)).fetchall()
    return {"version_id": sel.vid, "items": [{"module": r.module, "version_id": r.version_id,
                                              "record_key": r.record_key, "name": r.name,
                                          "issues": r.issues, "status": r.status,
                                          "severity": SEVERITIES[r.sev_rank] if r.sev_rank < 4 else "info"}
                                         for r in rows]}


async def _cleaning_rows(db: AsyncSession, p: dict) -> list:
    """The record's open cleaning-engine proposals (p: t, m, k)."""
    return (await db.execute(text("""
        SELECT record_data_after, confidence, check_id, field FROM cleaning_queue
         WHERE tenant_id = :t AND object_type = :m AND record_key = :k AND status IN ('detected', 'pending', 'approved')
           AND record_data_after IS NOT NULL AND record_data_after <> '{}'::jsonb
           AND COALESCE(NULLIF(merge_preview, 'null'::jsonb), '{}'::jsonb) = '{}'::jsonb  -- duplicate proposals are not values
         ORDER BY detected_at DESC LIMIT 5"""), p)).mappings().all()


def _cleaning_value(cleaning: list, field: Optional[str], check_id: str) -> Optional[tuple[str, str]]:
    """(value, confidence) a cleaning proposal gives ``field`` for this check, the record panel's and decide's one
    rule: the full TABLE.FIELD or the bare field, from a proposal for this check or for none."""
    bare = field.split(".")[-1] if field else None
    for c in cleaning:
        after = c["record_data_after"] or {}
        hit = after.get(field) if field in after else after.get(bare) if bare else None
        if hit is not None and c["check_id"] in (None, check_id):
            conf = float(c["confidence"] or 0)
            return str(hit), "high" if conf >= 85 or 0.85 <= conf <= 1 else "medium"
    return None


def _value_fix(vfm: Optional[dict], current: Optional[str]) -> Optional[dict]:
    if not vfm or current is None:
        return None
    hit = vfm.get(current)
    return hit if isinstance(hit, dict) else None


@router.get("/records/{module}/{record_key:path}")
async def record(
    module: str,
    record_key: str,
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("view")),
):
    """One record: every check it fails in the run, the field, its current value, the suggested value and
    where it comes from, the issue's status and history, and what the user may do."""
    await _rls(db, tenant)
    vid, scope = await _run(db, tenant, version_id)
    p = {"t": str(tenant.id), "v": vid, "m": module, "k": record_key, "scope": scope}
    head = (await db.execute(text("""
        SELECT w.name, w.issues, w.sev_rank, w.status, w.assigned_to, u.email AS assignee_email
          FROM work_records w LEFT JOIN users u ON u.id = w.assigned_to
         WHERE w.tenant_id = :t AND w.version_id = CAST(:v AS uuid) AND w.module = :m AND w.record_key = :k"""),
        p)).fetchone()
    rows = (await db.execute(text("""
        SELECT fr.check_id, fr.field_values, fr.grain, f.severity, f.dimension, f.details->>'message' AS message,
               f.details->>'field_checked' AS field, f.remediation_text, f.value_fix_map,
               f.rule_context->>'why_it_matters' AS why, f.rule_context->>'sap_impact' AS impact,
               (SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.record_fixes) = 'array' THEN f.record_fixes ELSE '[]'::jsonb END) e
                 WHERE e->>'record_key' = fr.record_key LIMIT 1) AS record_fix,
               ri.id AS issue_id, ri.status AS issue_status, ri.resolution, ri.steward_verdict, ri.first_seen_at,
               ri.reopened_count, ri.due_at, ri.sla_state,
               f.affected_count, f.total_count, f.pass_rate, f.cost_at_risk, f.module AS rule_module,
               f.rule_context->'valid_values_with_labels' AS valid_values, f.rule_context->>'rule_authority' AS authority,
               (SELECT g.records FROM work_groups g WHERE g.version_id = fr.version_id AND g.check_id = fr.check_id)
                 AS group_records,
               rem.batch_id, rem.batch_status, rem.batch_name, rem.proposed_value AS decided_value,
               rem.proposal_source AS decided_source, rem.updated_at AS decided_at, rem.recon_status
          FROM finding_records fr
          JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
          LEFT JOIN record_issues ri ON ri.tenant_id = fr.tenant_id AND ri.scope = :scope
                                    AND ri.check_id = fr.check_id AND ri.record_key = fr.record_key
          LEFT JOIN LATERAL (
                SELECT i.batch_id, b.status AS batch_status, b.name AS batch_name, i.proposed_value,
                       i.proposal_source, i.updated_at, i.recon_status
                  FROM remediation_items i JOIN remediation_batches b ON b.id = i.batch_id
                 WHERE i.tenant_id = fr.tenant_id AND i.scope = :scope AND i.check_id = fr.check_id
                   AND i.record_key = fr.record_key
                 ORDER BY i.updated_at DESC LIMIT 1) rem ON true
         WHERE fr.version_id = CAST(:v AS uuid) AND fr.module = :m AND fr.record_key = :k
         ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  fr.check_id"""), p)).mappings().all()
    if not rows:
        raise HTTPException(status_code=404, detail="This record does not fail any check in this run.")
    cleaning = await _cleaning_rows(db, p)

    rule_rows = await _tenant_rules(db, tenant, module, sorted({r["check_id"] for r in rows}))
    values: dict = {}
    issues = []
    described: dict[str, str] = {}  # TABLE.FIELD -> the field's description
    for r in rows:
        fv = r["field_values"] or {}
        for name in [*fv, r["field"]]:
            if name:
                full = name if "." in name else f"{r['grain']}.{name}" if r["grain"] else name
                described.setdefault(full, fs_field_label(full))
        values.update({k: v for k, v in fv.items() if k not in values})
        field = r["field"]
        current = fv.get(field) if field else None
        current = None if current is None else str(current)
        rf = r["record_fix"] or {}
        vf = _value_fix(r["value_fix_map"], current)
        suggestion = None
        if rf.get("proposed_value") is not None:
            suggestion = {"value": rf["proposed_value"], "source": "rule", "confidence": rf.get("confidence"),
                          "why": rf.get("fix_instruction")}
        elif vf and vf.get("suggested_value") is not None:
            suggestion = {"value": vf["suggested_value"], "source": "value_map", "confidence": None,
                          "why": vf.get("fix_instruction")}
        elif (hit := _cleaning_value(cleaning, field, r["check_id"])) is not None:
            suggestion = {"value": hit[0], "source": "cleaning", "confidence": hit[1],
                          "why": "Proposed by the cleaning engine"}
        status = ("fixed" if r["issue_status"] == "resolved" else "not_an_issue" if r["issue_status"] == "accepted"
                  else "to_fix" if r["recon_status"] == "still_failing"
                  else "sent" if r["batch_status"] == "exported" else "approved" if r["batch_status"] == "approved"
                  else "proposed" if r["batch_status"] == "draft" and r["decided_value"] is not None else "to_fix")
        failing = r["group_records"] if r["group_records"] is not None else (r["affected_count"] or 0)
        population = r["total_count"] or None
        issues.append({
            "rule": _rule_meta(r, rule_rows.get(r["check_id"])),
            "others_failing": max(int(failing) - 1, 0),
            "failing": int(failing), "population": population,
            "pass_rate": _pass_rate(r["pass_rate"], failing, population),
            "allowed_values": _allowed_values(r["valid_values"], r["rule_module"], r["check_id"]),
            "check_id": r["check_id"], "severity": r["severity"], "dimension": r["dimension"],
            "message": r["message"] or r["check_id"], "field": field, "current_value": current,
            "instruction": rf.get("fix_instruction") or (vf or {}).get("fix_instruction") or r["remediation_text"],
            "why_it_matters": r["why"], "sap_impact": r["impact"], "suggestion": suggestion, "status": status,
            "issue_id": str(r["issue_id"]) if r["issue_id"] else None, "resolution": r["resolution"],
            "first_seen_at": r["first_seen_at"].isoformat() if r["first_seen_at"] else None,
            "reopened_count": r["reopened_count"] or 0,
            "due_at": r["due_at"].isoformat() if r["due_at"] else None, "sla_state": r["sla_state"],
            "decision": None if r["batch_id"] is None else {
                "batch_id": str(r["batch_id"]), "batch_status": r["batch_status"], "batch_name": r["batch_name"],
                "value": r["decided_value"], "source": r["decided_source"], "still_failing": r["recon_status"] == "still_failing",
                "at": r["decided_at"].isoformat() if r["decided_at"] else None},
        })
    events = []
    ids = [i["issue_id"] for i in issues if i["issue_id"]]
    if ids:
        events = [dict(e) for e in (await db.execute(text("""
            SELECT e.action, e.from_value, e.to_value, e.note, e.user_label, e.created_at, ri.check_id
              FROM record_issue_events e JOIN record_issues ri ON ri.id = e.issue_id
             WHERE e.issue_id = ANY(CAST(:ids AS uuid[])) ORDER BY e.created_at DESC LIMIT 50"""),
            {"ids": ids})).mappings().all()]
        for e in events:
            e["created_at"] = e["created_at"].isoformat() if e["created_at"] else None
    role = _perm
    return {
        "version_id": vid, "module": module, "record_key": record_key,
        "name": head.name if head else None,
        "status": head.status if head else issues[0]["status"],
        "assigned_to": str(head.assigned_to) if head and head.assigned_to else None,
        "assignee_email": head.assignee_email if head else None,
        "values": {k: (None if v is None else str(v)) for k, v in values.items()},
        "field_descriptions": described,
        "issues": issues, "events": events,
        "other_runs": await _previous_run(db, tenant, vid, scope, module, record_key, [i["check_id"] for i in issues]),
        **(await _mdm_links(db, tenant, module, record_key)),
        "currency": await _currency(db, tenant) if any(i["rule"]["cost_at_risk"] is not None for i in issues) else None,
        "can": {k: await _allowed(db, tenant, request, role, a)
                for k, a in (("fix", "apply"), ("sign_off", "approve"), ("assign", "assign"), ("comment", "analyse"))},
    }


MAX_ALLOWED = 60


def fs_field_label(field: str) -> str:
    from api.services.fix_sheet import field_label
    return field_label(field) or field


def _pass_rate(stored, failing, population) -> Optional[float]:
    """The check's pass rate in the run, in percent (0 to 100): from the counts, else the stored one."""
    if population:
        return round(max(population - failing, 0) * 100 / population, 1)
    return None if stored is None else round(float(stored), 1)


async def _tenant_rules(db: AsyncSession, tenant: Tenant, module: str, checks: list[str]) -> dict[str, dict]:
    """check id -> the tenant's rules row (id, name) for it: the rule library page opens /rules/<id>."""
    if not checks:
        return {}
    rows = (await db.execute(text("""
        SELECT DISTINCT ON (split_part(name, ':', 1)) split_part(name, ':', 1) AS check_id, id, name FROM rules
         WHERE tenant_id = :t AND module = :m AND split_part(name, ':', 1) = ANY(:c)
         ORDER BY split_part(name, ':', 1), updated_at DESC NULLS LAST"""),
        {"t": str(tenant.id), "m": module, "c": checks})).mappings().all()
    return {r["check_id"]: {"id": str(r["id"]), "name": r["name"]} for r in rows}


def _shipped_rule(module: Optional[str], check_id: str) -> dict:
    from api.services.rule_coverage import shipped
    return shipped().get((check_id, module or ""), {}) or {}


def _rule_meta(r, row: Optional[dict]) -> dict:
    """The rule behind an issue: its library id and name, dimension, authority and the money it puts at risk."""
    y = _shipped_rule(r["rule_module"], r["check_id"])
    name = row["name"].split(":", 1)[1].strip() if row and ":" in row["name"] else (row or {}).get("name")
    failing = r["group_records"] if r["group_records"] is not None else (r["affected_count"] or 0)
    cost = float(r["cost_at_risk"]) if r["cost_at_risk"] is not None else None
    return {
        "id": row["id"] if row else None,
        "name": name or y.get("label") or y.get("message"),
        "dimension": r["dimension"] or y.get("dimension"),
        "authority": r["authority"] or y.get("rule_authority"),
        "cost_at_risk": cost,
        "cost_per_record": round(cost / failing, 2) if cost is not None and failing else None,
    }


def _allowed_values(stored, module: Optional[str], check_id: str, limit: Optional[int] = MAX_ALLOWED) -> Optional[list[dict]]:
    """The values the rule accepts, with their meaning where the rule gives one; None for a rule without a list.
    ``limit`` caps the list (None: every value)."""
    src = stored if isinstance(stored, (dict, list)) and stored else None
    if src is None:
        y = _shipped_rule(module, check_id)
        src = y.get("valid_values_with_labels") or y.get("allowed_values") or y.get("domain_values")
    if isinstance(src, dict):
        out = [{"value": str(k), "label": None if v is None else str(v)} for k, v in src.items()]
    elif isinstance(src, (list, tuple)):
        out = [{"value": "" if v is None else str(v), "label": None} for v in src]
    else:
        return None
    return (out if limit is None else out[:limit]) or None


async def _previous_run(db: AsyncSession, tenant: Tenant, vid: str, scope: str, module: str, record_key: str,
                        checks_now: list[str]) -> Optional[dict]:
    """The record in the system's previous kept run (one with a work list): its issues then against now."""
    prev = (await db.execute(text("""
        SELECT av.id::text AS version_id, av.run_at FROM analysis_versions av
         WHERE av.tenant_id = :t AND av.id <> CAST(:v AS uuid)
           AND av.run_at < (SELECT run_at FROM analysis_versions WHERE id = CAST(:v AS uuid))
           AND EXISTS (SELECT 1 FROM work_records w WHERE w.tenant_id = :t AND w.version_id = av.id AND w.scope = :scope)
         ORDER BY av.run_at DESC LIMIT 1"""), {"t": str(tenant.id), "v": vid, "scope": scope})).mappings().first()
    if not prev:
        return None
    then = (await db.execute(text("""
        SELECT issues, checks, status FROM work_records
         WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) AND module = :m AND record_key = :k"""),
        {"t": str(tenant.id), "v": prev["version_id"], "m": module, "k": record_key})).mappings().first()
    before = list(then["checks"]) if then else []
    return {
        "version_id": prev["version_id"], "run_at": prev["run_at"].isoformat() if prev["run_at"] else None,
        "on_list": then is not None, "issues": then["issues"] if then else 0, "status": then["status"] if then else None,
        "checks": before, "fixed_since": [c for c in before if c not in checks_now],
        "new_since": [c for c in checks_now if c not in before],
    }


async def _currency(db: AsyncSession, tenant: Tenant) -> str:
    """The currency findings.cost_at_risk is priced in (checks/cost.py: the tenant's cost model, else the default)."""
    from checks.cost import effective
    model = (await db.execute(text("SELECT cost_model FROM tenants WHERE id = :t"), {"t": str(tenant.id)})).scalar()
    return str(effective(model if isinstance(model, dict) else None)["currency"])


def _key_candidates(record_key: str) -> list[str]:
    """The record key as the MDM tables may hold it: whole, and the bare value of its first part (MATNR=1 -> 1)."""
    out = [record_key]
    first = record_key.split("|", 1)[0]
    if "=" in first:
        bare = first.split("=", 1)[1]
        if bare and bare not in out:
            out.append(bare)
    return out


async def _mdm_links(db: AsyncSession, tenant: Tenant, module: str, record_key: str) -> dict:
    """The golden record that keys this record and its open duplicate candidates. Best effort under a short
    statement timeout: a slow MDM table never holds the panel up (the fields are None then)."""
    import logging
    from urllib.parse import urlencode

    from sqlalchemy.exc import SQLAlchemyError

    out: dict = {"golden_record": None, "duplicates": None}
    p = {"t": str(tenant.id), "m": module, "keys": _key_candidates(record_key)}
    try:
        async with db.begin_nested():
            await db.execute(text("SET LOCAL statement_timeout = '1500ms'"))
            g = (await db.execute(text("""
                SELECT id::text AS id, status, sap_object_key FROM master_records
                 WHERE tenant_id = :t AND domain = :m AND sap_object_key = ANY(:keys) AND merged_into IS NULL
                 ORDER BY (status = 'golden') DESC, updated_at DESC LIMIT 1"""), p)).mappings().first()
            if g:
                out["golden_record"] = {"id": g["id"], "status": g["status"], "key": g["sap_object_key"],
                                        "href": f"/mdm/golden/{g['id']}"}
            n = (await db.execute(text("""
                SELECT count(*) FROM dedup_candidates
                 WHERE tenant_id = :t AND object_type = :m AND status = 'pending'
                   AND (record_key_a = ANY(:keys) OR record_key_b = ANY(:keys))"""), p)).scalar() or 0
            # Match review, filtered to this record's pairs from the cleaning engine (the source counted here).
            out["duplicates"] = {"open": int(n), "href": "/mdm/golden/merge?" + urlencode(
                {"source": "cleaning", "object": module, "record": record_key})}
            await db.execute(text("SET LOCAL statement_timeout = DEFAULT"))
    except SQLAlchemyError as e:  # a timeout or a missing MDM table: the panel shows the record without these links
        logging.getLogger(__name__).info("work record: MDM links skipped for %s: %s", module, type(e).__name__)
    return out


class Decision(BaseModel):
    module: str = Field(min_length=1, max_length=64)
    record_key: str = Field(min_length=1, max_length=2000)
    check_id: Optional[str] = Field(None, max_length=200, description="None: every failing check of the record")
    action: Literal["accept", "edit", "not_an_issue", "accept_risk", "undo", "assign", "comment"]
    value: Optional[str] = Field(None, max_length=4000)
    note: Optional[str] = Field(None, max_length=4000)
    assignee: Optional[str] = Field(None, description="user id, '' to unassign, 'me'")


class DecideBody(BaseModel):
    version_id: Optional[uuid.UUID] = None
    items: list[Decision] = Field(min_length=1, max_length=5000)


_NEEDS = {"accept": "apply", "edit": "apply", "undo": "apply", "not_an_issue": "approve", "accept_risk": "approve",
          "assign": "assign", "comment": "analyse"}


async def _allowed(db: AsyncSession, tenant: Tenant, request: Request, role: str, action: str) -> bool:
    """The caller may do ``action`` tenant-wide, resolved as require_permission resolves it: the role (built-in or
    custom), then the user's unscoped grants."""
    if has_permission(role, action) or action in await actions_for(role, tenant.id, db):
        return True
    uid = getattr(request.state, "local_user_id", None)
    if not uid or dev_role_override(request) is not None:
        return False
    grants = [g for g in await grants_for(db, uid, tenant.id) if g[1] == Scope()]
    return await _grants_allow(grants, action, Scope(), tenant.id, db)


async def _my_draft(db: AsyncSession, tenant: Tenant, request: Request) -> str:
    """The user's open work-list draft batch, created on first use."""
    uid = current_user_id(request)
    found = (await db.execute(text("""
        SELECT id::text FROM remediation_batches
         WHERE tenant_id = :t AND status = 'draft' AND filter->>'source' = 'worklist'
           AND created_by IS NOT DISTINCT FROM CAST(:u AS uuid)
         ORDER BY created_at DESC LIMIT 1"""), {"t": str(tenant.id), "u": uid})).scalar()
    if found:
        return found
    bid = str(uuid.uuid4())
    label = current_user_label()
    await db.execute(text("""
        INSERT INTO remediation_batches (id, tenant_id, name, filter, created_by, created_by_label)
        VALUES (CAST(:id AS uuid), :t, :name, CAST('{"source": "worklist"}' AS jsonb), CAST(:u AS uuid), :label)"""),
        {"id": bid, "t": str(tenant.id), "name": f"Fixes by {label}", "u": uid, "label": label})
    return bid


async def _event(db, tenant: Tenant, request: Request, issue_ids: list[str], action: str, frm, to, note) -> None:
    if issue_ids:
        await db.execute(text("""
            INSERT INTO record_issue_events (tenant_id, issue_id, user_id, user_label, action, from_value, to_value, note)
            SELECT :t, id, CAST(:u AS uuid), :label, :a, :f, :to, :note FROM record_issues WHERE id = ANY(CAST(:ids AS uuid[]))"""),
            {"t": str(tenant.id), "u": current_user_id(request), "label": current_user_label(), "a": action,
             "f": frm, "to": to, "note": note, "ids": issue_ids})


@router.post("/decide")
async def decide(
    body: DecideBody,
    request: Request,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("view")),
):
    """Apply decisions to failing records. Values go to the user's draft fix batch (a second person approves it);
    "not an issue" and "accept the risk" sign the issues off; undo takes a value back out of the draft."""
    rec = undo.Recorder()
    out = await _apply_decisions(body, request, db, tenant, role, rec)
    out["action_id"] = await rec.save(db, tenant, request, "decide", {
        "version_id": str(body.version_id) if body.version_id else None,
        "items": [{"module": d.module, "record_key": d.record_key, "check_id": d.check_id, "action": d.action,
                   "value": d.value, "assignee": d.assignee} for d in body.items]})
    await db.commit()
    work_analytics.forget(tenant.id)
    return out


async def _apply_decisions(body: DecideBody, request: Request, db: AsyncSession, tenant: Tenant, role: str,
                           rec: Optional[undo.Recorder] = None) -> dict:
    """decide's work without the commit: the caller commits once, so several runs' decisions (a fix sheet of the
    current state) land together or not at all. Raises HTTPException before or while writing; the caller rolls back.
    ``rec`` snapshots what each decision changes, so POST /actions/undo can put it back (api/services/undo.py)."""
    missing = sorted({a for a in {_NEEDS[d.action] for d in body.items} if not await _allowed(db, tenant, request, role, a)})
    if missing:
        raise HTTPException(status_code=403, detail=f"Your role cannot {', '.join(missing)}.")
    for d in body.items:
        if d.action == "edit" and (d.value is None or not d.value.strip()):
            raise HTTPException(status_code=400, detail="Give the value to use.")
        if d.action in ("not_an_issue", "accept_risk") and not (d.note or "").strip():
            raise HTTPException(status_code=400, detail="Say why: a sign-off needs a reason.")
        if d.action == "comment" and not (d.note or "").strip():
            raise HTTPException(status_code=400, detail="Write the comment.")
    await _rls(db, tenant)
    vid, scope = await _run(db, tenant, body.version_id)
    await sandbox.guard_scope(db, tenant.id, scope)  # sandbox mode: decisions land on sandbox rows only (115)
    uid = current_user_id(request)
    draft: Optional[str] = None
    touched: list[tuple[str, str]] = []
    done = 0
    for d in body.items:
        p = {"t": str(tenant.id), "v": vid, "m": d.module, "k": d.record_key, "scope": scope, "c": d.check_id}
        rows = (await db.execute(text("""
            SELECT fr.check_id, fr.grain, fr.field_values ->> (f.details->>'field_checked') AS current_value,
                   f.details->>'field_checked' AS field, f.value_fix_map,
                   (SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f.record_fixes) = 'array' THEN f.record_fixes ELSE '[]'::jsonb END) e
                     WHERE e->>'record_key' = fr.record_key AND e->>'proposed_value' IS NOT NULL LIMIT 1) AS record_fix,
                   ri.id::text AS issue_id, ri.status AS issue_status
              FROM finding_records fr
              JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
              LEFT JOIN record_issues ri ON ri.tenant_id = fr.tenant_id AND ri.scope = :scope
                                        AND ri.check_id = fr.check_id AND ri.record_key = fr.record_key
             WHERE fr.version_id = CAST(:v AS uuid) AND fr.module = :m AND fr.record_key = :k
               AND (CAST(:c AS text) IS NULL OR fr.check_id = :c)"""), p)).mappings().all()
        if not rows:
            raise HTTPException(status_code=404, detail=f"{d.record_key} does not fail {d.check_id or 'any check'} in this run.")
        issue_ids = [r["issue_id"] for r in rows if r["issue_id"]]
        if rec is not None and d.action != "comment":
            rec.scope = scope
            await rec.issue_rows(db, tenant, issue_ids)
            await rec.item_rows(db, tenant, scope, d.module, d.record_key, d.check_id)
        if d.action in ("accept", "edit"):
            draft = draft or await _my_draft(db, tenant, request)
            for r in rows:
                if d.action == "edit":
                    value, source, conf = d.value, "steward", None
                else:
                    rf, vf = r["record_fix"] or {}, _value_fix(r["value_fix_map"], r["current_value"]) or {}
                    if rf.get("proposed_value") is not None:
                        value, source, conf = rf["proposed_value"], "rule", rf.get("confidence")
                    elif vf.get("suggested_value") is not None:
                        value, source, conf = vf["suggested_value"], "rule", None
                    elif (hit := _cleaning_value(await _cleaning_rows(db, p), r["field"], r["check_id"])) is not None:
                        value, source, conf = hit[0], "cleaning", hit[1]
                    else:
                        if d.check_id:
                            raise HTTPException(status_code=409, detail="No proposed value to accept: enter one.")
                        continue
                await db.execute(text("""
                    INSERT INTO remediation_items (tenant_id, batch_id, issue_id, scope, module, check_id, record_key,
                                                   grain, field, current_value, proposed_value, proposal_source, confidence)
                    VALUES (:t, CAST(:b AS uuid), CAST(:i AS uuid), :scope, :m, :c, :k, :g, :f, :cur, :val, :src, :conf)
                    ON CONFLICT (batch_id, check_id, record_key) DO UPDATE
                       SET proposed_value = EXCLUDED.proposed_value, proposal_source = EXCLUDED.proposal_source,
                           confidence = EXCLUDED.confidence, accepted = false, updated_at = now()"""),
                    {"t": str(tenant.id), "b": draft, "i": r["issue_id"], "scope": scope, "m": d.module,
                     "c": r["check_id"], "k": d.record_key, "g": r["grain"], "f": r["field"],
                     "cur": r["current_value"], "val": value, "src": source, "conf": conf})
                touched.append((r["check_id"], d.record_key))
                if rec is not None:
                    rec.wrote(draft, r["check_id"], d.record_key)
                done += 1
            open_ids = [r["issue_id"] for r in rows if r["issue_id"] and r["issue_status"] == "open"]
            if open_ids:
                await db.execute(text("UPDATE record_issues SET status = 'in_progress', updated_at = now(), "
                                      "acknowledged_at = COALESCE(acknowledged_at, now()) WHERE id = ANY(CAST(:ids AS uuid[]))"),
                                 {"ids": open_ids})
                await _event(db, tenant, request, open_ids, "status", "open", "in_progress", d.note or "Fix proposed")
        elif d.action == "undo":
            res = await db.execute(text("""
                DELETE FROM remediation_items i USING remediation_batches b
                 WHERE b.id = i.batch_id AND b.status = 'draft' AND b.created_by IS NOT DISTINCT FROM CAST(:u AS uuid)
                   AND i.tenant_id = :t AND i.scope = :scope AND i.module = :m AND i.record_key = :k
                   AND (CAST(:c AS text) IS NULL OR i.check_id = :c)
                RETURNING i.check_id, i.batch_id"""), {**p, "u": uid})
            removed = res.fetchall()
            gone = [c for c, _b in removed]
            if rec is not None:
                for c, b in removed:
                    rec.deleted(str(b), c, d.record_key)
            back = [r["issue_id"] for r in rows if r["issue_id"] and r["issue_status"] in ("in_progress", "accepted")]
            if back:
                await db.execute(text("UPDATE record_issues SET status = 'open', resolution = NULL, resolved_at = NULL, "
                                      "steward_verdict = NULL, updated_at = now() WHERE id = ANY(CAST(:ids AS uuid[]))"),
                                 {"ids": back})
                for prev in ("in_progress", "accepted"):  # the from-value tells analytics a sign-off was withdrawn
                    ids = [r["issue_id"] for r in rows if r["issue_id"] in back and r["issue_status"] == prev]
                    await _event(db, tenant, request, ids, "status", prev, "open", d.note or "Decision undone")
            touched += [(c, d.record_key) for c in gone] + [(r["check_id"], d.record_key) for r in rows]
            done += len(gone) + len(back)
        elif d.action in ("not_an_issue", "accept_risk"):
            res = "false_positive" if d.action == "not_an_issue" else "accepted_risk"
            if issue_ids:
                await db.execute(text("""
                    UPDATE record_issues SET status = 'accepted', resolution = :res, resolved_at = now(), updated_at = now(),
                           steward_verdict = CASE WHEN :res = 'false_positive' THEN 'false_positive' ELSE 'real' END
                     WHERE id = ANY(CAST(:ids AS uuid[]))"""), {"res": res, "ids": issue_ids})
                await _event(db, tenant, request, issue_ids, "status", None, "accepted", d.note)
            touched += [(r["check_id"], d.record_key) for r in rows]
            done += len(issue_ids)
        elif d.action == "assign":
            assignee = uid if d.assignee == "me" else (d.assignee or None)
            if assignee and not (await db.execute(text("SELECT 1 FROM users WHERE id = CAST(:u AS uuid)"),
                                                  {"u": assignee})).scalar():
                raise HTTPException(status_code=404, detail="Assignee not found.")
            if issue_ids:
                await db.execute(text("UPDATE record_issues SET assigned_to = CAST(:a AS uuid), assigned_at = now(), "
                                      "updated_at = now() WHERE id = ANY(CAST(:ids AS uuid[]))"),
                                 {"a": assignee, "ids": issue_ids})
                await _event(db, tenant, request, issue_ids, "assign", None, assignee, d.note)
            touched += [(r["check_id"], d.record_key) for r in rows]
            done += len(issue_ids)
        elif d.action == "comment":
            await _event(db, tenant, request, issue_ids, "comment", None, None, d.note)
            done += len(issue_ids)
    if touched:
        await db.run_sync(lambda s: worklist.refresh(s, str(tenant.id), scope, touched))
    return {"updated": done, "draft_batch_id": draft}


def _record_group(rec: undo.Recorder, draft: str, check_id: str, rows) -> None:
    """Note the items a set-based group write created or replaced (``rows``: record key, issue id, the item's
    previous row as json or None) so the write can be inverted."""
    for key, _issue, before in rows:
        if before:
            rec.items_before[(str(draft), check_id, key)] = before
        rec.wrote(draft, check_id, key)


@router.post("/groups/{check_id}/accept-all")
async def accept_all(
    check_id: str,
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("apply")),
):
    """Every machine-proposed value of one group (still to fix) into the user's draft batch, set-based."""
    await _rls(db, tenant)
    vid, scope = await _run(db, tenant, version_id)
    await sandbox.guard_scope(db, tenant.id, scope)  # sandbox mode: decisions land on sandbox rows only (115)
    draft = await _my_draft(db, tenant, request)
    p = {"t": str(tenant.id), "v": vid, "c": check_id, "scope": scope, "b": draft, "cap": MAX_ACCEPT}
    res = await db.execute(text("""
        WITH f AS (SELECT * FROM findings WHERE version_id = CAST(:v AS uuid) AND check_id = :c),
             auto AS (SELECT e->>'record_key' AS record_key, e->>'proposed_value' AS value, e->>'confidence' AS conf
                        FROM f, jsonb_array_elements(CASE WHEN jsonb_typeof(f.record_fixes) = 'array' THEN f.record_fixes ELSE '[]'::jsonb END) e
                       WHERE e->>'proposed_value' IS NOT NULL),
             cand AS (
                SELECT fr.module, fr.record_key, fr.grain, f.details->>'field_checked' AS field,
                       fr.field_values ->> (f.details->>'field_checked') AS current_value,
                       COALESCE(a.value, f.value_fix_map -> (fr.field_values ->> (f.details->>'field_checked'))
                                                         ->> 'suggested_value') AS value,
                       a.conf, ri.id AS issue_id, ri.status AS issue_status
                  FROM finding_records fr JOIN f ON f.check_id = fr.check_id
                  LEFT JOIN auto a ON a.record_key = fr.record_key
                  LEFT JOIN record_issues ri ON ri.tenant_id = fr.tenant_id AND ri.scope = :scope
                                            AND ri.check_id = fr.check_id AND ri.record_key = fr.record_key
                 WHERE fr.version_id = CAST(:v AS uuid) AND fr.check_id = :c
                   AND COALESCE(ri.status, 'open') IN ('open', 'in_progress')
                   AND NOT EXISTS (SELECT 1 FROM remediation_items i JOIN remediation_batches b ON b.id = i.batch_id
                                    WHERE i.tenant_id = fr.tenant_id AND i.scope = :scope AND i.check_id = fr.check_id
                                      AND i.record_key = fr.record_key AND b.status IN ('approved', 'exported'))
                 LIMIT :cap),
             old AS (SELECT record_key, to_jsonb(r) AS j FROM remediation_items r
                      WHERE r.batch_id = CAST(:b AS uuid) AND r.check_id = :c),
             ins AS (
                INSERT INTO remediation_items (tenant_id, batch_id, issue_id, scope, module, check_id, record_key, grain,
                                               field, current_value, proposed_value, proposal_source, confidence)
                SELECT :t, CAST(:b AS uuid), issue_id, :scope, module, :c, record_key, grain, field, current_value,
                       value, 'rule', conf FROM cand WHERE value IS NOT NULL
                ON CONFLICT (batch_id, check_id, record_key) DO UPDATE
                   SET proposed_value = EXCLUDED.proposed_value, proposal_source = 'rule',
                       confidence = EXCLUDED.confidence, updated_at = now()
                 -- a value the steward entered stays: accept-all only fills undecided records
                 WHERE remediation_items.proposal_source IS DISTINCT FROM 'steward'
                RETURNING record_key, issue_id)
        SELECT ins.record_key, ins.issue_id::text, old.j FROM ins LEFT JOIN old ON old.record_key = ins.record_key"""), p)
    rows = res.fetchall()
    rec = undo.Recorder()
    rec.scope = scope
    _record_group(rec, draft, check_id, rows)
    open_ids = [i for _, i, _j in rows if i]
    await rec.issue_rows(db, tenant, open_ids)
    if open_ids:
        await db.execute(text("UPDATE record_issues SET status = 'in_progress', updated_at = now(), "
                              "acknowledged_at = COALESCE(acknowledged_at, now()) "
                              "WHERE id = ANY(CAST(:ids AS uuid[])) AND status = 'open'"), {"ids": open_ids})
        await _event(db, tenant, request, open_ids, "status", "open", "in_progress", "Proposed values accepted for the group")
    if rows:
        await db.run_sync(lambda s: worklist.refresh(s, str(tenant.id), scope, [(check_id, k) for k, _i, _j in rows]))
    action_id = await rec.save(db, tenant, request, "accept_all", {"check_id": check_id, "version_id": vid,
                                                                   "records": len(rows)})
    await db.commit()
    work_analytics.forget(tenant.id)
    return {"accepted": len(rows), "draft_batch_id": draft, "action_id": action_id}


@router.post("/build")
async def build_now(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("analyse")),
):
    """Queue a work-list build for a run that has none (runs from before the work list, or a failed build)."""
    await _rls(db, tenant)
    vid, _ = await _run(db, tenant, version_id)
    from workers.tasks.build_worklist import build_worklist
    build_worklist.delay(vid, str(tenant.id))
    return {"version_id": vid, "queued": True}


class SetValue(BaseModel):
    value: str = Field(min_length=1, max_length=4000)
    only_blank: bool = Field(False, description="only records whose current value is blank")


@router.post("/groups/{check_id}/set-value")
async def set_value(
    check_id: str,
    body: SetValue,
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("apply")),
):
    """One value for every open record of a group (mass edit), into the user's draft batch, set-based."""
    await _rls(db, tenant)
    vid, scope = await _run(db, tenant, version_id)
    await sandbox.guard_scope(db, tenant.id, scope)  # sandbox mode: decisions land on sandbox rows only (115)
    draft = await _my_draft(db, tenant, request)
    blank = "AND COALESCE(btrim(fr.field_values ->> (f.details->>'field_checked')), '') = ''" if body.only_blank else ""
    rows = (await db.execute(text(f"""
        WITH old AS (SELECT record_key, to_jsonb(r) AS j FROM remediation_items r
                      WHERE r.batch_id = CAST(:b AS uuid) AND r.check_id = :c),
        ins AS (
            INSERT INTO remediation_items (tenant_id, batch_id, issue_id, scope, module, check_id, record_key, grain,
                                           field, current_value, proposed_value, proposal_source)
            SELECT :t, CAST(:b AS uuid), ri.id, :scope, fr.module, fr.check_id, fr.record_key, fr.grain,
                   f.details->>'field_checked', fr.field_values ->> (f.details->>'field_checked'), :val, 'steward'
              FROM finding_records fr
              JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
              LEFT JOIN record_issues ri ON ri.tenant_id = fr.tenant_id AND ri.scope = :scope
                                        AND ri.check_id = fr.check_id AND ri.record_key = fr.record_key
             WHERE fr.version_id = CAST(:v AS uuid) AND fr.check_id = :c {blank}
               AND COALESCE(ri.status, 'open') IN ('open', 'in_progress')
             LIMIT :cap
            ON CONFLICT (batch_id, check_id, record_key) DO UPDATE
               SET proposed_value = EXCLUDED.proposed_value, proposal_source = 'steward', confidence = NULL,
                   accepted = false, updated_at = now()
            RETURNING record_key, issue_id)
        SELECT ins.record_key, ins.issue_id::text, old.j FROM ins LEFT JOIN old ON old.record_key = ins.record_key"""),
        {"t": str(tenant.id), "b": draft, "scope": scope, "v": vid, "c": check_id, "val": body.value,
         "cap": MAX_ACCEPT})).fetchall()
    rec = undo.Recorder()
    rec.scope = scope
    _record_group(rec, draft, check_id, rows)
    open_ids = [i for _, i, _j in rows if i]
    await rec.issue_rows(db, tenant, open_ids)
    if open_ids:
        await db.execute(text("UPDATE record_issues SET status = 'in_progress', updated_at = now(), "
                              "acknowledged_at = COALESCE(acknowledged_at, now()) "
                              "WHERE id = ANY(CAST(:ids AS uuid[])) AND status = 'open'"), {"ids": open_ids})
        await _event(db, tenant, request, open_ids, "status", "open", "in_progress", f"Value set for the group: {body.value}")
    if rows:
        await db.run_sync(lambda s: worklist.refresh(s, str(tenant.id), scope, [(check_id, k) for k, _i, _j in rows]))
    action_id = await rec.save(db, tenant, request, "set_value", {"check_id": check_id, "version_id": vid,
                                                                  "value": body.value, "records": len(rows)})
    await db.commit()
    work_analytics.forget(tenant.id)
    return {"updated": len(rows), "draft_batch_id": draft, "action_id": action_id}


# ── spreadsheet round trip ───────────────────────────────────────────────────

SHEET = "Fix sheet"
_SHEET_COLUMNS = [
    ("module", "Object"), ("record_key", "Record"), ("name", "Name"), ("check_id", "Check"),
    ("severity", "Severity"), ("message", "Issue"), ("field", "Field"), ("current_value", "Current value"),
    ("suggested_value", "Suggested value"), ("new_value", "New value"), ("decision", "Decision"),
    ("reason", "Reason"),
]
DECISIONS = {"fix": "accept", "not an issue": "not_an_issue", "accept risk": "accept_risk"}
MAX_IMPORT = 5000
MAX_IMPORT_BYTES = 25 * 1024 * 1024


@router.get("/export")
async def export_sheet(
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    module: Optional[str] = None,
    check_id: Optional[str] = None,
    severity: Optional[str] = Query(None, pattern="^(critical|high|medium|low|blocking)$", description="blocking = critical or high"),
    status: Optional[str] = Query("open", pattern="^(open|all|to_fix|proposed|approved|sent|not_an_issue|fixed)$"),
    assigned: Optional[str] = None,
    proposed: Optional[bool] = None,
    due: Optional[str] = Query(None, pattern="^(overdue|today)$"),
    part: Optional[str] = Query(None, max_length=200),
    system: Optional[str] = Query(None, max_length=100),
    q: Optional[str] = Query(None, max_length=200),
    since: Optional[uuid.UUID] = Query(None, description=_SINCE_DESC),
    scope: WorkScope = _SCOPE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("export")),
):
    """The filtered work list (one run, or ``scope=current``) as a fix sheet: one row per record and failing check, with its current and
    suggested value and blank New value / Decision / Reason columns to fill in and import back."""
    from api.services.branded_xlsx import ROW_CAP, ColumnSpec, SheetSpec, build_workbook, xlsx_filename, xlsx_response

    await _rls(db, tenant)
    sel = await _rows(db, tenant, version_id, scope)
    vid = sel.vid or "current"
    where, p = _records_where(tenant, sel, request, module, check_id, severity, status, assigned, proposed, q, due, part,
                              system)
    await _since(db, tenant, sel, since, module, where, p)
    check_filter = "AND fr.check_id = :c" if check_id else ""
    rows = (await db.execute(text(f"""
        WITH auto AS (
            SELECT f.version_id, f.check_id, e->>'record_key' AS record_key, e->>'proposed_value' AS value
              FROM findings f, jsonb_array_elements(CASE WHEN jsonb_typeof(f.record_fixes) = 'array'
                                                         THEN f.record_fixes ELSE '[]'::jsonb END) e
             WHERE {_auto_runs(sel)} AND e->>'proposed_value' IS NOT NULL)
        SELECT w.module, w.record_key, w.name, fr.check_id, f.severity, f.details->>'message' AS message,
               f.details->>'field_checked' AS field, f.module AS rule_module,
               f.rule_context->'valid_values_with_labels' AS valid_values,
               fr.field_values ->> (f.details->>'field_checked') AS current_value,
               COALESCE(a.value, CASE WHEN jsonb_typeof(f.value_fix_map) = 'object' THEN
                        f.value_fix_map -> (fr.field_values ->> (f.details->>'field_checked')) ->> 'suggested_value' END)
                 AS suggested_value
          FROM work_records w
          JOIN finding_records fr ON fr.version_id = w.version_id AND fr.module = w.module AND fr.record_key = w.record_key
          JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
          LEFT JOIN auto a ON a.version_id = fr.version_id AND a.check_id = fr.check_id AND a.record_key = fr.record_key
         WHERE {' AND '.join(where)} {check_filter}
         ORDER BY w.sev_rank, w.module, w.record_key, fr.check_id
         LIMIT :lim"""), {**p, "lim": ROW_CAP + 1})).mappings().all()
    columns, items = _readable(rows)
    data = build_workbook(
        tenant_name=tenant.name, run_label=None, run_id=vid, title="Fix sheet",
        sheets=[SheetSpec(title=SHEET, rows=items, columns=columns, note=_FILL_NOTE)],
    )
    return xlsx_response(data, xlsx_filename("fix-sheet", vid))


_FILL_NOTE = ("Fill in New value (one of the Possible values, its code only), or pick a Decision (fix, not an issue, "
              "accept risk) with a Reason, then import the workbook back. Keep the grey columns as they are.")


def _readable(rows, value_at_risk: bool = False) -> tuple[list, list[dict]]:
    """Fix-sheet rows in business words (api/services/fix_sheet.py): the key split into SAP-named columns, the
    record's name under its object's heading, the field's description and the rule's possible values. The ids the
    import reads stay at the end in grey under their old headers (_SHEET_COLUMNS), so old and new sheets import."""
    from api.services import fix_sheet as fs
    from api.services.branded_xlsx import ColumnSpec

    rows = [dict(r) for r in rows]
    keys = fs.key_columns(rows)
    for r in rows:
        allowed = _allowed_values(r.get("valid_values"), r.get("rule_module"), r["check_id"])
        parts = dict(fs.split_key(r["record_key"]))
        r.update({f"key:{k}": parts.get(k) for k in keys})
        r.update(object_name=module_label(r["module"]), record_text=fs.readable_key(r["record_key"]),
                 field_name=fs.field_label(r["field"]), sap_field=fs.sap_field(r["field"]), current_text=fs.with_meaning(r["current_value"], allowed),
                 suggested_text=fs.with_meaning(r["suggested_value"], allowed), possible=fs.possible_values(allowed))
    first = [f for f, _ in fs.split_key(rows[0]["record_key"])] if rows else []
    cols = [ColumnSpec(key="object_name", header="Object name")] if len({r["module"] for r in rows}) > 1 else []
    cols += ([ColumnSpec(key=f"key:{k}", header=fs.key_header(k), kind="mono") for k in keys] if keys
             else [ColumnSpec(key="record_text", header="Key")])
    cols += [
        ColumnSpec(key="name", header=fs.name_header(keys or first)),
        ColumnSpec(key="field_name", header="Field description"),
        ColumnSpec(key="sap_field", header="SAP field", kind="mono"),
        ColumnSpec(key="message", header="Problem"),
        ColumnSpec(key="severity", header="Severity"),
        ColumnSpec(key="current_text", header="Current value"),
        ColumnSpec(key="possible", header="Possible values"),
        ColumnSpec(key="suggested_text", header="Suggested value"),
    ]
    if value_at_risk:
        cols.append(ColumnSpec(key="value_at_risk", header="Value at risk", kind="money"))
    cols += [
        ColumnSpec(key="new_value", header="New value", kind="raw"),
        ColumnSpec(key="decision", header="Decision", choices=tuple(DECISIONS)),
        ColumnSpec(key="reason", header="Reason"),
    ]
    cols += [ColumnSpec(key=k, header=h, kind="mono", muted=True) for k, h in _SHEET_COLUMNS
             if k in ("module", "record_key", "check_id")]
    return cols, rows




@router.get("/export/per-object")
async def export_per_object(
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    check_id: Optional[str] = None,
    severity: Optional[str] = Query(None, pattern="^(critical|high|medium|low|blocking)$", description="blocking = critical or high"),
    status: Optional[str] = Query("open", pattern="^(open|all|to_fix|proposed|approved|sent|not_an_issue|fixed)$"),
    assigned: Optional[str] = None,
    proposed: Optional[bool] = None,
    due: Optional[str] = Query(None, pattern="^(overdue|today)$"),
    part: Optional[str] = Query(None, max_length=200),
    system: Optional[str] = Query(None, max_length=100),
    q: Optional[str] = Query(None, max_length=200),
    since: Optional[uuid.UUID] = Query(None, description=_SINCE_DESC),
    scope: WorkScope = _SCOPE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    _perm: str = Depends(require_permission("export")),
):
    """One workbook, a sheet per object: the records to fix and what each is worth.

    Built for a steward working one object at a time: the Summary sheet ranks objects by value at
    risk, and each object's sheet carries its records with the same New value / Decision / Reason
    columns as /work/export, so it can be filled in and imported straight back.

    Value at risk is the check's cost at risk shared across its failing records. It is an
    attribution, not a saving: the same value is reported by every record the check fails on, so
    per-object totals are meaningful but must not be summed across objects for the same check.
    """
    from api.services.branded_xlsx import ROW_CAP, ColumnSpec, SheetSpec, build_workbook, xlsx_filename, xlsx_response

    await _rls(db, tenant)
    sel = await _rows(db, tenant, version_id, scope)
    vid = sel.vid or "current"
    where, p = _records_where(tenant, sel, request, None, check_id, severity, status, assigned, proposed, q, due, part,
                              system)
    await _since(db, tenant, sel, since, None, where, p)
    check_filter = "AND fr.check_id = :c" if check_id else ""
    rows = (await db.execute(text(f"""
        WITH auto AS (
            SELECT f.version_id, f.check_id, e->>'record_key' AS record_key, e->>'proposed_value' AS value
              FROM findings f, jsonb_array_elements(CASE WHEN jsonb_typeof(f.record_fixes) = 'array'
                                                         THEN f.record_fixes ELSE '[]'::jsonb END) e
             WHERE {_auto_runs(sel)} AND e->>'proposed_value' IS NOT NULL)
        SELECT w.module, w.record_key, w.name, fr.check_id, f.severity, f.details->>'message' AS message,
               f.details->>'field_checked' AS field, f.module AS rule_module,
               f.rule_context->'valid_values_with_labels' AS valid_values,
               fr.field_values ->> (f.details->>'field_checked') AS current_value,
               COALESCE(a.value, CASE WHEN jsonb_typeof(f.value_fix_map) = 'object' THEN
                        f.value_fix_map -> (fr.field_values ->> (f.details->>'field_checked')) ->> 'suggested_value' END)
                 AS suggested_value,
               CASE WHEN COALESCE(f.affected_count, 0) > 0
                    THEN ROUND(COALESCE(f.cost_at_risk, 0)::numeric / f.affected_count, 2) ELSE 0 END
                 AS value_at_risk
          FROM work_records w
          JOIN finding_records fr ON fr.version_id = w.version_id AND fr.module = w.module AND fr.record_key = w.record_key
          JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
          LEFT JOIN auto a ON a.version_id = fr.version_id AND a.check_id = fr.check_id AND a.record_key = fr.record_key
         WHERE {' AND '.join(where)} {check_filter}
         ORDER BY w.module, w.sev_rank, w.record_key, fr.check_id
         LIMIT :lim"""), {**p, "lim": ROW_CAP + 1})).mappings().all()

    by_object: dict[str, list[dict]] = {}
    for r in rows:
        by_object.setdefault(r["module"], []).append(dict(r))

    sheets = [SheetSpec(
        title="Summary",
        note="Records to fix per object, ranked by value at risk. Value at risk is an attribution of "
             "each check's cost across its failing records, not a saving.",
        columns=[ColumnSpec(key="module", header="Object", kind="text"),
                 ColumnSpec(key="records", header="Records", kind="int"),
                 ColumnSpec(key="checks", header="Checks", kind="int"),
                 ColumnSpec(key="critical", header="Critical", kind="int"),
                 ColumnSpec(key="value_at_risk", header="Value at risk", kind="money")],
        rows=[{"module": module_label(m),
               "records": len(v),
               "checks": len({x["check_id"] for x in v}),
               "critical": sum(1 for x in v if x["severity"] == "critical"),
               "value_at_risk": round(sum(float(x["value_at_risk"] or 0) for x in v), 2)}
              for m, v in sorted(by_object.items(), key=lambda kv: -sum(float(x["value_at_risk"] or 0) for x in kv[1]))],
    )]
    for mod, items in sorted(by_object.items()):
        columns, readable = _readable(items, value_at_risk=True)
        sheets.append(SheetSpec(title=module_label(mod), rows=readable, columns=columns, note=_FILL_NOTE))
    data = build_workbook(tenant_name=tenant.name, run_label=None, run_id=vid,
                          title="Records to fix by object", sheets=sheets)
    return xlsx_response(data, xlsx_filename("records-to-fix-by-object", vid))


@router.post("/import")
async def import_sheet(
    request: Request,
    version_id: Optional[uuid.UUID] = None,
    scope: WorkScope = _SCOPE,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
    role: str = Depends(require_permission("apply")),
):
    """Read a filled-in fix sheet (from /work/export) back as decisions: a New value is an edit, a Decision of
    fix accepts the suggested value, not an issue / accept risk sign the issue off with the Reason. With
    ``scope=current`` each row goes to the run its object is read from in the current state."""
    import io

    from openpyxl import load_workbook

    form = await request.form()
    upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(status_code=400, detail="Attach the fix sheet as 'file'.")
    content = await upload.read()
    if len(content) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="The file is larger than 25 MB.")
    if content[:4] != b"PK\x03\x04":
        raise HTTPException(status_code=422, detail="This is not an .xlsx file.")
    try:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(status_code=422, detail="The workbook could not be read.")
    # Any sheet with the required columns is importable: the per-object workbook has one sheet per
    # object, and a steward fills those in directly rather than a single combined sheet.
    required = {"module", "record_key", "check_id", "new_value", "decision"}
    sheets = []
    for name in wb.sheetnames:
        it = wb[name].iter_rows(values_only=True)
        header = [str(h or "").strip() for h in next(it, ())]
        col = {key: header.index(h) for key, h in _SHEET_COLUMNS if h in header}
        if required <= set(col):
            sheets.append((name, it, col))
    if not sheets:
        raise HTTPException(
            status_code=422,
            detail=f"No sheet has the fix-sheet columns: export one from Meridian first "
                   f"(expected headers incl. {', '.join(sorted(required))}).")
    items, skipped = [], []
    for sheet_name, it, col in sheets:
        for n, row in enumerate(it, start=2):
            cell = lambda k: (None if k not in col or col[k] >= len(row) or row[col[k]] is None
                              else str(row[col[k]]).strip())
            new, decision, reason = cell("new_value"), (cell("decision") or "").lower(), cell("reason")
            if not new and not decision:
                continue
            action = "edit" if new else DECISIONS.get(decision)
            if action is None:
                skipped.append(f"{sheet_name} row {n}: decision '{decision}' is not fix, not an issue or accept risk")
                continue
            if action in ("not_an_issue", "accept_risk") and not reason:
                skipped.append(f"{sheet_name} row {n}: a sign-off needs a reason")
                continue
            items.append(Decision(module=cell("module") or "", record_key=cell("record_key") or "",
                                  check_id=cell("check_id"), action=action, value=new, note=reason))
    if not items:
        return {"updated": 0, "rows": 0, "skipped": skipped[:50]}
    if len(items) > MAX_IMPORT:
        raise HTTPException(status_code=400, detail=f"More than {MAX_IMPORT} decisions in one file; split it.")
    await _rls(db, tenant)
    sel = await _rows(db, tenant, version_id, scope)
    by_run: dict[str, list[Decision]] = {}
    for i in items:
        run = sel.version_of(i.module)
        if run is None:
            skipped.append(f"{i.record_key} {i.check_id}: {i.module} is not in the current state")
            continue
        by_run.setdefault(run, []).append(i)
    updated, rows_n, draft = 0, 0, None
    # One transaction for every run: a group that fails (409, 403, ...) leaves no earlier run's decisions behind.
    try:
        for run, group in by_run.items():
            failing = set((await db.execute(text("""
                SELECT fr.module, fr.record_key, fr.check_id FROM finding_records fr
                  JOIN unnest(CAST(:m AS text[]), CAST(:k AS text[]), CAST(:c AS text[])) AS x(module, record_key, check_id)
                    ON fr.module = x.module AND fr.record_key = x.record_key AND fr.check_id = x.check_id
                 WHERE fr.version_id = CAST(:v AS uuid)"""),
                {"v": run, "m": [i.module for i in group], "k": [i.record_key for i in group],
                 "c": [i.check_id or "" for i in group]})).fetchall())
            kept = [i for i in group if (i.module, i.record_key, i.check_id) in failing]
            skipped += [f"{i.record_key} {i.check_id}: does not fail this check in the run" for i in group if i not in kept]
            if not kept:
                continue
            out = await _apply_decisions(DecideBody(version_id=uuid.UUID(run), items=kept), request, db, tenant, role)
            updated += out["updated"]
            rows_n += len(kept)
            draft = out["draft_batch_id"] or draft
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    work_analytics.forget(tenant.id)
    return {"updated": updated, "draft_batch_id": draft, "rows": rows_n, "skipped": skipped[:50]}
