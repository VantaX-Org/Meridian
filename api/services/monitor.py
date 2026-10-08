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

from api.services.record_issues import DIFF_SQL

MONITOR_LABEL = "Meridian monitor"
MAX_ITEMS = 50_000

_BASELINE_SQL = """
    SELECT id, run_at FROM analysis_versions
     WHERE COALESCE(metadata->>'system_id', 'upload') = :scope AND id <> :v
       AND metadata->>'baseline' = 'true' AND status IN ('complete', 'agents_complete')
       AND run_at <= (SELECT run_at FROM analysis_versions WHERE id = :v)
     ORDER BY run_at DESC LIMIT 1
"""

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


def check(session, tenant_id: str, version_id: str, scope: str) -> Optional[dict]:
    """Compare a run with its system's pinned baseline; draft a batch for new regressions.

    Returns the summary stored on the run (None when the system has no baseline).
    The caller owns the transaction.
    """
    base = session.execute(text(_BASELINE_SQL), {"scope": scope, "v": version_id}).fetchone()
    if not base:
        return None
    rows = session.execute(text(DIFF_SQL), {"v1": base[0], "v2": version_id}).fetchall()
    regressed = sorted(
        ({"check_id": r.check_id, "module": r.module, "severity": r.severity, "new": r.new}
         for r in rows if r.new and r.ran_v1 and r.ran_v2 and not r.truncated),
        key=lambda c: -c["new"])
    summary = {"baseline_id": str(base[0]), "baseline_run_at": base[1].isoformat() if base[1] else None,
               "new_records": sum(c["new"] for c in regressed), "regressed_checks": regressed[:50],
               "regressed_check_count": len(regressed),
               "resolved_records": sum(r.resolved for r in rows if r.ran_v1 and r.ran_v2 and not r.truncated),
               "batch_id": None, "batch_items": 0}

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
        link=f"/workbench?tab=batches&batch={summary['batch_id']}" if summary["batch_id"]
        else f"/versions?v2={version_id}",
        session=session)

    from workers.tasks.send_notifications import _channels, build_alert, deliver
    from workers.tasks.send_user_invitation import _resolve_app_base_url
    alert = build_alert("immediate", version_id, None, None, set(), 0, 0, _resolve_app_base_url(),
                        regressed_records=n)
    for ch in _channels(session, "immediate_critical") if alert else []:
        deliver(ch, alert)


def status(session) -> list[dict]:
    """Per monitored system: its baseline and the newest run's comparison (RLS scopes the tenant)."""
    rows = session.execute(text("""
        WITH base AS (
            SELECT DISTINCT ON (COALESCE(metadata->>'system_id', 'upload'))
                   COALESCE(metadata->>'system_id', 'upload') AS scope, id, run_at, dqs_summary
              FROM analysis_versions
             WHERE metadata->>'baseline' = 'true' AND status IN ('complete', 'agents_complete')
             ORDER BY COALESCE(metadata->>'system_id', 'upload'), run_at DESC
        ), latest AS (
            SELECT DISTINCT ON (COALESCE(metadata->>'system_id', 'upload'))
                   COALESCE(metadata->>'system_id', 'upload') AS scope, id, run_at, dqs_summary,
                   metadata->'monitor' AS monitor
              FROM analysis_versions WHERE status IN ('complete', 'agents_complete')
             ORDER BY COALESCE(metadata->>'system_id', 'upload'), run_at DESC
        )
        SELECT base.scope, s.name AS system_name, base.id AS baseline_id, base.run_at AS baseline_run_at,
               base.dqs_summary AS baseline_dqs, latest.id AS latest_id, latest.run_at AS latest_run_at,
               latest.dqs_summary AS latest_dqs, latest.monitor
          FROM base JOIN latest USING (scope)
          LEFT JOIN sap_systems s ON s.id::text = base.scope
         ORDER BY system_name NULLS LAST, base.scope
    """)).mappings().all()
    from workers.tasks.send_notifications import _overall
    return [{
        "scope": r["scope"], "system_name": r["system_name"] or ("Imported files" if r["scope"] == "upload" else None),
        "baseline": {"id": str(r["baseline_id"]), "run_at": r["baseline_run_at"], "dqs": _overall(r["baseline_dqs"])},
        "latest": {"id": str(r["latest_id"]), "run_at": r["latest_run_at"], "dqs": _overall(r["latest_dqs"])},
        "monitor": r["monitor"] if r["latest_id"] != r["baseline_id"] else None,
    } for r in rows]
