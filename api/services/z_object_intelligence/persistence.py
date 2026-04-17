"""Z-Object Intelligence persistence layer.

Saves and loads Z-Object Registry, profiles, baselines, anomalies, rules,
and findings to/from PostgreSQL using async SQLAlchemy sessions with the
standard Meridian RLS pattern.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.z_object_intelligence import (
    ZBaseline,
    ZObjectCategory,
    ZObjectStatus,
)


class ZObjectPersistence:
    """Save and load Z-Object Intelligence data."""

    # ------------------------------------------------------------------
    # Registry Operations
    # ------------------------------------------------------------------

    async def upsert_registry_entry(
        self,
        db: AsyncSession,
        tenant_id: str,
        detected_obj,
        profile=None,
    ) -> str:
        """Create or update a Z-Object Registry entry.

        If entry exists (match on tenant_id + module + category + object_name):
        update last_active_date, increment transaction_count_total, update
        profile_snapshot.  If new: INSERT with status='under_review'.
        Returns the registry entry ID.
        """
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))

        # Check for existing entry
        row = (
            await db.execute(
                text(
                    "SELECT id, transaction_count_total FROM z_object_registry "
                    "WHERE tenant_id = :tid AND module = :module "
                    "AND category = :cat AND object_name = :name"
                ),
                {
                    "tid": tenant_id,
                    "module": detected_obj.module,
                    "cat": detected_obj.category.value,
                    "name": detected_obj.object_name,
                },
            )
        ).first()

        profile_json = None
        if profile:
            profile_json = json.dumps({
                "data_type": profile.data_type.value,
                "cardinality": profile.cardinality,
                "null_rate": profile.null_rate,
                "value_distribution": profile.value_distribution,
                "length_stats": profile.length_stats,
                "format_pattern": profile.format_pattern,
                "relationship_score": profile.relationship_score,
                "related_standard_field": profile.related_standard_field,
                "standard_equivalent": profile.standard_equivalent,
                "transaction_count": profile.transaction_count,
                "user_count": profile.user_count,
                "first_seen": profile.first_seen,
                "last_seen": profile.last_seen,
                "trend_direction": profile.trend_direction.value if profile.trend_direction else None,
            })

        if row:
            # Update existing
            entry_id = str(row[0])
            new_total = (row[1] or 0) + detected_obj.transaction_count
            update_parts = [
                "last_active_date = now()",
                "transaction_count_total = :total",
            ]
            params: dict = {"id": entry_id, "total": new_total}
            if profile_json:
                update_parts.append("profile_snapshot = :profile")
                params["profile"] = profile_json
            if profile and profile.standard_equivalent:
                update_parts.append("standard_equivalent = :std_eq")
                params["std_eq"] = profile.standard_equivalent

            await db.execute(
                text(
                    f"UPDATE z_object_registry SET {', '.join(update_parts)} "
                    f"WHERE id = :id"
                ),
                params,
            )
        else:
            # Insert new
            entry_id = str(uuid.uuid4())
            std_eq = profile.standard_equivalent if profile else None
            await db.execute(
                text(
                    "INSERT INTO z_object_registry "
                    "(id, tenant_id, category, module, object_name, "
                    "standard_equivalent, status, transaction_count_total, "
                    "profile_snapshot, last_active_date) "
                    "VALUES (:id, :tid, :cat, :module, :name, "
                    ":std_eq, 'under_review', :txn, :profile, now())"
                ),
                {
                    "id": entry_id,
                    "tid": tenant_id,
                    "cat": detected_obj.category.value,
                    "module": detected_obj.module,
                    "name": detected_obj.object_name,
                    "std_eq": std_eq,
                    "txn": detected_obj.transaction_count,
                    "profile": profile_json,
                },
            )

        await db.commit()
        return entry_id

    async def get_registry(
        self,
        db: AsyncSession,
        tenant_id: str,
        module: Optional[str] = None,
        status: Optional[str] = None,
    ) -> list[dict]:
        """Get all registry entries, optionally filtered by module and/or status."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        q = (
            "SELECT id, category, module, object_name, standard_equivalent, "
            "description, owner, created_date, last_active_date, status, "
            "transaction_count_total, profile_snapshot, baseline_snapshot, "
            "rules_applied, notes "
            "FROM z_object_registry WHERE tenant_id = :tid"
        )
        params: dict = {"tid": tenant_id}
        if module:
            q += " AND module = :module"
            params["module"] = module
        if status:
            q += " AND status = :status"
            params["status"] = status
        q += " ORDER BY transaction_count_total DESC"

        rows = (await db.execute(text(q), params)).fetchall()
        return [
            {
                "id": str(r[0]),
                "category": r[1],
                "module": r[2],
                "object_name": r[3],
                "standard_equivalent": r[4],
                "description": r[5],
                "owner": r[6],
                "created_date": str(r[7]) if r[7] else None,
                "last_active_date": str(r[8]) if r[8] else None,
                "status": r[9] or "under_review",
                "transaction_count_total": r[10] or 0,
                "profile_snapshot": json.loads(r[11]) if r[11] else None,
                "baseline_snapshot": json.loads(r[12]) if r[12] else None,
                "rules_applied": json.loads(r[13]) if r[13] else [],
                "notes": r[14],
            }
            for r in rows
        ]

    async def get_registry_entry(
        self, db: AsyncSession, tenant_id: str, z_id: str
    ) -> dict | None:
        """Get a single registry entry by ID."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        r = (
            await db.execute(
                text(
                    "SELECT id, category, module, object_name, standard_equivalent, "
                    "description, owner, created_date, last_active_date, status, "
                    "transaction_count_total, profile_snapshot, baseline_snapshot, "
                    "rules_applied, notes "
                    "FROM z_object_registry WHERE tenant_id = :tid AND id = :zid"
                ),
                {"tid": tenant_id, "zid": z_id},
            )
        ).first()
        if not r:
            return None
        return {
            "id": str(r[0]),
            "category": r[1],
            "module": r[2],
            "object_name": r[3],
            "standard_equivalent": r[4],
            "description": r[5],
            "owner": r[6],
            "created_date": str(r[7]) if r[7] else None,
            "last_active_date": str(r[8]) if r[8] else None,
            "status": r[9] or "under_review",
            "transaction_count_total": r[10] or 0,
            "profile_snapshot": json.loads(r[11]) if r[11] else None,
            "baseline_snapshot": json.loads(r[12]) if r[12] else None,
            "rules_applied": json.loads(r[13]) if r[13] else [],
            "notes": r[14],
        }

    async def update_registry_entry(
        self, db: AsyncSession, tenant_id: str, z_id: str, updates: dict
    ) -> bool:
        """Update registry fields: description, owner, standard_equivalent, status, notes."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))

        allowed = {"description", "owner", "standard_equivalent", "status", "notes"}
        filtered = {k: v for k, v in updates.items() if k in allowed and v is not None}
        if not filtered:
            return False

        set_clauses = [f"{k} = :{k}" for k in filtered]
        params = {**filtered, "tid": tenant_id, "zid": z_id}
        result = await db.execute(
            text(
                f"UPDATE z_object_registry SET {', '.join(set_clauses)} "
                f"WHERE tenant_id = :tid AND id = :zid"
            ),
            params,
        )
        await db.commit()
        return result.rowcount > 0

    async def get_registry_status_map(
        self, db: AsyncSession, tenant_id: str
    ) -> dict[str, dict]:
        """Get a dict of object_name -> {description, owner, status} for rule evaluation."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        rows = (
            await db.execute(
                text(
                    "SELECT object_name, description, owner, status "
                    "FROM z_object_registry WHERE tenant_id = :tid"
                ),
                {"tid": tenant_id},
            )
        ).fetchall()
        return {
            r[0]: {"description": r[1], "owner": r[2], "status": r[3]}
            for r in rows
        }

    # ------------------------------------------------------------------
    # Profile Operations
    # ------------------------------------------------------------------

    async def save_profiles(
        self,
        db: AsyncSession,
        tenant_id: str,
        run_id: str,
        profiles: list,
        z_object_ids: dict[str, str],
    ) -> None:
        """Save per-run profile snapshots to z_object_profiles."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        for p in profiles:
            z_oid = z_object_ids.get(p.object_name)
            if not z_oid:
                continue
            await db.execute(
                text(
                    "INSERT INTO z_object_profiles "
                    "(id, z_object_id, tenant_id, run_id, data_type, cardinality, "
                    "null_rate, value_distribution, length_stats, format_pattern, "
                    "relationship_score, related_standard_field, transaction_count, "
                    "user_count, first_seen, last_seen, trend_direction) "
                    "VALUES (:id, :zoid, :tid, :rid, :dtype, :card, "
                    ":null_rate, :vdist, :lstats, :fpattern, "
                    ":rscore, :rsfield, :txn, :ucnt, :fseen, :lseen, :trend)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "zoid": z_oid,
                    "tid": tenant_id,
                    "rid": run_id,
                    "dtype": p.data_type.value,
                    "card": p.cardinality,
                    "null_rate": p.null_rate,
                    "vdist": json.dumps(p.value_distribution),
                    "lstats": json.dumps(p.length_stats),
                    "fpattern": p.format_pattern,
                    "rscore": p.relationship_score,
                    "rsfield": p.related_standard_field,
                    "txn": p.transaction_count,
                    "ucnt": p.user_count,
                    "fseen": p.first_seen,
                    "lseen": p.last_seen,
                    "trend": p.trend_direction.value if p.trend_direction else None,
                },
            )
        await db.commit()

    async def get_latest_profile(
        self, db: AsyncSession, tenant_id: str, z_object_id: str
    ) -> dict | None:
        """Get the most recent profile for a Z object."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        r = (
            await db.execute(
                text(
                    "SELECT data_type, cardinality, null_rate, value_distribution, "
                    "length_stats, format_pattern, relationship_score, "
                    "related_standard_field, transaction_count, user_count, "
                    "first_seen, last_seen, trend_direction "
                    "FROM z_object_profiles "
                    "WHERE tenant_id = :tid AND z_object_id = :zoid "
                    "ORDER BY created_at DESC LIMIT 1"
                ),
                {"tid": tenant_id, "zoid": z_object_id},
            )
        ).first()
        if not r:
            return None
        return {
            "data_type": r[0],
            "cardinality": r[1],
            "null_rate": r[2],
            "value_distribution": json.loads(r[3]) if r[3] else {},
            "length_stats": json.loads(r[4]) if r[4] else {},
            "format_pattern": r[5],
            "relationship_score": r[6] or 0.0,
            "related_standard_field": r[7],
            "transaction_count": r[8] or 0,
            "user_count": r[9] or 0,
            "first_seen": str(r[10]) if r[10] else None,
            "last_seen": str(r[11]) if r[11] else None,
            "trend_direction": r[12],
        }

    # ------------------------------------------------------------------
    # Baseline Operations
    # ------------------------------------------------------------------

    async def load_baselines(
        self, db: AsyncSession, tenant_id: str
    ) -> dict[str, ZBaseline]:
        """Load all baselines for a tenant, keyed by object_name."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        rows = (
            await db.execute(
                text(
                    "SELECT r.object_name, b.mean_volume, b.stddev_volume, "
                    "b.expected_null_rate, b.expected_cardinality, b.format_pattern, "
                    "b.distribution_hash, b.relationship_baseline, b.learning_count "
                    "FROM z_object_baselines b "
                    "JOIN z_object_registry r ON b.z_object_id = r.id "
                    "WHERE b.tenant_id = :tid"
                ),
                {"tid": tenant_id},
            )
        ).fetchall()
        baselines: dict[str, ZBaseline] = {}
        for r in rows:
            baselines[r[0]] = ZBaseline(
                object_name=r[0],
                mean_volume=r[1] or 0.0,
                stddev_volume=r[2] or 0.0,
                expected_null_rate=r[3] or 0.0,
                expected_cardinality=r[4] or 0,
                format_pattern=r[5],
                distribution_hash=r[6],
                relationship_baseline=json.loads(r[7]) if r[7] else {},
                learning_count=r[8] or 0,
            )
        return baselines

    async def save_baselines(
        self,
        db: AsyncSession,
        tenant_id: str,
        baselines: dict[str, ZBaseline],
        z_object_ids: dict[str, str],
    ) -> None:
        """Upsert baselines (one per z_object per tenant)."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        for name, bl in baselines.items():
            z_oid = z_object_ids.get(name)
            if not z_oid:
                continue
            rel_json = json.dumps(bl.relationship_baseline)

            # Upsert using ON CONFLICT
            await db.execute(
                text(
                    "INSERT INTO z_object_baselines "
                    "(id, z_object_id, tenant_id, mean_volume, stddev_volume, "
                    "expected_null_rate, expected_cardinality, format_pattern, "
                    "distribution_hash, relationship_baseline, learning_count, updated_at) "
                    "VALUES (:id, :zoid, :tid, :mean, :stddev, :null_rate, :card, "
                    ":fpattern, :dhash, :rel, :lcount, now()) "
                    "ON CONFLICT ON CONSTRAINT uq_z_baselines_object_tenant "
                    "DO UPDATE SET mean_volume = :mean, stddev_volume = :stddev, "
                    "expected_null_rate = :null_rate, expected_cardinality = :card, "
                    "format_pattern = :fpattern, distribution_hash = :dhash, "
                    "relationship_baseline = :rel, learning_count = :lcount, "
                    "updated_at = now()"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "zoid": z_oid,
                    "tid": tenant_id,
                    "mean": bl.mean_volume,
                    "stddev": bl.stddev_volume,
                    "null_rate": bl.expected_null_rate,
                    "card": bl.expected_cardinality,
                    "fpattern": bl.format_pattern,
                    "dhash": bl.distribution_hash,
                    "rel": rel_json,
                    "lcount": bl.learning_count,
                },
            )

            # Also update baseline_snapshot on the registry entry
            baseline_json = json.dumps({
                "mean_volume": bl.mean_volume,
                "stddev_volume": bl.stddev_volume,
                "expected_null_rate": bl.expected_null_rate,
                "expected_cardinality": bl.expected_cardinality,
                "format_pattern": bl.format_pattern,
                "learning_count": bl.learning_count,
            })
            await db.execute(
                text(
                    "UPDATE z_object_registry SET baseline_snapshot = :snap "
                    "WHERE id = :zoid"
                ),
                {"snap": baseline_json, "zoid": z_oid},
            )

        await db.commit()

    # ------------------------------------------------------------------
    # Anomaly Operations
    # ------------------------------------------------------------------

    async def save_anomalies(
        self,
        db: AsyncSession,
        tenant_id: str,
        run_id: str,
        anomalies: list,
        z_object_ids: dict[str, str],
    ) -> None:
        """Save detected anomalies to z_object_anomalies."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        for a in anomalies:
            z_oid = z_object_ids.get(a.object_name)
            if not z_oid:
                continue
            await db.execute(
                text(
                    "INSERT INTO z_object_anomalies "
                    "(id, z_object_id, tenant_id, run_id, anomaly_type, severity, "
                    "description, baseline_value, current_value, deviation_pct) "
                    "VALUES (:id, :zoid, :tid, :rid, :atype, :sev, :desc, "
                    ":bval, :cval, :dev)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "zoid": z_oid,
                    "tid": tenant_id,
                    "rid": run_id,
                    "atype": a.anomaly_type.value if hasattr(a.anomaly_type, "value") else a.anomaly_type,
                    "sev": a.severity,
                    "desc": a.description,
                    "bval": a.baseline_value,
                    "cval": a.current_value,
                    "dev": a.deviation_pct,
                },
            )
        await db.commit()

    async def get_anomalies(
        self,
        db: AsyncSession,
        tenant_id: str,
        run_id: str | None = None,
        status: str = "active",
    ) -> list[dict]:
        """Get anomalies, optionally filtered by run_id and status."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        q = (
            "SELECT a.id, r.object_name, a.anomaly_type, a.severity, "
            "a.description, a.baseline_value, a.current_value, "
            "a.deviation_pct, a.status, a.run_id "
            "FROM z_object_anomalies a "
            "JOIN z_object_registry r ON a.z_object_id = r.id "
            "WHERE a.tenant_id = :tid"
        )
        params: dict = {"tid": tenant_id}
        if run_id:
            q += " AND a.run_id = :rid"
            params["rid"] = run_id
        if status:
            q += " AND a.status = :status"
            params["status"] = status
        q += " ORDER BY a.created_at DESC"

        rows = (await db.execute(text(q), params)).fetchall()
        return [
            {
                "id": str(r[0]),
                "object_name": r[1],
                "anomaly_type": r[2],
                "severity": r[3],
                "description": r[4],
                "baseline_value": r[5],
                "current_value": r[6],
                "deviation_pct": r[7] or 0.0,
                "status": r[8] or "active",
                "run_id": str(r[9]),
            }
            for r in rows
        ]

    async def update_anomaly_feedback(
        self, db: AsyncSession, tenant_id: str, anomaly_id: str, status: str, user_id: str
    ) -> bool:
        """Update anomaly status to 'confirmed' or 'dismissed'."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        result = await db.execute(
            text(
                "UPDATE z_object_anomalies "
                "SET status = :status, feedback_by = :uid, feedback_at = now() "
                "WHERE id = :aid AND tenant_id = :tid"
            ),
            {"status": status, "uid": user_id, "aid": anomaly_id, "tid": tenant_id},
        )
        await db.commit()
        return result.rowcount > 0

    # ------------------------------------------------------------------
    # Rule Operations
    # ------------------------------------------------------------------

    async def save_rule_findings(
        self,
        db: AsyncSession,
        tenant_id: str,
        run_id: str,
        findings: list,
        z_object_ids: dict[str, str],
    ) -> None:
        """Save Z-rule findings to z_object_findings."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        for f in findings:
            z_oid = z_object_ids.get(f.z_object_name)
            if not z_oid:
                continue

            # Look up or create a rule_id reference
            rule_db_id = await self._resolve_rule_id(db, tenant_id, f.rule_id, f.rule_name)

            await db.execute(
                text(
                    "INSERT INTO z_object_findings "
                    "(id, tenant_id, z_object_id, rule_id, run_id, severity, "
                    "title, description, affected_records, remediation) "
                    "VALUES (:id, :tid, :zoid, :rid_rule, :rid, :sev, "
                    ":title, :desc, :records, :rem)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tid": tenant_id,
                    "zoid": z_oid,
                    "rid_rule": rule_db_id,
                    "rid": run_id,
                    "sev": f.severity,
                    "title": f.title,
                    "desc": f.description,
                    "records": json.dumps(f.affected_records),
                    "rem": f.remediation,
                },
            )

            # Update rules_applied on the registry entry
            await db.execute(
                text(
                    "UPDATE z_object_registry "
                    "SET rules_applied = rules_applied || :rule_id::jsonb "
                    "WHERE id = :zoid AND NOT (rules_applied @> :rule_id::jsonb)"
                ),
                {"rule_id": json.dumps([f.rule_id]), "zoid": z_oid},
            )

        await db.commit()

    async def _resolve_rule_id(
        self, db: AsyncSession, tenant_id: str, template_id: str, rule_name: str
    ) -> str:
        """Find or create a z_object_rules entry for a template rule."""
        row = (
            await db.execute(
                text(
                    "SELECT id FROM z_object_rules "
                    "WHERE tenant_id = :tid AND rule_template_id = :tmpl"
                ),
                {"tid": tenant_id, "tmpl": template_id},
            )
        ).first()
        if row:
            return str(row[0])

        rule_id = str(uuid.uuid4())
        await db.execute(
            text(
                "INSERT INTO z_object_rules "
                "(id, tenant_id, rule_template_id, rule_name, severity, is_active) "
                "VALUES (:id, :tid, :tmpl, :name, 'medium', true)"
            ),
            {"id": rule_id, "tid": tenant_id, "tmpl": template_id, "name": rule_name},
        )
        return rule_id

    async def get_custom_rules(self, db: AsyncSession, tenant_id: str) -> list[dict]:
        """Get all custom rules for a tenant."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        rows = (
            await db.execute(
                text(
                    "SELECT id, z_object_id, rule_template_id, rule_name, "
                    "custom_condition, severity, is_active, created_at "
                    "FROM z_object_rules WHERE tenant_id = :tid "
                    "ORDER BY created_at DESC"
                ),
                {"tid": tenant_id},
            )
        ).fetchall()
        return [
            {
                "id": str(r[0]),
                "z_object_id": str(r[1]) if r[1] else None,
                "rule_template_id": r[2],
                "rule_name": r[3],
                "custom_condition": r[4],
                "severity": r[5] or "medium",
                "is_active": r[6],
                "created_at": str(r[7]) if r[7] else None,
            }
            for r in rows
        ]

    async def create_custom_rule(
        self, db: AsyncSession, tenant_id: str, rule_data: dict, user_id: str
    ) -> str:
        """Create a new custom Z rule. Returns rule ID."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        rule_id = str(uuid.uuid4())
        await db.execute(
            text(
                "INSERT INTO z_object_rules "
                "(id, tenant_id, z_object_id, rule_name, custom_condition, "
                "severity, is_active, created_by) "
                "VALUES (:id, :tid, :zoid, :name, :cond, :sev, true, :uid)"
            ),
            {
                "id": rule_id,
                "tid": tenant_id,
                "zoid": rule_data.get("z_object_id"),
                "name": rule_data["rule_name"],
                "cond": rule_data["custom_condition"],
                "sev": rule_data.get("severity", "medium"),
                "uid": user_id,
            },
        )
        await db.commit()
        return rule_id

    # ------------------------------------------------------------------
    # Convenience Queries
    # ------------------------------------------------------------------

    async def get_ghost_z_objects(self, db: AsyncSession, tenant_id: str) -> list[dict]:
        """Z objects in registry with status='active' but very low transaction count."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        rows = (
            await db.execute(
                text(
                    "SELECT id, object_name, category, module, last_active_date, status "
                    "FROM z_object_registry "
                    "WHERE tenant_id = :tid AND status = 'active' "
                    "AND (transaction_count_total = 0 OR transaction_count_total IS NULL) "
                    "ORDER BY object_name"
                ),
                {"tid": tenant_id},
            )
        ).fetchall()
        return [
            {
                "id": str(r[0]),
                "object_name": r[1],
                "category": r[2],
                "module": r[3],
                "last_active_date": str(r[4]) if r[4] else None,
                "status": r[5],
            }
            for r in rows
        ]

    async def get_dormant_z_objects(
        self, db: AsyncSession, tenant_id: str, months: int = 6
    ) -> list[dict]:
        """Z objects where last_active_date is older than N months."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        rows = (
            await db.execute(
                text(
                    "SELECT id, object_name, category, module, last_active_date, "
                    "EXTRACT(MONTH FROM AGE(now(), last_active_date))::int as months_inactive "
                    "FROM z_object_registry "
                    "WHERE tenant_id = :tid AND last_active_date IS NOT NULL "
                    "AND last_active_date < now() - make_interval(months => :months) "
                    "ORDER BY last_active_date ASC"
                ),
                {"tid": tenant_id, "months": months},
            )
        ).fetchall()
        return [
            {
                "id": str(r[0]),
                "object_name": r[1],
                "category": r[2],
                "module": r[3],
                "last_active_date": str(r[4]) if r[4] else None,
                "months_inactive": r[5] or 0,
            }
            for r in rows
        ]

    async def get_z_drift(
        self, db: AsyncSession, tenant_id: str, run_id: str | None = None
    ) -> list[dict]:
        """New Z objects that first appeared recently (created_date within last run)."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))

        if run_id:
            # Find Z objects whose profiles exist for this run but no earlier run
            rows = (
                await db.execute(
                    text(
                        "SELECT r.id, r.object_name, r.module, r.category, r.created_date "
                        "FROM z_object_registry r "
                        "WHERE r.tenant_id = :tid "
                        "AND r.id IN ("
                        "  SELECT p.z_object_id FROM z_object_profiles p "
                        "  WHERE p.run_id = :rid AND p.tenant_id = :tid"
                        ") "
                        "AND r.id NOT IN ("
                        "  SELECT p2.z_object_id FROM z_object_profiles p2 "
                        "  WHERE p2.run_id != :rid AND p2.tenant_id = :tid"
                        ") "
                        "ORDER BY r.created_date DESC"
                    ),
                    {"tid": tenant_id, "rid": run_id},
                )
            ).fetchall()
        else:
            # Show entries created in the last 24 hours
            rows = (
                await db.execute(
                    text(
                        "SELECT id, object_name, module, category, created_date "
                        "FROM z_object_registry "
                        "WHERE tenant_id = :tid "
                        "AND created_date > now() - interval '24 hours' "
                        "ORDER BY created_date DESC"
                    ),
                    {"tid": tenant_id},
                )
            ).fetchall()

        return [
            {
                "id": str(r[0]),
                "object_name": r[1],
                "module": r[2],
                "category": r[3],
                "first_detected": str(r[4]) if r[4] else None,
            }
            for r in rows
        ]

    async def get_all_mappings(self, db: AsyncSession, tenant_id: str) -> list[dict]:
        """All Z objects that have a standard_equivalent mapping."""
        await db.execute(text(f"SET app.tenant_id TO '{tenant_id}'"))
        rows = (
            await db.execute(
                text(
                    "SELECT object_name, module, standard_equivalent, "
                    "COALESCE((profile_snapshot->>'relationship_score')::float, 0) as confidence "
                    "FROM z_object_registry "
                    "WHERE tenant_id = :tid AND standard_equivalent IS NOT NULL "
                    "AND standard_equivalent != '' "
                    "ORDER BY object_name"
                ),
                {"tid": tenant_id},
            )
        ).fetchall()
        return [
            {
                "object_name": r[0],
                "module": r[1],
                "standard_equivalent": r[2],
                "confidence": r[3] or 0.0,
                "mapping_source": "auto",
            }
            for r in rows
        ]
