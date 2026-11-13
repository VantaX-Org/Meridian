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
       AND ri.status IN ('open', 'in_progress') AND ri.id <> ALL(CAST(:skip AS uuid[]))
       AND NOT EXISTS (SELECT 1 FROM finding_records a
                        WHERE a.version_id = :base AND a.check_id = b.check_id AND a.record_key = b.record_key)
       AND NOT EXISTS (SELECT 1 FROM remediation_items i JOIN remediation_batches rb ON rb.id = i.batch_id
                        WHERE i.issue_id = ri.id
                          AND (rb.status IN ('draft', 'approved')
                               OR (rb.status IN ('awaiting_load', 'exported') AND i.recon_status IS NULL)))
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


# the skipped issues new against the baseline, per check: taken off the regression counts
_SKIP_NEW_SQL = """
    SELECT ri.check_id, count(*) AS n FROM record_issues ri
     WHERE ri.tenant_id = :t AND ri.id = ANY(CAST(:skip AS uuid[]))
       AND NOT EXISTS (SELECT 1 FROM finding_records a
                        WHERE a.version_id = :base AND a.check_id = ri.check_id AND a.record_key = ri.record_key)
     GROUP BY ri.check_id
"""


def check(session, tenant_id: str, version_id: str, scope: str, skip: Optional[list[str]] = None) -> Optional[dict]:
    """Compare a run with its system's pinned baseline; draft a batch for new regressions.

    Pinned-only: an explicit baseline is intent to clean, so a run with no pin drafts nothing (``status``
    shows its change against the previous run instead). Returns the summary stored on the run (None when the
    system has no baseline). ``skip`` are issues from ``fix_not_in_source``: not regressions, left out of the
    counts and the batch. The caller owns the transaction.
    """
    skip = skip or []
    base = session.execute(text(_BASELINE_SQL), {"scope": scope, "v": version_id}).fetchone()
    if not base:
        return None
    summary, regressed = _summary(session, base, version_id)
    if skip:
        less = {r.check_id: r.n for r in session.execute(text(_SKIP_NEW_SQL), {
            "t": tenant_id, "skip": skip, "base": base[0]})}
        for c in regressed:
            c["new"] -= min(c["new"], less.get(c["check_id"], 0))
        regressed = [c for c in regressed if c["new"]]
        summary |= {"new_records": sum(c["new"] for c in regressed), "regressed_checks": regressed[:50],
                    "regressed_check_count": len(regressed), "fix_not_in_source": len(skip)}

    if regressed:
        issues = [dict(r._mapping) for r in session.execute(text(_ISSUES_SQL), {
            "scope": scope, "v": version_id, "base": base[0], "skip": skip,
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


# The cleaned copy (an uploaded cleaning workbook, metadata.cleaned_overlay) made from the previous real
# extraction of this lineage: its edits were made in Excel, not in SAP, so a real extraction that still fails
# on those records reopens their issues. Those reopenings are noted and kept out of the regressions.
_FIX_NOT_IN_SOURCE_SQL = f"""
    WITH prev AS (
        SELECT p.id FROM analysis_versions p
         WHERE p.tenant_id = :t AND p.id <> CAST(:v AS uuid) AND {same_lineage_as("v", "p")}
           AND p.metadata->>'source' IS DISTINCT FROM 'roundtrip' AND p.status IN ('complete', 'agents_complete')
           AND p.run_at < (SELECT run_at FROM analysis_versions WHERE id = CAST(:v AS uuid))
         ORDER BY p.run_at DESC LIMIT 1),
    ov AS (
        SELECT o.metadata->'cleaned_overlay' AS c FROM analysis_versions o, prev
         WHERE o.tenant_id = :t AND o.metadata->>'source' = 'roundtrip'
           AND o.metadata->'cleaned_overlay'->>'base_version_id' = prev.id::text
           AND o.status IN ('complete', 'agents_complete')
         ORDER BY o.run_at DESC LIMIT 1),
    e AS (SELECT DISTINCT x->>'table' AS grain, x->>'key' AS record_key
            FROM ov, jsonb_array_elements(ov.c->'edits') x),
    hit AS (SELECT DISTINCT ri.id FROM record_issue_events ev
              JOIN record_issues ri ON ri.id = ev.issue_id AND ri.tenant_id = :t AND ri.scope = :scope
              JOIN e ON e.grain = ri.grain AND e.record_key = ri.record_key
             WHERE ev.tenant_id = :t AND ev.version_id = CAST(:v AS uuid) AND ev.action = 'reopened'),
    noted AS (INSERT INTO record_issue_events (tenant_id, issue_id, action, note, version_id, user_label)
              SELECT :t, id, 'comment', :note, CAST(:v AS uuid), 'system' FROM hit RETURNING issue_id)
    SELECT issue_id FROM noted
"""

FIX_NOT_IN_SOURCE = ("Fix not yet in source: this record was corrected in the cleaning workbook, but the new "
                     "extraction still holds the old value. Make the change in SAP.")


def fix_not_in_source(session, tenant_id: str, version_id: str, scope: str) -> list[str]:
    """Issues this real extraction reopened only because the earlier cleaned copy's edits are not yet in SAP.
    Each gets a note, the run stores the count, and the caller passes the ids to ``check`` and
    ``notify_since_previous`` as ``skip``. The caller owns the transaction."""
    ids = [str(r[0]) for r in session.execute(text(_FIX_NOT_IN_SOURCE_SQL), {
        "t": tenant_id, "v": version_id, "scope": scope, "note": FIX_NOT_IN_SOURCE})]
    if ids:
        session.execute(text(
            "UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) "
            "|| jsonb_build_object('fix_not_in_source', CAST(:n AS int)) "
            "WHERE id = CAST(:v AS uuid) AND tenant_id = :t"),
            {"n": len(ids), "v": version_id, "t": tenant_id})
    return ids


# issues of this run new or reopened, per object, when the lineage has an earlier complete run
_SINCE_PREVIOUS_SQL = f"""
    SELECT ri.module, count(*) FILTER (WHERE ri.first_seen_version = CAST(:v AS uuid)) AS new,
           count(*) FILTER (WHERE ev.issue_id IS NOT NULL) AS reopened
      FROM record_issues ri
      LEFT JOIN (SELECT DISTINCT issue_id FROM record_issue_events
                  WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) AND action = 'reopened') ev
             ON ev.issue_id = ri.id
     WHERE ri.tenant_id = :t AND ri.scope = :scope
       AND (ri.first_seen_version = CAST(:v AS uuid) OR ev.issue_id IS NOT NULL)
       AND ri.id <> ALL(CAST(:skip AS uuid[]))
       AND EXISTS (SELECT 1 FROM analysis_versions p
                    WHERE p.tenant_id = :t AND p.id <> CAST(:v AS uuid) AND {same_lineage_as("v", "p")}
                      AND p.status IN ('complete', 'agents_complete')
                      AND p.run_at < (SELECT run_at FROM analysis_versions WHERE id = CAST(:v AS uuid)))
     GROUP BY ri.module ORDER BY ri.module
"""


def notify_since_previous(session, tenant_id: str, version_id: str, scope: str,
                          skip: Optional[list[str]] = None) -> dict:
    """With no pinned baseline, alert on issues new or reopened since the previous run of the lineage, per
    object. The first run of a lineage alerts nothing. Returns ``{module: {"new", "reopened"}}``."""
    per = {r.module: {"new": r.new, "reopened": r.reopened} for r in session.execute(text(_SINCE_PREVIOUS_SQL), {
        "t": tenant_id, "v": version_id, "scope": scope, "skip": skip or []})}
    if not per:
        return per
    from api.services.notifications import create_notification_sync
    new, reopened = sum(m["new"] for m in per.values()), sum(m["reopened"] for m in per.values())
    create_notification_sync(
        tenant_id=tenant_id, user_id=None, type="monitor",
        title=f"{new} new and {reopened} reopened issue(s) since the previous run",
        body="; ".join(f"{m}: {c['new']} new, {c['reopened']} reopened" for m, c in per.items()),
        link=app_links.run(str(version_id)), session=session)
    return per


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
