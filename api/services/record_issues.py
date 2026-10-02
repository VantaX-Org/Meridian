"""Record-level findings and their lifecycle across analysis runs.

After a run's findings are stored:

1. Every failing record key is written to ``finding_records`` (version, check).
2. ``record_issues`` (one per scope + check + record) is reconciled:
   - failing now, unknown before      → created ``open``
   - failing now, previously resolved → re-opened (event ``reopened``)
   - not failing now, the check ran cleanly (no error, key list not
     truncated) AND the record is present in this run's data → resolved
     ``verified_fixed`` (event ``auto_resolved``). A record absent from the
     extract is never assumed fixed.
   ``accepted`` issues stay accepted while they keep failing.

Set-based SQL throughout: keys go through COPY into temp tables (COPY into
RLS tables is not allowed), then one INSERT/UPDATE per step.
"""

from __future__ import annotations

import csv
import io
from typing import Iterable

from sqlalchemy import text

from checks.base import record_keys

# Row-position keys ("row:17") are not stable across runs → never tracked.
_UNSTABLE = "row:%"


def scope_of(metadata: dict) -> str:
    return str(metadata.get("system_id") or "upload")


def _copy(session, table: str, columns: tuple[str, ...], rows: Iterable[tuple]) -> int:
    buf = io.StringIO()
    w = csv.writer(buf)
    n = 0
    for r in rows:
        w.writerow(["" if v is None else v for v in r])
        n += 1
    buf.seek(0)
    with session.connection().connection.cursor() as cur:
        cur.copy_expert(f"COPY {table} ({', '.join(columns)}) FROM STDIN WITH (FORMAT csv, NULL '')", buf)
    return n


def present_keys(results, frames) -> set[tuple[str, str]]:
    """(grain, record_key) of every record evaluated in this run, per key layout used."""
    out: set[tuple[str, str]] = set()
    seen: set[tuple[str, tuple[str, ...]]] = set()
    for r in results:
        keys = tuple((r.details or {}).get("record_key_fields") or ())
        layout = (r.grain or "", keys)
        if not keys or layout in seen:
            continue
        seen.add(layout)
        df = frames.frames.get(r.grain) if r.grain else frames.flat
        if df is None or any(k not in df.columns for k in keys):
            continue
        out.update((layout[0], k) for k in record_keys(df, list(keys)).dropna().unique())
    return out


def track(session, tenant_id: str, version_id: str, scope: str, results, frames) -> dict:
    """Persist finding_records and reconcile record_issues for one version."""
    session.execute(text(
        "CREATE TEMP TABLE IF NOT EXISTS tmp_finding_records "
        "(check_id text, module text, grain text, record_key text) ON COMMIT DROP"))
    session.execute(text(
        "CREATE TEMP TABLE IF NOT EXISTS tmp_present (grain text, record_key text) ON COMMIT DROP"))
    session.execute(text("TRUNCATE tmp_finding_records, tmp_present"))

    failing = _copy(session, "tmp_finding_records", ("check_id", "module", "grain", "record_key"), (
        (r.check_id, r.module, r.grain, k)
        for r in results if r.failing_record_keys
        for k in dict.fromkeys(r.failing_record_keys)
    ))
    _copy(session, "tmp_present", ("grain", "record_key"), present_keys(results, frames))

    p = {"tid": tenant_id, "vid": version_id, "scope": scope}
    # re-analysis of a version replaces its failing records
    session.execute(text("DELETE FROM finding_records WHERE version_id = :vid"), p)
    session.execute(text("""
        INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key)
        SELECT CAST(:tid AS uuid), CAST(:vid AS uuid), check_id, module, NULLIF(grain, ''), record_key
        FROM tmp_finding_records
        ON CONFLICT DO NOTHING
    """), p)

    # Only the newest run of this system drives the issue lifecycle — re-analysing
    # an older version must not resolve or re-open anything.
    newest = session.execute(text("""
        SELECT id::text FROM analysis_versions
         WHERE COALESCE(metadata->>'system_id', 'upload') = :scope AND status NOT IN ('failed', 'extracted')
         ORDER BY run_at DESC LIMIT 1
    """), p).scalar()
    if newest and newest != str(version_id):
        return {"failing_records": failing, "created": 0, "reopened": 0, "auto_resolved": 0,
                "lifecycle": "skipped (not the newest run)"}

    reopened = session.execute(text("""
        WITH hit AS (
            UPDATE record_issues ri
               SET status = 'open', resolution = NULL, resolved_version = NULL, resolved_at = NULL,
                   reopened_count = ri.reopened_count + 1, updated_at = now()
              FROM finding_records fr
             WHERE fr.version_id = :vid AND ri.tenant_id = :tid AND ri.scope = :scope
               AND ri.check_id = fr.check_id AND ri.record_key = fr.record_key AND ri.status = 'resolved'
            RETURNING ri.id
        )
        INSERT INTO record_issue_events (tenant_id, issue_id, action, from_value, to_value, version_id, user_label)
        SELECT :tid, id, 'reopened', 'resolved', 'open', :vid, 'system' FROM hit
    """), p).rowcount

    upsert = session.execute(text("""
        INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, grain, severity,
                                   first_seen_version, last_seen_version)
        SELECT fr.tenant_id, :scope, fr.module, fr.check_id, fr.record_key, fr.grain, f.severity, :vid, :vid
          FROM finding_records fr
          JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
         WHERE fr.version_id = :vid AND fr.record_key NOT LIKE :unstable
        ON CONFLICT (tenant_id, scope, check_id, record_key) DO UPDATE
           SET last_seen_version = EXCLUDED.last_seen_version, last_seen_at = now(),
               severity = EXCLUDED.severity, module = EXCLUDED.module
        RETURNING (xmax = 0) AS created
    """), {**p, "unstable": _UNSTABLE}).fetchall()
    created = sum(1 for (c,) in upsert if c)

    resolved = session.execute(text("""
        WITH ran AS (
            SELECT check_id FROM findings
             WHERE version_id = :vid AND tenant_id = :tid
               AND details->>'error' IS NULL
               AND COALESCE((details->>'failing_keys_truncated')::boolean, false) = false
        ), fixed AS (
            UPDATE record_issues ri
               SET status = 'resolved', resolution = 'verified_fixed', resolved_version = :vid,
                   steward_verdict = COALESCE(ri.steward_verdict, 'real'),
                   resolved_at = now(), updated_at = now()
             WHERE ri.tenant_id = :tid AND ri.scope = :scope AND ri.status <> 'resolved'
               AND NOT EXISTS (SELECT 1 FROM finding_records fr WHERE fr.version_id = :vid
                                  AND fr.check_id = ri.check_id AND fr.record_key = ri.record_key)
               AND ri.check_id IN (SELECT check_id FROM ran)
               AND EXISTS (SELECT 1 FROM tmp_present tp
                            WHERE tp.grain = COALESCE(ri.grain, '') AND tp.record_key = ri.record_key)
            RETURNING ri.id
        )
        INSERT INTO record_issue_events (tenant_id, issue_id, action, to_value, version_id, user_label)
        SELECT :tid, id, 'auto_resolved', 'resolved', :vid, 'system' FROM fixed
    """), p).rowcount

    return {"failing_records": failing, "created": created, "reopened": reopened, "auto_resolved": resolved}


# ── run-to-run diff ───────────────────────────────────────────────────────────

DIFF_SQL = """
    WITH a AS (SELECT check_id, record_key FROM finding_records WHERE version_id = :v1),
         b AS (SELECT check_id, record_key FROM finding_records WHERE version_id = :v2),
         d AS (
            SELECT check_id,
                   COUNT(*) FILTER (WHERE a.record_key IS NULL) AS new,
                   COUNT(*) FILTER (WHERE b.record_key IS NULL) AS resolved,
                   COUNT(*) FILTER (WHERE a.record_key IS NOT NULL AND b.record_key IS NOT NULL) AS persisting
              FROM a FULL JOIN b USING (check_id, record_key)
             GROUP BY check_id
         )
    SELECT d.check_id, COALESCE(f2.module, f1.module) AS module, COALESCE(f2.severity, f1.severity) AS severity,
           d.new, d.resolved, d.persisting,
           f1.check_id IS NOT NULL AND f1.details->>'error' IS NULL AS ran_v1,
           f2.check_id IS NOT NULL AND f2.details->>'error' IS NULL AS ran_v2,
           COALESCE((f1.details->>'failing_keys_truncated')::boolean, false)
             OR COALESCE((f2.details->>'failing_keys_truncated')::boolean, false) AS truncated
      FROM d
      LEFT JOIN findings f1 ON f1.version_id = :v1 AND f1.check_id = d.check_id
      LEFT JOIN findings f2 ON f2.version_id = :v2 AND f2.check_id = d.check_id
"""

_CHANGE = {
    "new": "a.record_key IS NULL",
    "resolved": "b.record_key IS NULL",
    "persisting": "a.record_key IS NOT NULL AND b.record_key IS NOT NULL",
}


def diff_records_sql(change: str) -> str:
    return f"""
        WITH a AS (SELECT check_id, record_key FROM finding_records WHERE version_id = :v1 AND check_id = :cid),
             b AS (SELECT check_id, record_key FROM finding_records WHERE version_id = :v2 AND check_id = :cid)
        SELECT record_key FROM a FULL JOIN b USING (check_id, record_key)
         WHERE {_CHANGE[change]} AND (CAST(:q AS text) IS NULL OR record_key ILIKE :q)
         ORDER BY record_key LIMIT :limit OFFSET :offset
    """

