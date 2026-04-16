"""Post-analysis exception scan — detect SAP transaction exceptions from findings."""

import json
import logging
import traceback

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker")


@celery_app.task(bind=True, name="workers.tasks.run_exception_scan.run_exception_scan",
                 soft_time_limit=120, time_limit=180)
def run_exception_scan(self, version_id: str, tenant_id: str):
    """Scan findings for a completed version and create SAP transaction exceptions."""
    logger.info(f"run_exception_scan started: version_id={version_id}, tenant_id={tenant_id}")

    try:
        engine = get_sync_engine()

        # Load findings for this version
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

            result = session.execute(
                text("""
                    SELECT id, module, check_id, severity, dimension,
                           affected_count, total_count, pass_rate, details,
                           remediation_text
                    FROM findings
                    WHERE version_id = :vid AND tenant_id = :tid
                """),
                {"vid": version_id, "tid": tenant_id},
            )
            rows = result.fetchall()

        findings = []
        for row in rows:
            details = row[8] if row[8] else {}
            if isinstance(details, str):
                details = json.loads(details)
            findings.append({
                "id": str(row[0]),
                "module": row[1],
                "check_id": row[2],
                "severity": row[3],
                "dimension": row[4],
                "affected_count": row[5],
                "total_count": row[6],
                "pass_rate": float(row[7]) if row[7] is not None else None,
                "details": details,
                "remediation_text": row[9],
            })

        if not findings:
            logger.info(f"run_exception_scan: no findings for version_id={version_id}")
            return {"version_id": version_id, "exceptions": 0}

        # Evaluate SAP monitors
        from api.services.exception_engine import SAPTransactionMonitor

        monitor = SAPTransactionMonitor()
        exceptions = monitor.evaluate_monitors(findings, tenant_id)

        if not exceptions:
            logger.info(f"run_exception_scan: no exceptions detected for version_id={version_id}")
            return {"version_id": version_id, "exceptions": 0}

        # Insert exceptions into database
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

            for exc in exceptions:
                session.execute(
                    text("""
                        INSERT INTO exceptions (
                            id, tenant_id, type, category, severity, status,
                            title, description, source_system, source_reference,
                            affected_records, escalation_tier, sla_deadline, created_at
                        ) VALUES (
                            :id, :tid, :type, :category, :severity, :status,
                            :title, :description, :source_system, :source_reference,
                            CAST(:affected_records AS jsonb), :escalation_tier,
                            :sla_deadline::timestamptz, now()
                        )
                        ON CONFLICT (id) DO NOTHING
                    """),
                    {
                        "id": exc["id"],
                        "tid": tenant_id,
                        "type": exc["type"],
                        "category": exc["category"],
                        "severity": exc["severity"],
                        "status": exc["status"],
                        "title": exc["title"],
                        "description": exc["description"],
                        "source_system": exc.get("source_system"),
                        "source_reference": exc.get("source_reference"),
                        "affected_records": json.dumps(exc.get("affected_records", {})),
                        "escalation_tier": exc["escalation_tier"],
                        "sla_deadline": exc["sla_deadline"],
                    },
                )

                # Upsert stewardship_queue row for this exception
                try:
                    priority_map = {'critical': 1, 'high': 2, 'medium': 3, 'low': 4}
                    sla_hours = 24 if exc['severity'] == 'critical' else 72
                    session.execute(
                        text("""
                            INSERT INTO stewardship_queue
                              (id, tenant_id, item_type, source_id, domain,
                               priority, due_at, status, sla_hours, created_at, updated_at)
                            VALUES
                              (gen_random_uuid(), :tid, 'exception', :source_id, :domain,
                               :priority,
                               now() + (:sla_hours || ' hours')::interval,
                               'open', :sla_hours, now(), now())
                            ON CONFLICT (source_id, item_type)
                            WHERE status != 'resolved'
                            DO UPDATE SET
                              priority   = EXCLUDED.priority,
                              due_at     = EXCLUDED.due_at,
                              updated_at = now()
                        """),
                        {
                            'tid':       tenant_id,
                            'source_id': exc['id'],
                            'domain':    exc.get('category', 'general'),
                            'priority':  priority_map.get(exc['severity'], 3),
                            'sla_hours': sla_hours,
                        },
                    )
                except Exception as sq_err:
                    logger.warning(f'stewardship_queue insert failed for exception {exc["id"]}: {sq_err}')
                    # Do NOT re-raise — exception was created successfully

            session.commit()

        # Create notifications for critical exceptions
        try:
            from api.services.notifications import create_notification_sync

            critical_exceptions = [e for e in exceptions if e["severity"] == "critical"]
            with Session(engine) as notif_session:
                notif_session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                for exc in critical_exceptions:
                    create_notification_sync(
                        tenant_id=tenant_id,
                        user_id=None,
                        type="exception",
                        title=f"Critical exception detected: {exc['title']}",
                        body=exc["description"],
                        link=f"/exceptions/{exc['id']}",
                        session=notif_session,
                    )
                notif_session.commit()
        except Exception as e:
            logger.warning(f"Failed to create exception notifications (non-fatal): {e}")

        logger.info(
            "run_exception_scan complete: version_id={}, exceptions={}".format(
                version_id, len(exceptions)
            )
        )
        return {"version_id": version_id, "exceptions": len(exceptions)}

    except Exception as e:
        logger.warning(f"run_exception_scan failed (non-fatal): {traceback.format_exc()}")
        return {"version_id": version_id, "exceptions": 0, "error": str(e)}
