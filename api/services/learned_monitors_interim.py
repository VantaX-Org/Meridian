"""Learned monitors between full analysis runs.

Every learned figure (score, fail rate, empty share, records checked) exists only after run_checks, so none of them can
be read earlier. One figure can: the rows a sync extracted. ``run_sync`` stores them on ``sync_runs.rows_extracted`` as
soon as the extraction has landed and enqueues the analysis, which takes minutes to hours. Until that analysis finishes
(or when it fails), the extraction row count is the only fresh volume signal Meridian holds for the object.

This module judges it with the same baseline, ``judge`` and learned minimum as the per-run monitor (no second
detector), with one difference in the points: they are the row counts of the profile's earlier syncs whose analysis
finished, so the unit matches (rows extracted, not records checked). Stewards' decisions on the object's volume monitor
apply as they do for a run.

Left out on purpose, with the reason:
  * score, fail rate, empty share: exist only after the checks ran. Nothing real exists between runs.
  * delta and sampled syncs: the row count is not the object's volume, so it is not comparable.
  * profiles with more than one module: ``rows_extracted`` sums all their tables and cannot be split by module.
  * ``extraction_changes`` and ``record_hashes``: written at extraction time too, but per version and table; they add
    no earlier signal than ``rows_extracted``.

Aggregates only. Reads, then writes only break rows. The caller set ``app.tenant_id``.
"""
import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import learned_monitors as lm
from api.services.version_status import FINISHED, finished_sql

WINDOW_HOURS = 72  # a sync older than this with no finished analysis is a stuck run, not "between runs"

# The latest completed sync per profile whose analysis has not finished. Single module, full extraction only.
PENDING_SQL = """
    SELECT DISTINCT ON (sr.profile_id) sr.id::text, sr.profile_id::text, sr.rows_extracted, sr.started_at,
           v.id::text, v.status, COALESCE(sp.modules[1], sp.domain)
      FROM sync_runs sr
      JOIN sync_profiles sp ON sp.id = sr.profile_id AND sp.tenant_id = sr.tenant_id
      JOIN analysis_versions v ON v.tenant_id = sr.tenant_id AND v.metadata->>'sync_run_id' = sr.id::text
     WHERE sr.tenant_id = :tid AND sr.status = 'completed' AND sr.rows_extracted > 0
       AND sr.started_at > now() - make_interval(hours => :hours)
       AND COALESCE(sp.extraction_mode, 'full') = 'full' AND COALESCE(sp.max_rows, 0) = 0
       AND COALESCE(cardinality(NULLIF(sp.modules, '{}'::text[])), 1) = 1
       AND v.metadata->>'archived' IS DISTINCT FROM 'true'
     ORDER BY sr.profile_id, sr.started_at DESC"""

HISTORY_SQL = f"""
    SELECT v.id::text, sr.started_at, sr.rows_extracted
      FROM sync_runs sr
      JOIN analysis_versions v ON v.tenant_id = sr.tenant_id AND v.metadata->>'sync_run_id' = sr.id::text
     WHERE sr.tenant_id = :tid AND sr.profile_id = CAST(:pid AS uuid) AND sr.status = 'completed'
       AND sr.rows_extracted > 0 AND sr.started_at < :at AND {finished_sql('v.status')}
     ORDER BY sr.started_at DESC LIMIT :n"""


def detect_interim(session: Session, tid: str, now: Optional[datetime] = None) -> list[dict]:
    """The interim volume breaks of the tenant: one dict per pending sync that breaks its learned baseline, with the
    ``version_id`` and ``module`` it belongs to. An object with too few earlier syncs is learning: no break."""
    now = now or datetime.now(timezone.utc)
    out = []
    for sync_id, pid, rows, started, vid, status, module in session.execute(
            text(PENDING_SQL), {"tid": tid, "hours": WINDOW_HOURS}).fetchall():
        if status in FINISHED:
            continue
        pts = [(h[0], h[1], float(h[2])) for h in reversed(session.execute(
            text(HISTORY_SQL), {"tid": tid, "pid": pid, "at": started, "n": lm.HISTORY}).fetchall())]
        decided = lm._decisions(session, tid, module).get("records|", [])
        pts = lm.apply_decisions(pts, decided, {p[0]: p[1] for p in pts})
        me = lm.learned_minimums(session, tid, module, now).get(("records", ""))
        base = lm.baseline(pts, started, **lm.settings("records", me))
        if base is None:
            continue
        b = lm.judge("records", "", float(rows), base, me)
        if b:
            out.append({**b, "version_id": vid, "module": module, "sync_run_id": sync_id})
    return out


def store_interim(session: Session, tid: str, breaks: list[dict]) -> int:
    """Write the breaks as ``source = 'interim'`` rows. Idempotent: a break already stored (open or decided) is left
    as it is; an open interim break that no longer holds is removed. A version that finished meanwhile gets none (its
    own run detection owns it). Returns the number of rows inserted."""
    inserted = 0
    keep: dict[tuple[str, str], list[str]] = {}
    for b in breaks:
        keep.setdefault((b["version_id"], b["module"]), []).append(b["kind"])
        res = session.execute(text(f"""
            INSERT INTO learned_monitor_breaks (tenant_id, version_id, module, kind, metric, subject_code, severity,
                expected_low, expected_high, median, observed, baseline_runs, baseline_run_ids, method, source)
            SELECT :tid, v.id, :m, :k, :me, :s, :sev, :lo, :hi, :md, :o, :n, CAST(:ids AS jsonb), :meth, 'interim'
              FROM analysis_versions v
             WHERE v.id = CAST(:vid AS uuid) AND v.tenant_id = :tid AND NOT ({finished_sql('v.status')})
            ON CONFLICT ON CONSTRAINT uq_learned_monitor_breaks DO NOTHING"""),
            {"tid": tid, "vid": b["version_id"], "m": b["module"], "k": b["kind"], "me": b["metric"],
             "s": b["subject_code"], "sev": b["severity"], "lo": b["low"], "hi": b["high"], "md": b["median"],
             "o": b["observed"], "n": b["baseline_runs"], "ids": json.dumps(b["baseline_run_ids"]), "meth": b["method"]})
        inserted += res.rowcount or 0
        session.execute(text("""
            UPDATE learned_monitor_breaks b SET status = 'snoozed', snoozed_until = s.until
              FROM (SELECT kind, subject_code, max(snoozed_until) AS until FROM learned_monitor_breaks
                     WHERE tenant_id = :tid AND module = :m AND status = 'snoozed' AND snoozed_until > now()
                     GROUP BY 1, 2) s
             WHERE b.tenant_id = :tid AND b.version_id = CAST(:vid AS uuid) AND b.module = :m AND b.status = 'open'
               AND b.source = 'interim' AND b.kind = s.kind AND b.subject_code = s.subject_code"""),
            {"tid": tid, "vid": b["version_id"], "m": b["module"]})
    # open interim breaks of a still-pending version that this pass did not find again
    pending = session.execute(text(f"""
        SELECT b.version_id::text, b.module FROM learned_monitor_breaks b
          JOIN analysis_versions v ON v.id = b.version_id AND v.tenant_id = b.tenant_id
         WHERE b.tenant_id = :tid AND b.source = 'interim' AND b.status = 'open'
           AND NOT ({finished_sql('v.status')}) GROUP BY 1, 2"""), {"tid": tid}).fetchall()
    for vid, module in pending:
        session.execute(text("""
            DELETE FROM learned_monitor_breaks WHERE tenant_id = :tid AND version_id = CAST(:vid AS uuid)
               AND module = :m AND source = 'interim' AND status = 'open' AND kind <> ALL(CAST(:kinds AS text[]))"""),
                        {"tid": tid, "vid": vid, "m": module, "kinds": keep.get((vid, module), [])})
    return inserted


def interim_sentence(observed: float) -> str:
    """The line that tells a reader this break is from an extraction, not a finished analysis."""
    return (f"Found between full runs: the extraction landed {int(observed):,} rows and its analysis has not "
            f"finished. Compared with the rows of earlier syncs of this object, not with a finished run.")
