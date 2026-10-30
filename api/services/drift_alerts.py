"""Config drift alerts: after a config load or sync, who must know and what must be re-scored.

``process`` reads the changes the load or sync wrote to config_drift_log (``run_id`` = the load or sync id), groups
them by area (the config table or config object), and finds the rules of the system's latest run that depend on a
changed area:

  * the rule's reference table (the shipped rule's ``reference_table``, or the ``reference_table`` a value-list rule
    stored in its finding details, e.g. ``T134.MTART``),
  * the configuration table the data dictionary names for the rule's field (sap/data_dictionary.py config_table),
  * the rule's field itself (``AREA.FIELD``), or
  * the area named as a word in the rule's rule context.

The objects those rules run on are the alert's objects. Their data owners (and stewards) get an in-app notification
of type ``config_drift`` naming the areas, the rule count and the system (no config or SAP values), the latest run of
the system is queued for a re-score of just those objects (the analysis task with analysis_options.modules), a
``config.drift`` webhook event is queued, and one config_drift_alerts row records it all. Turned off per tenant with
the automation setting ``drift_alerts.enabled``. Deterministic; no LLM.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid

from sqlalchemy import text

from api.services import app_links

logger = logging.getLogger("meridian.drift_alerts")

MAX_RULES = 500


def areas_of(rows: list[tuple[str, str, int]]) -> list[dict]:
    """[{area, added, removed, changed}] from (element_type, change_type, count) rows."""
    out: dict[str, dict] = {}
    for area, change, n in rows:
        a = out.setdefault(area, {"area": area, "added": 0, "removed": 0, "changed": 0})
        if change in a:
            a[change] += int(n)
    return [out[k] for k in sorted(out)]


def depends(area: str, finding: dict, shipped: dict | None) -> bool:
    """Whether one finding's rule depends on config area ``area`` (a table or object name)."""
    from sap.data_dictionary import get_config_table

    area = area.upper()
    details = finding.get("details") or {}
    ref = str(details.get("reference_table") or "")
    if ref and ref.split(".", 1)[0].upper() == area:
        return True
    rule = shipped or {}
    if str(rule.get("reference_table") or "").upper() == area:
        return True
    field = str(details.get("field_checked") or rule.get("field") or "")
    if "." in field:
        table, name = field.split(".", 1)
        if table.upper() == area or (get_config_table(table, name) or "").upper() == area:
            return True
    ctx = finding.get("rule_context")
    pattern = rf"(?<![A-Z0-9_]){re.escape(area)}(?![A-Z0-9_])"
    return bool(ctx) and re.search(pattern, json.dumps(ctx, default=str)) is not None


def _owners(session, tenant_id: str, modules: list[str]) -> list[str]:
    rows = session.execute(text(
        "SELECT DISTINCT u FROM (SELECT owner_user_id AS u FROM data_owners WHERE tenant_id = :t AND kind = 'object' "
        "AND ref = ANY(:m) UNION SELECT steward_user_id FROM data_owners WHERE tenant_id = :t AND kind = 'object' "
        "AND ref = ANY(:m)) x WHERE u IS NOT NULL"), {"t": tenant_id, "m": modules}).fetchall()
    return sorted(str(r[0]) for r in rows)


def queue_rescore(session, tenant_id: str, version_id: str, modules: list[str]) -> bool:
    """Re-run the analysis of ``version_id`` limited to ``modules`` (as POST /versions/{id}/analyse with a modules
    body does). False when the run has no stored dataset or an analysis of it is already running."""
    from api.services import jobs

    row = session.execute(text(
        "SELECT status, COALESCE(metadata->>'dataset_path', metadata->>'parquet_path'), metadata->>'system_id', label "
        "FROM analysis_versions WHERE id = CAST(:v AS uuid) AND tenant_id = :t"), {"v": version_id, "t": tenant_id}).fetchone()
    if row is None or not row[1] or row[0] in ("pending", "running"):
        return False
    session.execute(text(
        "UPDATE analysis_versions SET status = 'pending', metadata = COALESCE(metadata, '{}'::jsonb) "
        "|| jsonb_build_object('analysis_options', CAST(:o AS jsonb)) WHERE id = CAST(:v AS uuid) AND tenant_id = :t"),
        {"v": version_id, "t": tenant_id, "o": json.dumps({"modules": modules, "reason": "config_drift"})})
    session.commit()
    from workers.tasks.run_checks import run_checks

    jobs.start_job(tenant_id, version_id, "analysis", f"Re-score after a config change{f' | {row[3]}' if row[3] else ''}",
                   status="queued", progress_key=version_id, version_id=version_id, system_id=row[2])
    job = run_checks.delay(version_id, tenant_id, row[1], reanalyse=True)
    jobs.set_task_ids(tenant_id, version_id, [job.id])
    return True


def process(session, tenant_id: str, system_id: str, run_id: str, source: str) -> dict | None:
    """Alert on the drift of one config load or sync. Returns the alert, or None when the tenant turned alerts off,
    nothing changed, or this run was already processed. Commits."""
    from api.services import automation_settings, webhooks
    from api.services.notifications import create_notification_sync
    from api.services.run_context import latest_run_sync
    from checks.lifecycle import shipped_rules

    if not automation_settings.load_sync(session, tenant_id)["drift_alerts"]["enabled"]:
        return None
    if session.execute(text("SELECT 1 FROM config_drift_alerts WHERE tenant_id = :t AND run_id = CAST(:r AS uuid)"),
                       {"t": tenant_id, "r": run_id}).fetchone():
        return None
    areas = areas_of([(r[0], r[1], r[2]) for r in session.execute(text(
        "SELECT element_type, change_type, count(*) FROM config_drift_log WHERE tenant_id = :t "
        "AND run_id = CAST(:r AS uuid) GROUP BY 1, 2"), {"t": tenant_id, "r": run_id}).fetchall()])
    if not areas:
        return None
    vid = latest_run_sync(session, tenant_id, system_id=system_id)
    findings = [dict(r) for r in session.execute(text(
        "SELECT check_id, module, details, rule_context FROM findings WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) "
        "AND finding_type = 'rule'"), {"t": tenant_id, "v": vid}).mappings().all()] if vid else []
    shipped = shipped_rules()
    hit = [f for f in findings if any(depends(a["area"], f, (shipped.get(f["check_id"]) or ({},))[0]) for a in areas)]
    rules = sorted({f["check_id"] for f in hit})[:MAX_RULES]
    objects = sorted({f["module"] for f in hit})
    system = session.execute(text("SELECT name FROM sap_systems WHERE id = CAST(:s AS uuid) AND tenant_id = :t"),
                             {"s": system_id, "t": tenant_id}).scalar() or "the system"
    notified = 0
    if objects:
        names = ", ".join(a["area"] for a in areas[:5]) + (f" and {len(areas) - 5} more" if len(areas) > 5 else "")
        changes = sum(a["added"] + a["removed"] + a["changed"] for a in areas)
        for uid in _owners(session, tenant_id, objects):
            create_notification_sync(
                tenant_id=tenant_id, user_id=uid, type="config_drift",
                title=f"Configuration changed on {system}",
                body=(f"{changes} change(s) in {names}. {len(rules)} rule(s) on {', '.join(objects)} depend on it; "
                      "the objects are being re-scored."),
                link=app_links.system(str(system_id), "changes") if system_id else app_links.LANDSCAPE, session=session)
            notified += 1
    alert_id = str(uuid.uuid4())
    session.execute(text("""
        INSERT INTO config_drift_alerts (id, tenant_id, system_id, source, run_id, areas, rules, objects, version_id, notified)
        VALUES (CAST(:id AS uuid), :t, CAST(:s AS uuid), :src, CAST(:r AS uuid), CAST(:a AS jsonb), :rules, :objs,
                CAST(:v AS uuid), :n) ON CONFLICT (tenant_id, run_id) DO NOTHING"""),
        {"id": alert_id, "t": tenant_id, "s": system_id, "src": source, "r": run_id, "a": json.dumps(areas),
         "rules": rules, "objs": objects, "v": vid if objects else None, "n": notified})
    webhooks.emit_safe(session, tenant_id, "config.drift", {
        "alert_id": alert_id, "system_id": system_id, "system_name": system, "source": source,
        "areas": areas[:50], "rules": rules[:100], "objects": objects})
    session.commit()
    queued = False
    if objects and vid:
        try:
            queued = queue_rescore(session, tenant_id, vid, objects)
        except Exception as e:  # noqa: BLE001 - the alert stands even when the queue is down
            session.rollback()
            logger.warning(f"re-score after config drift not queued for {vid}: {type(e).__name__}")
        if queued:
            session.execute(text("UPDATE config_drift_alerts SET rescore_queued = true WHERE id = CAST(:id AS uuid)"),
                            {"id": alert_id})
            session.commit()
    return {"id": alert_id, "areas": areas, "rules": rules, "objects": objects, "version_id": vid if objects else None,
            "notified": notified, "rescore_queued": queued}


def process_safe(session, tenant_id: str, system_id: str, run_id: str, source: str) -> dict | None:
    """``process``; any failure is logged and costs the config load or sync nothing."""
    try:
        return process(session, tenant_id, system_id, run_id, source)
    except Exception as e:  # noqa: BLE001
        session.rollback()
        logger.warning(f"config drift alert for {run_id} failed: {type(e).__name__}: {e}")
        return None


# ── config sync: diff the stored snapshot before it is replaced ──────────────


def _row_key(row: dict) -> str:
    return hashlib.md5(json.dumps(row, sort_keys=True, default=str).encode()).hexdigest()


def snapshot_drift(previous: list[dict], current: list[dict]) -> list[tuple[str, str, str | None, str | None]]:
    """(change, row hash, previous row JSON, current row JSON) between two snapshots of one config table. Rows carry
    no declared key, so a changed row reads as one removed and one added."""
    old = {_row_key(r): r for r in previous if isinstance(r, dict)}
    new = {_row_key(r): r for r in current if isinstance(r, dict)}
    out = [("removed", k, json.dumps(old[k], default=str), None) for k in sorted(old.keys() - new.keys())]
    out += [("added", k, None, json.dumps(new[k], default=str)) for k in sorted(new.keys() - old.keys())]
    return out


def log_snapshot_drift(session, tenant_id: str, run_id: str, module: str, table: str,
                       previous: list[dict], current: list[dict]) -> int:
    rows = snapshot_drift(previous, current)
    for change, key, before, after in rows:
        session.execute(text(
            "INSERT INTO config_drift_log (id, tenant_id, run_id, module, element_type, element_value, change_type, "
            "previous_value, current_value) VALUES (gen_random_uuid(), :t, CAST(:r AS uuid), :m, :et, :ev, :c, :p, :n)"),
            {"t": tenant_id, "r": run_id, "m": module[:20], "et": table[:80], "ev": key, "c": change, "p": before,
             "n": after})
    return len(rows)


def list_alerts(session, tenant_id: str, limit: int = 50) -> list[dict]:
    rows = session.execute(text("""
        SELECT a.id::text, a.system_id::text, s.name AS system_name, a.source, a.run_id::text, a.areas, a.rules, a.objects,
               a.version_id::text, a.notified, a.rescore_queued, a.created_at
          FROM config_drift_alerts a LEFT JOIN sap_systems s ON s.id = a.system_id AND s.tenant_id = a.tenant_id
         WHERE a.tenant_id = :t ORDER BY a.created_at DESC LIMIT :n"""), {"t": tenant_id, "n": limit}).mappings().all()
    return [{**dict(r), "rules": list(r["rules"] or []), "objects": list(r["objects"] or [])} for r in rows]
