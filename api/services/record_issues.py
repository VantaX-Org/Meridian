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

import os

import csv
import io
import json
from typing import Iterable, Iterator

from sqlalchemy import text

from checks.base import record_keys

# Row-position keys ("row:17") are not stable across runs → never tracked.
_UNSTABLE = "row:%"


def scope_of(metadata: dict) -> str:
    return str(metadata.get("system_id") or "upload")


_COPY_CHUNK = 1_000_000  # rows per COPY: bounds the buffer on a 100M-row extract


def _copy(session, table: str, columns: tuple[str, ...], rows: Iterable[tuple], chunk: int = _COPY_CHUNK) -> int:
    sql = f"COPY {table} ({', '.join(columns)}) FROM STDIN WITH (FORMAT csv, NULL '')"
    n = 0
    with session.connection().connection.cursor() as cur:
        buf = io.StringIO()
        w = csv.writer(buf)
        k = 0

        def flush() -> None:
            buf.seek(0)
            cur.copy_expert(sql, buf)
            buf.seek(0)
            buf.truncate()

        for r in rows:
            w.writerow(["" if v is None else v for v in r])
            k += 1
            if k == chunk:
                flush()
                n += k
                k = 0
        if k:
            flush()
            n += k
    return n


def _keyed_values(r) -> dict[str, dict | None]:
    """record_key → the rule's (masked) column values; first occurrence of a key wins."""
    values = r.failing_record_values or []
    out: dict[str, dict | None] = {}
    for i, k in enumerate(r.failing_record_keys):
        out.setdefault(k, values[i] if i < len(values) else None)
    return out


def present_keys(results, frames) -> Iterator[tuple[str, str]]:
    """(grain, record_key) of every record evaluated in this run, per key layout used.
    Streamed, unique within a layout only: a key can repeat across layouts, which the
    EXISTS semijoin on tmp_present does not mind, and one set of 100M keys would not fit."""
    seen: set[tuple[str, tuple[str, ...]]] = set()
    for r in results:
        keys = tuple((r.details or {}).get("record_key_fields") or ())
        layout = (r.grain or "", keys)
        if not keys or layout in seen:
            continue
        seen.add(layout)
        # Read ONLY the key columns. Reaching into frames.frames decoded the whole table: for
        # MARC that was 18.3M rows x 98 columns held in memory purely to build a key string,
        # which is what drove the worker to 14.7 GB and got it OOM-killed during this lifecycle.
        # frame_for projects the columns, so a 98-column table costs 2.
        builder = getattr(frames, "frame_for", None)
        built = builder(list(keys), grain=r.grain) if builder else None
        if built is None:
            df = frames.frames.get(r.grain) if r.grain else frames.flat
        else:
            df = built[0]
        if df is None or any(k not in df.columns for k in keys):
            continue
        for k in record_keys(df, list(keys)).dropna().unique():
            yield layout[0], k


def store_records(session, tenant_id: str, version_id: str, results) -> int:
    """Write the failing records of ``results`` to ``finding_records``, replacing what an
    earlier pass of the same checks on this version stored (a resumed run re-stores a rule)."""
    session.execute(text(
        "CREATE TEMP TABLE IF NOT EXISTS tmp_finding_records "
        "(check_id text, module text, grain text, record_key text, field_values text) ON COMMIT DROP"))
    session.execute(text("TRUNCATE tmp_finding_records"))
    failing = _copy(session, "tmp_finding_records", ("check_id", "module", "grain", "record_key", "field_values"), (
        (r.check_id, r.module, r.grain, k, json.dumps(v) if v else None)
        for r in results if r.failing_record_keys
        for k, v in _keyed_values(r).items()
    ))
    p = {"tid": tenant_id, "vid": version_id}
    session.execute(text("DELETE FROM finding_records WHERE version_id = :vid AND check_id = ANY(:ids)"),
                    {**p, "ids": [r.check_id for r in results]})
    session.execute(text("""
        INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, record_key, field_values)
        SELECT CAST(:tid AS uuid), CAST(:vid AS uuid), check_id, module, NULLIF(grain, ''), record_key,
               CAST(field_values AS jsonb)
        FROM tmp_finding_records
        ON CONFLICT DO NOTHING
    """), p)
    return failing


def track(session, tenant_id: str, version_id: str, scope: str, results, frames, store: bool = True) -> dict:
    """Persist finding_records and reconcile record_issues for one version. ``store=False``:
    the run already streamed its failing records (store_records) as each rule finished."""
    p = {"tid": tenant_id, "vid": version_id, "scope": scope}
    if store:
        # re-analysis of a version replaces its failing records
        session.execute(text("DELETE FROM finding_records WHERE version_id = :vid"), p)
        failing = store_records(session, tenant_id, version_id, results)
    else:
        failing = session.execute(text("SELECT count(*) FROM finding_records WHERE version_id = :vid"), p).scalar()
    # Only the newest run of this system drives the issue lifecycle — re-analysing
    # an older version must not resolve or re-open anything.
    newest = session.execute(text("""
        SELECT id::text FROM analysis_versions
         WHERE COALESCE(metadata->>'system_id', 'upload') = :scope AND status NOT IN ('failed', 'extracted', 'partial')
         ORDER BY run_at DESC LIMIT 1
    """), p).scalar()
    if newest and newest != str(version_id):
        return {"failing_records": failing, "created": 0, "reopened": 0, "auto_resolved": 0,
                "lifecycle": "skipped (not the newest run)"}

    # Process the reconciliation in batches of checks.
    #
    # Everything below - the reopened sweep, the upsert over every failing record, and the resolve
    # sweep - used to run once over the whole version. On a real material_master baseline that is
    # 810 checks and 5.26M failing records: a single upsert, and a resolve sweep whose temp table
    # (tmp_present) had still not finished copying after 42 minutes at 13 GB of disk, before the
    # previous attempt sat in it for over seven hours.
    #
    # Batching bounds each statement to one set of checks and commits per batch, so progress is
    # durable and no single statement can dominate a run. Each batch is idempotent (upserts are
    # ON CONFLICT, sweeps are status-guarded), so a partial run is safe to repeat.
    # tmp_present is created INSIDE each batch, ON COMMIT DROP. It cannot be created once and kept:
    # Session.commit() returns the connection to the pool, so the next batch runs on a different
    # backend where a temp table from the previous one does not exist ("relation tmp_present does
    # not exist" - which is exactly how the first batched rebuild failed). The whole
    # create/copy/index/query cycle now happens within one transaction and is dropped by its commit.
    # tmp_present is only ever probed to decide whether an EXISTING issue should be resolved, so it
    # never needs a key that has no issue. Bounding it by the open issues keeps the copy small.
    tracked = set(session.execute(text("""
        SELECT COALESCE(grain, ''), record_key FROM record_issues
         WHERE tenant_id = :tid AND scope = :scope AND status <> 'resolved'
    """), p).all())

    by_check = {r.check_id: r for r in results}
    # Batch by RECORD VOLUME, not by check count. Each check's failing-key list is capped at 100k,
    # but the distribution is wildly skewed: on the real baseline 50 of 810 checks held 99.5% of
    # the 2.54M records, so a fixed count of 50 per batch put 2.5M rows in the first batch and it
    # did not finish in 24 minutes. Balancing by records makes every batch comparable.
    counts = dict(session.execute(text(
        "SELECT check_id, count(*) FROM finding_records WHERE version_id = :vid GROUP BY check_id",
    ), p).all())
    budget = max(1000, int(os.getenv("MERIDIAN_LIFECYCLE_RECORDS", "200000")))
    batches: list[list[str]] = []
    current: list[str] = []
    running = 0
    for cid, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        n = int(n or 0)
        if current and running + n > budget:
            batches.append(current)
            current, running = [], 0
        current.append(cid)
        running += n
    if current:
        batches.append(current)

    # Derive each key layout's present keys ONCE. The batches reuse them; re-deriving per batch
    # re-reads the same parquet files (MARC alone is 18.3M rows) for every batch, which made the
    # batched rebuild slower than the single-statement version it replaced.
    layout_keys: dict[tuple, list[tuple[str, str]]] = {}
    for r in results:
        keys = tuple((r.details or {}).get("record_key_fields") or ())
        layout = (r.grain or "", keys)
        if not keys or layout in layout_keys:
            continue
        layout_keys[layout] = [(g, k) for g, k in present_keys([r], frames) if (g or "", k) in tracked]

    reopened = created = resolved = 0
    for batch in batches:
        bp = {**p, "batch": batch}
        batch_results = [by_check[c] for c in batch if c in by_check]
        # Re-apply the tenant setting for THIS batch. Session.commit() returns the connection to
        # the pool, so the next batch may run on a different backend that never saw the SET issued
        # before the loop - where RLS then fails with 'unrecognized configuration parameter
        # app.tenant_id' (exactly what the first successful-looking rebuild hit on batch 2).
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        session.execute(text(
            "CREATE TEMP TABLE IF NOT EXISTS tmp_present (grain text, record_key text) ON COMMIT DROP"))
        session.execute(text("TRUNCATE tmp_present"))
        batch_keys: list[tuple[str, str]] = []
        seen_layouts: set[tuple] = set()
        for r in batch_results:
            keys = tuple((r.details or {}).get("record_key_fields") or ())
            layout = (r.grain or "", keys)
            if not keys or layout in seen_layouts:
                continue
            seen_layouts.add(layout)
            batch_keys.extend(layout_keys.get(layout, ()))
        _copy(session, "tmp_present", ("grain", "record_key"), batch_keys)
        session.execute(text("CREATE INDEX ON tmp_present (grain, record_key)"))

        reopened += session.execute(text("""
            WITH hit AS (
                UPDATE record_issues ri
                   SET status = 'open', resolution = NULL, resolved_version = NULL, resolved_at = NULL,
                       reopened_count = ri.reopened_count + 1, updated_at = now(),
                       sla_started_at = NULL, sla_state = NULL, sla_notified = '{}', ack_due_at = NULL,
                       ack_risk_at = NULL, due_at = NULL, risk_at = NULL, acknowledged_at = NULL,
                       sla_paused_at = NULL, snoozed_until = NULL, snooze_reason = NULL,
                       assigned_at = CASE WHEN ri.assigned_to IS NULL THEN NULL ELSE now() END
                  FROM finding_records fr
                 WHERE fr.version_id = :vid AND ri.tenant_id = :tid AND ri.scope = :scope
                   AND ri.check_id = fr.check_id AND ri.record_key = fr.record_key
                   AND ri.status = 'resolved' AND fr.check_id = ANY(:batch)
                RETURNING ri.id
            )
            INSERT INTO record_issue_events (tenant_id, issue_id, action, from_value, to_value, version_id, user_label)
            SELECT :tid, id, 'reopened', 'resolved', 'open', :vid, 'system' FROM hit
        """), bp).rowcount

        upsert = session.execute(text("""
            INSERT INTO record_issues (tenant_id, scope, module, check_id, record_key, grain, severity,
                                       first_seen_version, last_seen_version)
            SELECT fr.tenant_id, :scope, fr.module, fr.check_id, fr.record_key, fr.grain, f.severity, :vid, :vid
              FROM finding_records fr
              JOIN findings f ON f.version_id = fr.version_id AND f.check_id = fr.check_id
             WHERE fr.version_id = :vid AND fr.record_key NOT LIKE :unstable
               AND fr.check_id = ANY(:batch)
            ON CONFLICT (tenant_id, scope, check_id, record_key) DO UPDATE
               SET last_seen_version = EXCLUDED.last_seen_version, last_seen_at = now(),
                   severity = EXCLUDED.severity, module = EXCLUDED.module
            RETURNING (xmax = 0) AS created
        """), {**bp, "unstable": _UNSTABLE}).fetchall()
        created += sum(1 for (c,) in upsert if c)

        resolved += session.execute(text("""
            WITH ran AS (
                SELECT check_id FROM findings
                 WHERE version_id = :vid AND tenant_id = :tid
                   AND details->>'error' IS NULL
                   AND COALESCE((details->>'failing_keys_truncated')::boolean, false) = false
                   AND check_id = ANY(:batch)
            ), fixed AS (
                UPDATE record_issues ri
                   SET status = 'resolved', resolution = 'verified_fixed', resolved_version = :vid,
                       steward_verdict = COALESCE(ri.steward_verdict, 'real'),
                       resolved_at = now(), updated_at = now()
                 WHERE ri.tenant_id = :tid AND ri.scope = :scope AND ri.status <> 'resolved'
                   AND ri.check_id = ANY(:batch)
                   AND NOT EXISTS (SELECT 1 FROM finding_records fr WHERE fr.version_id = :vid
                                      AND fr.check_id = ri.check_id AND fr.record_key = ri.record_key)
                   AND ri.check_id IN (SELECT check_id FROM ran)
                   AND EXISTS (SELECT 1 FROM tmp_present tp
                                WHERE tp.grain = COALESCE(ri.grain, '') AND tp.record_key = ri.record_key)
                RETURNING ri.id
            )
            INSERT INTO record_issue_events (tenant_id, issue_id, action, to_value, version_id, user_label)
            SELECT :tid, id, 'auto_resolved', 'resolved', :vid, 'system' FROM fixed
        """), bp).rowcount
        session.commit()

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

