"""The steward work list, built once per run so no screen counts millions of rows on request.

work_groups   one row per (run, check)            what fails, where, how many, in which work status
work_records  one row per (run, object, record)   the record, its name, its checks, worst severity, status

Built from what the run already stored (finding_records, findings, record_issues) plus the decisions
made since (remediation_items, record_issues.status), and refreshed for the records a decision touches.
Deterministic, no model. Idempotent: a rebuild replaces the run's rows.

Work status, one vocabulary for every screen (a record takes the least-advanced status of its issues):
  to_fix        open, nobody has decided a value yet
  proposed      a value is decided and waits in a draft fix batch
  approved      a second person approved the batch
  sent          the batch was exported for the SAP load
  not_an_issue  signed off as an exception (accepted risk / false positive)
  fixed         a later run showed the record passing
"""
from __future__ import annotations

import logging
import re
from typing import Iterable, Optional

from sqlalchemy import text

from api.services.record_issues import _copy, scope_of
from checks.profiling import is_sensitive

log = logging.getLogger(__name__)

STATUSES = ("to_fix", "proposed", "approved", "sent", "not_an_issue", "fixed")
KEEP_RUNS = 2  # work rows kept per system: the newest runs, so the previous one can be compared

SEV_RANK_SQL = ("CASE {c} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 "
                "WHEN 'low' THEN 3 ELSE 4 END")
_STATUS_OF_RANK = "(ARRAY['to_fix','proposed','approved','sent','not_an_issue','fixed'])[{r} + 1]"

# The work status rank of each failing (check, record) of a run: the issue's own sign-off or fix
# first, else the furthest its newest fix batch item got.
_STATUS_ROWS = f"""
    SELECT fr.module, fr.check_id, fr.record_key, f.severity,
           {SEV_RANK_SQL.format(c="f.severity")} AS sev_rank,
           CASE WHEN ri.status = 'resolved' THEN 5
                WHEN ri.status = 'accepted' THEN 4
                WHEN rem.recon_status = 'still_failing' THEN 0
                WHEN rem.batch_status = 'exported' THEN 3
                WHEN rem.batch_status = 'approved' THEN 2
                WHEN rem.batch_status = 'draft' AND rem.proposed_value IS NOT NULL THEN 1
                ELSE 0 END AS status_rank,
           ri.assigned_to, CASE WHEN ri.status NOT IN ('resolved', 'accepted') THEN ri.due_at END AS due_at
      FROM finding_records fr
      JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
      LEFT JOIN record_issues ri ON ri.tenant_id = fr.tenant_id AND ri.scope = :scope
                                AND ri.check_id = fr.check_id AND ri.record_key = fr.record_key
      LEFT JOIN LATERAL (
            SELECT b.status AS batch_status, i.proposed_value, i.recon_status
              FROM remediation_items i JOIN remediation_batches b ON b.id = i.batch_id
             WHERE i.tenant_id = fr.tenant_id AND i.scope = :scope AND i.check_id = fr.check_id
               AND i.record_key = fr.record_key
             ORDER BY i.updated_at DESC LIMIT 1) rem ON true
     WHERE fr.version_id = CAST(:vid AS uuid) {{where}}
"""

# (check, record) pairs of the run with a machine-proposed value: a self-verified auto_fix, or the
# rule's value fix for the record's current value.
_PROPOSED_ROWS = """
    SELECT f.check_id, e->>'record_key' AS record_key
      FROM findings f, jsonb_array_elements(CASE WHEN jsonb_typeof(f.record_fixes) = 'array' THEN f.record_fixes ELSE '[]'::jsonb END) e
     WHERE f.version_id = CAST(:vid AS uuid) AND e->>'proposed_value' IS NOT NULL AND e->>'record_key' IS NOT NULL
    UNION
    SELECT fr.check_id, fr.record_key
      FROM finding_records fr JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
     WHERE fr.version_id = CAST(:vid AS uuid) AND jsonb_typeof(f.value_fix_map) = 'object'
       AND f.value_fix_map -> (fr.field_values ->> (f.details->>'field_checked')) ->> 'suggested_value' IS NOT NULL
"""

# The SAP key field a record is named by, and where its name lives. Composite keys are named by
# their first field that has an entry (LIFNR=..|BUKRS=.. by LFA1.NAME1). Personal data is never
# read (checks.profiling.is_sensitive): HR and person records show their key only.
NAME_FIELDS: dict[str, tuple[str, str, Optional[str]]] = {
    "MATNR": ("MAKT", "MAKTX", "SPRAS"),
    "LIFNR": ("LFA1", "NAME1", None),
    "KUNNR": ("KNA1", "NAME1", None),
    "PARTNER": ("BUT000", "NAME_ORG1", None),
    "SAKNR": ("SKAT", "TXT50", "SPRAS"),
    "ANLN1": ("ANLA", "TXT50", None),
    "KOSTL": ("CSKT", "KTEXT", "SPRAS"),
    "PRCTR": ("CEPCT", "KTEXT", "SPRAS"),
    "AUFNR": ("AUFK", "KTEXT", None),
    "EQUNR": ("EQKT", "EQKTX", "SPRAS"),
    "TPLNR": ("IFLOTX", "PLTXT", "SPRAS"),
    "PSPNR": ("PRPS", "POST1", None),
    "PSPHI": ("PROJ", "POST1", None),
    "EBELN": ("EKKO", "LIFNR", None),
    "VBELN": ("VBAK", "KUNNR", None),
    "WERKS": ("T001W", "NAME1", None),
    "BUKRS": ("T001", "BUTXT", None),
    "CHARG": ("MCH1", "MATNR", None),
}
_LANG_PREFERENCE = ("E", "EN")


def _p(tenant_id: str, version_id: str, scope: str) -> dict:
    return {"tid": str(tenant_id), "vid": str(version_id), "scope": scope}


def _group_statuses(session, p: dict, check_ids: Optional[list[str]] = None) -> None:
    where = "AND fr.check_id = ANY(:checks)" if check_ids else ""
    session.execute(text(f"""
        UPDATE work_groups g SET statuses = s.statuses
          FROM (SELECT check_id, jsonb_object_agg(st, n) AS statuses FROM (
                  SELECT check_id, {_STATUS_OF_RANK.format(r="status_rank")} AS st, count(*) AS n
                    FROM ({_STATUS_ROWS.format(where=where)}) x GROUP BY check_id, status_rank) y
                GROUP BY check_id) s
         WHERE g.version_id = CAST(:vid AS uuid) AND g.check_id = s.check_id"""), {**p, "checks": check_ids or []})


def _records_sql(where: str) -> str:
    return f"""
        INSERT INTO work_records (tenant_id, version_id, scope, module, record_key, issues, sev_rank, checks,
                                  proposed, status, assigned_to, due_at, updated_at)
        SELECT CAST(:tid AS uuid), CAST(:vid AS uuid), :scope, x.module, x.record_key, count(*), min(x.sev_rank),
               array_agg(x.check_id ORDER BY x.sev_rank, x.check_id), count(pr.check_id),
               {_STATUS_OF_RANK.format(r="min(x.status_rank)")},
               (array_agg(x.assigned_to) FILTER (WHERE x.assigned_to IS NOT NULL))[1], min(x.due_at), now()
          FROM ({_STATUS_ROWS.format(where=where)}) x
          LEFT JOIN tmp_proposed pr ON pr.check_id = x.check_id AND pr.record_key = x.record_key
         GROUP BY x.module, x.record_key
        ON CONFLICT (version_id, module, record_key) DO UPDATE
           SET issues = EXCLUDED.issues, sev_rank = EXCLUDED.sev_rank, checks = EXCLUDED.checks,
               proposed = EXCLUDED.proposed, status = EXCLUDED.status, assigned_to = EXCLUDED.assigned_to,
               due_at = EXCLUDED.due_at,
               updated_at = now()"""


def _proposed_temp(session, p: dict) -> None:
    session.execute(text("CREATE TEMP TABLE IF NOT EXISTS tmp_proposed (check_id text, record_key text) ON COMMIT DROP"))
    session.execute(text("TRUNCATE tmp_proposed"))
    session.execute(text(f"INSERT INTO tmp_proposed {_PROPOSED_ROWS}"), p)
    session.execute(text("CREATE INDEX IF NOT EXISTS tmp_proposed_ix ON tmp_proposed (check_id, record_key)"))


def build(session, tenant_id: str, version_id: str, frames=None) -> dict:
    """(Re)build the run's work_groups and work_records, one object per transaction. ``frames`` (the
    run's extracted tables, when the caller still holds them) names the records."""
    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    meta = session.execute(text("SELECT metadata FROM analysis_versions WHERE id = CAST(:v AS uuid)"),
                           {"v": str(version_id)}).scalar() or {}
    p = _p(tenant_id, version_id, scope_of(meta))
    # The run counts as built (metadata.worklist_built_at, read by GET /work/summary) only once every object's
    # records, the names and the groups are in: a build that fails half way shows as not built, never as a
    # list with objects missing.
    session.execute(text("UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) - 'worklist_built_at' "
                         "WHERE id = CAST(:vid AS uuid)"), p)
    session.execute(text("DELETE FROM work_groups WHERE version_id = CAST(:vid AS uuid)"), p)
    session.execute(text("DELETE FROM work_records WHERE version_id = CAST(:vid AS uuid)"), p)
    session.commit()

    modules = session.execute(text(
        "SELECT DISTINCT module FROM finding_records WHERE version_id = CAST(:vid AS uuid)"), p).scalars().all()
    records = 0
    for module in modules:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        _proposed_temp(session, p)  # ON COMMIT DROP: rebuilt in each object's transaction
        records += session.execute(text(_records_sql("AND fr.module = :module")), {**p, "module": module}).rowcount
        session.commit()
    named = name_records(session, p, frames) if frames is not None else 0

    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
    session.execute(text(f"""
        INSERT INTO work_groups (tenant_id, version_id, check_id, module, severity, sev_rank, dimension, message,
                                 field, records, population, truncated)
        SELECT f.tenant_id, f.version_id, f.check_id, f.module, f.severity, {SEV_RANK_SQL.format(c="f.severity")},
               f.dimension, COALESCE(f.details->>'message', f.check_id), f.details->>'field_checked',
               f.affected_count, f.total_count,
               COALESCE((f.details->>'failing_keys_truncated')::boolean, false)
          FROM findings f
         WHERE f.version_id = CAST(:vid AS uuid) AND f.affected_count > 0
           AND COALESCE(f.finding_type, 'rule') = 'rule' AND f.details->>'error' IS NULL"""), p)
    _proposed_temp(session, p)
    session.execute(text("""
        UPDATE work_groups g SET proposed = s.n
          FROM (SELECT check_id, count(*) AS n FROM tmp_proposed GROUP BY check_id) s
         WHERE g.version_id = CAST(:vid AS uuid) AND g.check_id = s.check_id"""), p)
    _group_statuses(session, p)
    pruned = prune(session, p)
    session.execute(text("UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) "
                         "|| jsonb_build_object('worklist_built_at', now()::text) WHERE id = CAST(:vid AS uuid)"), p)
    session.commit()
    return {"groups": session.execute(text("SELECT count(*) FROM work_groups WHERE version_id = CAST(:vid AS uuid)"),
                                      p).scalar(), "records": records, "named": named, "pruned_runs": pruned}


def refresh(session, tenant_id: str, scope: str, keys: Iterable[tuple[str, str]]) -> int:
    """Recompute the work rows of ``(check_id, record_key)`` pairs after a decision, in every kept run
    of the system that lists them. The caller has set app.tenant_id and commits."""
    keys = list(dict.fromkeys(keys))
    if not keys:
        return 0
    checks = sorted({c for c, _ in keys})
    record_keys = sorted({k for _, k in keys})
    runs = session.execute(text("""
        SELECT DISTINCT g.version_id::text FROM work_groups g
         WHERE g.tenant_id = CAST(:tid AS uuid) AND g.check_id = ANY(:checks)
           AND EXISTS (SELECT 1 FROM work_records w WHERE w.version_id = g.version_id AND w.scope = :scope)"""),
        {"tid": str(tenant_id), "checks": checks, "scope": scope}).scalars().all()
    n = 0
    for vid in runs:
        p = _p(tenant_id, vid, scope)
        _proposed_temp(session, p)
        n += session.execute(text(_records_sql("AND fr.record_key = ANY(:keys)")), {**p, "keys": record_keys}).rowcount
        _group_statuses(session, p, checks)
    return n


def refresh_items(session, tenant_id: str, where: str, params: dict) -> int:
    """refresh() for the (scope, check, record) of the rows ``SELECT scope, check_id, record_key FROM <where>``
    picks: a fix batch's items, or record issues by id."""
    rows = session.execute(text(f"SELECT scope, check_id, record_key FROM {where}"), params).fetchall()
    by_scope: dict[str, list[tuple[str, str]]] = {}
    for scope, check, key in rows:
        by_scope.setdefault(scope, []).append((check, key))
    return sum(refresh(session, tenant_id, scope, keys) for scope, keys in by_scope.items())


def refresh_batch(session, tenant_id: str, batch_id: str) -> int:
    return refresh_items(session, tenant_id, "remediation_items WHERE batch_id = CAST(:b AS uuid)", {"b": str(batch_id)})


def refresh_issues(session, tenant_id: str, issue_ids: list) -> int:
    return refresh_items(session, tenant_id, "record_issues WHERE id = ANY(CAST(:ids AS uuid[]))",
                         {"ids": [str(i) for i in issue_ids]})


def name_records(session, p: dict, frames) -> int:
    """Fill work_records.name from the run's extracted name tables (NAME_FIELDS)."""
    session.execute(text("SET app.tenant_id = :tid"), {"tid": p["tid"]})
    session.execute(text("CREATE TEMP TABLE IF NOT EXISTS tmp_names (field text, value text, name text) ON COMMIT DROP"))
    session.execute(text("TRUNCATE tmp_names"))
    rows: list[tuple[str, str, str]] = []
    for field, (table, name_col, lang_col) in NAME_FIELDS.items():
        if is_sensitive(table, name_col):
            continue
        df = getattr(frames, "frames", {}).get(table)
        cols = [f"{table}.{field}", f"{table}.{name_col}"] + ([f"{table}.{lang_col}"] if lang_col else [])
        if df is None or any(c not in df.columns for c in cols):
            continue
        sub = df[cols].dropna(subset=[cols[1]])
        if lang_col:
            lang = sub[cols[2]].astype("string").str.upper()
            sub = sub.assign(_pref=(~lang.isin(_LANG_PREFERENCE)).astype(int)).sort_values("_pref")
        sub = sub.drop_duplicates(subset=[cols[0]])
        values = sub[cols[0]].astype("string").str.strip()
        names = sub[cols[1]].astype("string").str.strip()
        rows.extend((field, v, nm) for v, nm in zip(values, names) if v and nm)
    if not rows:
        return 0
    _copy(session, "tmp_names", ("field", "value", "name"), rows)
    session.execute(text("CREATE INDEX ON tmp_names (field, value)"))
    named = 0
    for field in sorted({r[0] for r in rows}):
        named += session.execute(text("""
            UPDATE work_records w SET name = t.name
              FROM tmp_names t
             WHERE w.version_id = CAST(:vid AS uuid) AND w.name IS NULL AND t.field = :field
               AND t.value = substring(w.record_key from :rx)"""),
            {**p, "field": field, "rx": f"(?:^|\\|){re.escape(field)}=([^|]*)"}).rowcount
    return named


def prune(session, p: dict) -> int:
    """Drop the work rows of a system's runs older than its KEEP_RUNS newest built ones."""
    old = session.execute(text("""
        SELECT version_id FROM (
            SELECT g.version_id, row_number() OVER (ORDER BY av.run_at DESC) AS n
              FROM (SELECT DISTINCT version_id FROM work_records WHERE scope = :scope AND tenant_id = CAST(:tid AS uuid)) g
              JOIN analysis_versions av ON av.id = g.version_id) r
         WHERE n > :keep"""), {**p, "keep": KEEP_RUNS}).scalars().all()
    for v in old:
        session.execute(text("DELETE FROM work_records WHERE version_id = :v"), {"v": v})
        session.execute(text("DELETE FROM work_groups WHERE version_id = :v"), {"v": v})
    return len(old)
