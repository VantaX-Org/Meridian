"""Config Intelligence persistence layer.

Saves and loads analysis results to/from PostgreSQL using async SQLAlchemy
sessions with the standard Meridian RLS pattern.
"""

from __future__ import annotations

import json
import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.config_intelligence import (
    AlignmentCategory,
    AlignmentFinding,
    ConfigElement,
    ConfigHealthScore,
    ConfigStatus,
    ProcessHealth,
    ProcessStatus,
    ProcessStep,
    Severity,
)
from api.services.config_intelligence.drift_detector import DriftEntry


class ConfigIntelligencePersistence:
    """Save and load Config Intelligence analysis results."""

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    async def save_run(
        self,
        db: AsyncSession,
        tenant_id: str,
        run_id: str,
        result,  # ConfigIntelligenceResult
    ) -> None:
        """Persist a full analysis run to the database."""
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))

        # 1. Config inventory
        for e in result.config_inventory:
            await db.execute(
                text(
                    "INSERT INTO config_inventory "
                    "(id, tenant_id, run_id, module, element_type, element_value, "
                    "transaction_count, first_seen, last_seen, status, sap_reference_table) "
                    "VALUES (:id, :tid, :rid, :module, :etype, :evalue, "
                    ":txn_count, :first_seen, :last_seen, :status, :ref_table)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tid": tenant_id,
                    "rid": run_id,
                    "module": e.module,
                    "etype": e.element_type,
                    "evalue": e.element_value,
                    "txn_count": e.transaction_count,
                    "first_seen": e.first_seen,
                    "last_seen": e.last_seen,
                    "status": e.status.value,
                    "ref_table": e.sap_reference_table,
                },
            )

        # 2. Processes + steps
        for p in result.processes:
            proc_uuid = str(uuid.uuid4())
            await db.execute(
                text(
                    "INSERT INTO config_processes "
                    "(id, tenant_id, run_id, process_id, process_name, status, "
                    "completeness_score, exception_rate, bottleneck_step, "
                    "total_volume, avg_cycle_days) "
                    "VALUES (:id, :tid, :rid, :pid, :pname, :status, "
                    ":comp, :exc, :bottle, :vol, :cycle)"
                ),
                {
                    "id": proc_uuid,
                    "tid": tenant_id,
                    "rid": run_id,
                    "pid": p.process_id,
                    "pname": p.process_name,
                    "status": p.status.value,
                    "comp": p.completeness_score,
                    "exc": p.exception_rate,
                    "bottle": p.bottleneck_step,
                    "vol": p.total_volume,
                    "cycle": p.avg_cycle_days,
                },
            )
            for s in p.steps:
                await db.execute(
                    text(
                        "INSERT INTO config_process_steps "
                        "(id, process_id, step_number, step_name, sap_table, "
                        "detected, volume, exception_count, avg_days_to_next_step) "
                        "VALUES (:id, :proc_id, :snum, :sname, :tbl, "
                        ":det, :vol, :exc, :avg)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "proc_id": proc_uuid,
                        "snum": s.step_number,
                        "sname": s.step_name,
                        "tbl": s.sap_table,
                        "det": s.detected,
                        "vol": s.volume,
                        "exc": s.exception_count,
                        "avg": s.avg_days_to_next_step,
                    },
                )

        # 3. Alignment findings
        for f in result.alignment_findings:
            await db.execute(
                text(
                    "INSERT INTO config_alignment_findings "
                    "(id, tenant_id, run_id, check_id, module, category, severity, "
                    "title, description, affected_elements, remediation, estimated_impact_zar) "
                    "VALUES (:id, :tid, :rid, :cid, :module, :cat, :sev, "
                    ":title, :desc, :elems, :rem, :impact)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tid": tenant_id,
                    "rid": run_id,
                    "cid": f.check_id,
                    "module": f.module,
                    "cat": f.category.value,
                    "sev": f.severity.value,
                    "title": f.title,
                    "desc": f.description,
                    "elems": json.dumps(f.affected_elements),
                    "rem": f.remediation,
                    "impact": f.estimated_impact_zar,
                },
            )

        # 4. Health scores
        for h in result.health_scores:
            await db.execute(
                text(
                    "INSERT INTO config_health_scores "
                    "(id, tenant_id, run_id, module, chs_score, "
                    "critical_count, high_count, medium_count, low_count) "
                    "VALUES (:id, :tid, :rid, :module, :chs, "
                    ":crit, :high, :med, :low)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tid": tenant_id,
                    "rid": run_id,
                    "module": h.module,
                    "chs": h.chs,
                    "crit": h.critical_count,
                    "high": h.high_count,
                    "med": h.medium_count,
                    "low": h.low_count,
                },
            )

        await db.commit()

    async def save_drift(
        self,
        db: AsyncSession,
        tenant_id: str,
        run_id: str,
        drift_entries: list[DriftEntry],
    ) -> None:
        """Save drift detection results to config_drift_log."""
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
        for d in drift_entries:
            await db.execute(
                text(
                    "INSERT INTO config_drift_log "
                    "(id, tenant_id, run_id, module, element_type, element_value, "
                    "change_type, previous_value, current_value) "
                    "VALUES (:id, :tid, :rid, :module, :etype, :evalue, "
                    ":ctype, :prev, :curr)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tid": tenant_id,
                    "rid": run_id,
                    "module": d.module,
                    "etype": d.element_type,
                    "evalue": d.element_value,
                    "ctype": d.change_type,
                    "prev": d.previous_value,
                    "curr": d.current_value,
                },
            )
        await db.commit()

    # ------------------------------------------------------------------
    # Read helpers
    # ------------------------------------------------------------------

    async def get_latest_run_id(
        self, db: AsyncSession, tenant_id: str
    ) -> Optional[str]:
        """Get the most recent run_id for a tenant."""
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
        row = (
            await db.execute(
                text(
                    "SELECT run_id FROM config_health_scores "
                    "WHERE tenant_id = :tid ORDER BY recorded_at DESC LIMIT 1"
                ),
                {"tid": tenant_id},
            )
        ).first()
        return str(row[0]) if row else None

    async def get_previous_run_id(
        self, db: AsyncSession, tenant_id: str, current_run_id: str
    ) -> Optional[str]:
        """Get the run_id before the current one."""
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
        # SELECT DISTINCT + ORDER BY on a non-projected column is a Postgres
        # error. GROUP BY + MAX() is the idiomatic fix: pick the run_id with
        # the newest recorded_at, excluding the current one.
        row = (
            await db.execute(
                text(
                    "SELECT run_id FROM config_health_scores "
                    "WHERE tenant_id = :tid AND run_id != :rid "
                    "GROUP BY run_id "
                    "ORDER BY MAX(recorded_at) DESC LIMIT 1"
                ),
                {"tid": tenant_id, "rid": current_run_id},
            )
        ).first()
        return str(row[0]) if row else None

    async def load_inventory(
        self,
        db: AsyncSession,
        tenant_id: str,
        run_id: str,
        module: Optional[str] = None,
    ) -> list[ConfigElement]:
        """Load config inventory for a run, optionally filtered by module."""
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
        q = (
            "SELECT module, element_type, element_value, transaction_count, "
            "first_seen, last_seen, status, sap_reference_table "
            "FROM config_inventory WHERE tenant_id = :tid AND run_id = :rid"
        )
        params: dict = {"tid": tenant_id, "rid": run_id}
        if module:
            q += " AND module = :module"
            params["module"] = module
        rows = (await db.execute(text(q), params)).fetchall()
        return [
            ConfigElement(
                module=r[0],
                element_type=r[1],
                element_value=r[2],
                transaction_count=r[3],
                first_seen=str(r[4]) if r[4] else None,
                last_seen=str(r[5]) if r[5] else None,
                status=ConfigStatus(r[6]),
                sap_reference_table=r[7] or "",
            )
            for r in rows
        ]

    async def load_processes(
        self, db: AsyncSession, tenant_id: str, run_id: str
    ) -> list[ProcessHealth]:
        """Load processes with their steps for a run."""
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
        proc_rows = (
            await db.execute(
                text(
                    "SELECT id, process_id, process_name, status, completeness_score, "
                    "exception_rate, bottleneck_step, total_volume, avg_cycle_days "
                    "FROM config_processes WHERE tenant_id = :tid AND run_id = :rid"
                ),
                {"tid": tenant_id, "rid": run_id},
            )
        ).fetchall()

        results: list[ProcessHealth] = []
        for r in proc_rows:
            step_rows = (
                await db.execute(
                    text(
                        "SELECT step_number, step_name, sap_table, detected, volume, "
                        "exception_count, avg_days_to_next_step "
                        "FROM config_process_steps WHERE process_id = :pid "
                        "ORDER BY step_number"
                    ),
                    {"pid": str(r[0])},
                )
            ).fetchall()
            steps = [
                ProcessStep(
                    step_number=s[0],
                    step_name=s[1],
                    sap_table=s[2] or "",
                    detected=s[3],
                    volume=s[4],
                    exception_count=s[5],
                    avg_days_to_next_step=s[6],
                )
                for s in step_rows
            ]
            results.append(
                ProcessHealth(
                    process_id=r[1],
                    process_name=r[2],
                    status=ProcessStatus(r[3]),
                    completeness_score=r[4],
                    steps=steps,
                    exception_rate=r[5],
                    bottleneck_step=r[6],
                    total_volume=r[7],
                    avg_cycle_days=r[8],
                )
            )
        return results

    async def load_process_detail(
        self, db: AsyncSession, tenant_id: str, run_id: str, process_id: str
    ) -> Optional[ProcessHealth]:
        """Load a single process with steps."""
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
        r = (
            await db.execute(
                text(
                    "SELECT id, process_id, process_name, status, completeness_score, "
                    "exception_rate, bottleneck_step, total_volume, avg_cycle_days "
                    "FROM config_processes "
                    "WHERE tenant_id = :tid AND run_id = :rid AND process_id = :pid"
                ),
                {"tid": tenant_id, "rid": run_id, "pid": process_id},
            )
        ).first()
        if not r:
            return None

        step_rows = (
            await db.execute(
                text(
                    "SELECT step_number, step_name, sap_table, detected, volume, "
                    "exception_count, avg_days_to_next_step "
                    "FROM config_process_steps WHERE process_id = :pid "
                    "ORDER BY step_number"
                ),
                {"pid": str(r[0])},
            )
        ).fetchall()
        steps = [
            ProcessStep(
                step_number=s[0],
                step_name=s[1],
                sap_table=s[2] or "",
                detected=s[3],
                volume=s[4],
                exception_count=s[5],
                avg_days_to_next_step=s[6],
            )
            for s in step_rows
        ]
        return ProcessHealth(
            process_id=r[1],
            process_name=r[2],
            status=ProcessStatus(r[3]),
            completeness_score=r[4],
            steps=steps,
            exception_rate=r[5],
            bottleneck_step=r[6],
            total_volume=r[7],
            avg_cycle_days=r[8],
        )

    async def load_findings(
        self,
        db: AsyncSession,
        tenant_id: str,
        run_id: str,
        module: Optional[str] = None,
        severity: Optional[str] = None,
        category: Optional[str] = None,
    ) -> list[AlignmentFinding]:
        """Load alignment findings with optional filters."""
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
        q = (
            "SELECT check_id, module, category, severity, title, description, "
            "affected_elements, remediation, estimated_impact_zar "
            "FROM config_alignment_findings "
            "WHERE tenant_id = :tid AND run_id = :rid"
        )
        params: dict = {"tid": tenant_id, "rid": run_id}
        if module:
            q += " AND module = :module"
            params["module"] = module
        if severity:
            q += " AND severity = :severity"
            params["severity"] = severity
        if category:
            q += " AND category = :category"
            params["category"] = category
        rows = (await db.execute(text(q), params)).fetchall()
        return [
            AlignmentFinding(
                check_id=r[0],
                module=r[1],
                category=AlignmentCategory(r[2]),
                severity=Severity(r[3]),
                title=r[4],
                description=r[5] or "",
                affected_elements=json.loads(r[6]) if r[6] else [],
                remediation=r[7] or "",
                estimated_impact_zar=r[8] or 0.0,
            )
            for r in rows
        ]

    async def load_findings_by_category(
        self, db: AsyncSession, tenant_id: str, run_id: str, category: str
    ) -> list[AlignmentFinding]:
        """Load findings filtered by category."""
        return await self.load_findings(db, tenant_id, run_id, category=category)

    async def load_health_scores(
        self, db: AsyncSession, tenant_id: str, run_id: str
    ) -> list[ConfigHealthScore]:
        """Load CHS scores for a run."""
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
        rows = (
            await db.execute(
                text(
                    "SELECT module, chs_score, critical_count, high_count, "
                    "medium_count, low_count "
                    "FROM config_health_scores "
                    "WHERE tenant_id = :tid AND run_id = :rid"
                ),
                {"tid": tenant_id, "rid": run_id},
            )
        ).fetchall()
        return [
            ConfigHealthScore(
                module=r[0],
                chs=r[1],
                critical_count=r[2],
                high_count=r[3],
                medium_count=r[4],
                low_count=r[5],
            )
            for r in rows
        ]

    async def load_drift(
        self, db: AsyncSession, tenant_id: str, run_id: str
    ) -> list[DriftEntry]:
        """Load drift entries for a run."""
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
        rows = (
            await db.execute(
                text(
                    "SELECT module, element_type, element_value, change_type, "
                    "previous_value, current_value "
                    "FROM config_drift_log "
                    "WHERE tenant_id = :tid AND run_id = :rid"
                ),
                {"tid": tenant_id, "rid": run_id},
            )
        ).fetchall()
        return [
            DriftEntry(
                module=r[0],
                element_type=r[1],
                element_value=r[2],
                change_type=r[3],
                previous_value=r[4],
                current_value=r[5],
            )
            for r in rows
        ]

    async def load_finding_by_check_id(
        self, db: AsyncSession, tenant_id: str, run_id: str, check_id: str
    ) -> Optional[AlignmentFinding]:
        """Load a single alignment finding by check_id."""
        await db.execute(text(f"SET app.tenant_id = \'{str(tenant_id)}\'"))
        r = (
            await db.execute(
                text(
                    "SELECT check_id, module, category, severity, title, description, "
                    "affected_elements, remediation, estimated_impact_zar "
                    "FROM config_alignment_findings "
                    "WHERE tenant_id = :tid AND run_id = :rid AND check_id = :cid"
                ),
                {"tid": tenant_id, "rid": run_id, "cid": check_id},
            )
        ).first()
        if not r:
            return None
        return AlignmentFinding(
            check_id=r[0],
            module=r[1],
            category=AlignmentCategory(r[2]),
            severity=Severity(r[3]),
            title=r[4],
            description=r[5] or "",
            affected_elements=json.loads(r[6]) if r[6] else [],
            remediation=r[7] or "",
            estimated_impact_zar=r[8] or 0.0,
        )
