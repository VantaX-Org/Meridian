"""Post-cleanup monitoring: every new run of a system is compared with its pinned baseline.

Pin the run taken after a cleanup as the baseline (POST /versions/{id}/baseline).
From then on, each newer run of that system (the scheduled sync profile download
re-extracts it, ``daily_analysis`` re-checks it) is diffed against the baseline per
rule. Records failing now that passed in the baseline are regressions: the run's
``metadata.monitor`` records the result, stewards are notified, and the regressed
records not already in an open fix batch are drafted into a new batch. The draft's
high-confidence auto_fix proposals still need a person to accept them and a second
person to approve; Meridian never posts to SAP.
"""

from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import text

from api.services import app_links
from api.services.record_issues import DIFF_SQL
from api.services.run_lineage import lineage_sql, same_lineage_as

MONITOR_LABEL = "Meridian monitor"
MAX_ITEMS = 50_000

# the pinned baseline in the run's own lineage: its system, or uploads of the same objects
_BASELINE_SQL = f"""
    SELECT id, run_at FROM analysis_versions
     WHERE {same_lineage_as("v")} AND id <> :v
       AND metadata->>'baseline' = 'true' AND status IN ('complete', 'agents_complete')
       AND run_at <= (SELECT run_at FROM analysis_versions WHERE id = :v)
     ORDER BY run_at DESC LIMIT 1
"""

PINNED_BASELINE_SQL = _BASELINE_SQL  # the one definition of "pinned baseline", also read by object_monitor

# regressed records still open and not already in a draft, approved, or exported-but-unreconciled batch
_ISSUES_SQL = """
    SELECT ri.id AS issue_id, ri.scope, ri.module, ri.check_id, ri.record_key, ri.grain,
           ri.last_seen_version, f.details->>'field_checked' AS field
      FROM finding_records b
      JOIN record_issues ri ON ri.scope = :scope AND ri.check_id = b.check_id AND ri.record_key = b.record_key
      LEFT JOIN findings f ON f.version_id = :v AND f.check_id = b.check_id
     WHERE b.version_id = :v AND b.check_id = ANY(:checks)
       AND ri.status IN ('open', 'in_progress')
       AND NOT EXISTS (SELECT 1 FROM finding_records a
                        WHERE a.version_id = :base AND a.check_id = b.check_id AND a.record_key = b.record_key)
       AND NOT EXISTS (SELECT 1 FROM remediation_items i JOIN remediation_batches rb ON rb.id = i.batch_id
                        WHERE i.issue_id = ri.id
                          AND (rb.status IN ('draft', 'approved')
                               OR (rb.status = 'exported' AND i.recon_status IS NULL)))
     LIMIT :lim
"""


def _summary(session, base, version_id: str) -> tuple[dict, list[dict]]:
    """The run's change against ``base`` (id, run_at): the summary stored on the run, and every regressed check."""
    rows = session.execute(text(DIFF_SQL), {"v1": base[0], "v2": version_id}).fetchall()
    regressed = sorted(
        ({"check_id": r.check_id, "module": r.module, "severity": r.severity, "new": r.new}
         for r in rows if r.new and r.ran_v1 and r.ran_v2 and not r.truncated),
        key=lambda c: -c["new"])
    return {"baseline_id": str(base[0]), "baseline_run_at": base[1].isoformat() if base[1] else None,
            "new_records": sum(c["new"] for c in regressed), "regressed_checks": regressed[:50],
            "regressed_check_count": len(regressed),
            "resolved_records": sum(r.resolved for r in rows if r.ran_v1 and r.ran_v2 and not r.truncated),
            "batch_id": None, "batch_items": 0}, regressed


def check(session, tenant_id: str, version_id: str, scope: str) -> Optional[dict]:
    """Compare a run with its system's pinned baseline; draft a batch for new regressions.

    Pinned-only: an explicit baseline is intent to clean, so a run with no pin drafts nothing (``status``
    shows its change against the previous run instead). Returns the summary stored on the run (None when the
    system has no baseline). The caller owns the transaction.
    """
    base = session.execute(text(_BASELINE_SQL), {"scope": scope, "v": version_id}).fetchone()
    if not base:
        return None
    summary, regressed = _summary(session, base, version_id)

    if regressed:
        issues = [dict(r._mapping) for r in session.execute(text(_ISSUES_SQL), {
            "scope": scope, "v": version_id, "base": base[0],
            "checks": [c["check_id"] for c in regressed], "lim": MAX_ITEMS})]
        if issues:
            from api.services.remediation import draft_batch
            day = session.execute(text("SELECT to_char(run_at, 'YYYY-MM-DD') FROM analysis_versions WHERE id = :v"),
                                  {"v": version_id}).scalar()
            batch = draft_batch(session, tenant_id, f"Regressions since baseline — {day}",
                                json.dumps({"version_id": version_id, "baseline_id": str(base[0]), "monitor": True}),
                                issues, None, MONITOR_LABEL)
            summary |= {"batch_id": batch["id"], "batch_items": batch["items"],
                        "batch_auto_approvable": batch["auto_approvable"]}

    session.execute(text("UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) "
                         "|| jsonb_build_object('monitor', CAST(:m AS jsonb)) WHERE id = :v"),
                    {"m": json.dumps(summary), "v": version_id})
    return summary


def notify(session, tenant_id: str, version_id: str, summary: dict) -> None:
    """In-app notice to the tenant, plus the immediate alert channels."""
    if not summary["new_records"]:
        return
    from api.services.notifications import create_notification_sync
    n, k = summary["new_records"], summary["regressed_check_count"]
    batch = (f" {summary['batch_items']} of them are in a new draft fix batch."
             if summary["batch_id"] else " They are already in open fix batches.")
    create_notification_sync(
        tenant_id=tenant_id, user_id=None, type="monitor",
        title=f"{n} record(s) failing again since the post-cleanup baseline",
        body=f"{k} rule(s) regressed.{batch}",
        link=app_links.work(batch=str(summary["batch_id"])) if summary["batch_id"]
        else app_links.run(str(version_id)),
        session=session)

    from workers.tasks.send_notifications import _channels, build_alert, deliver
    from workers.tasks.send_user_invitation import _resolve_app_base_url
    alert = build_alert("immediate", version_id, None, None, set(), 0, 0, _resolve_app_base_url(),
                        regressed_records=n)
    for ch in _channels(session, "immediate_critical") if alert else []:
        deliver(ch, alert)


def status(session) -> list[dict]:
    """Per monitored lineage (a system, or uploads of the same objects): its baseline and the newest
    run's comparison (RLS scopes the tenant). The baseline is the pinned run, else the run before the newest
    in the lineage (``baseline.kind`` says which), so a lineage with two runs is monitored without a pin.
    ``monitor`` is the summary ``check`` stored on the run (pinned baselines only); ``scope`` stays the
    system id or 'upload'."""
    rows = session.execute(text(f"""
        WITH ranked AS (
            SELECT {lineage_sql()} AS lineage, COALESCE(metadata->>'system_id', 'upload') AS scope,
                   id, run_at, dqs_summary, metadata->'monitor' AS monitor,
                   COALESCE(metadata->>'baseline', '') = 'true' AS pinned,
                   row_number() OVER (PARTITION BY {lineage_sql()} ORDER BY run_at DESC) AS rn
              FROM analysis_versions
             WHERE status IN ('complete', 'agents_complete')
               AND metadata->>'purpose' IS DISTINCT FROM 'process_discovery'
        ), pin AS (
            SELECT DISTINCT ON (lineage) * FROM ranked WHERE pinned ORDER BY lineage, run_at DESC
        )
        SELECT l.scope, l.lineage, s.name AS system_name, pin.id IS NOT NULL AS is_pinned,
               COALESCE(pin.id, prev.id) AS baseline_id, COALESCE(pin.run_at, prev.run_at) AS baseline_run_at,
               COALESCE(pin.dqs_summary, prev.dqs_summary) AS baseline_dqs,
               l.id AS latest_id, l.run_at AS latest_run_at, l.dqs_summary AS latest_dqs, l.monitor
          FROM ranked l
          LEFT JOIN pin ON pin.lineage = l.lineage
          LEFT JOIN ranked prev ON prev.lineage = l.lineage AND prev.rn = 2
          LEFT JOIN sap_systems s ON s.id::text = l.scope
         WHERE l.rn = 1 AND COALESCE(pin.id, prev.id) IS NOT NULL
         ORDER BY system_name NULLS LAST, l.scope, l.lineage
    """)).mappings().all()
    from workers.tasks.send_notifications import _overall
    return [{
        "scope": r["scope"], "lineage": r["lineage"], "system_name": r["system_name"] or ("Imported files" if r["scope"] == "upload" else None),
        "baseline": {"id": str(r["baseline_id"]), "run_at": r["baseline_run_at"], "dqs": _overall(r["baseline_dqs"]),
                     "kind": "pinned" if r["is_pinned"] else "previous"},
        "latest": {"id": str(r["latest_id"]), "run_at": r["latest_run_at"], "dqs": _overall(r["latest_dqs"])},
        "monitor": r["monitor"] if r["is_pinned"] and r["latest_id"] != r["baseline_id"] else None,
    } for r in rows]
