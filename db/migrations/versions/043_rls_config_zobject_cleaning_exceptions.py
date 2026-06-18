"""Enable Row-Level Security on 15 tenant-scoped tables that shipped without it.

Audit finding: the following tables each carry a ``tenant_id`` column but were
created with **no** ``ENABLE ROW LEVEL SECURITY`` and **no** ``CREATE POLICY``,
so tenant isolation on them depends entirely on application-level
``WHERE tenant_id = ...`` filtering. Migration 039 only ``FORCE``s tables that
already have RLS enabled, so it never covered these.

This migration closes the gap: ENABLE + FORCE + a ``tenant_isolation`` USING
policy keyed on ``current_setting('app.tenant_id')``. FORCE is required because
the application role (see 040_meridian_app_role) may own these tables, and a
table owner bypasses a merely-ENABLEd policy.

Tables (and the migration that created them):
  005  cleaning_rules
  006  exception_rules, exception_billing
  028  config_inventory, config_processes, config_process_steps,
       config_alignment_findings, config_health_scores, config_drift_log
  029  z_object_registry, z_object_profiles, z_object_baselines,
       z_object_anomalies, z_object_rules, z_object_findings

Revision ID: 043
Revises: 042
Create Date: 2026-06-18
"""

from typing import Sequence, Union

from alembic import op

revision: str = "043"
down_revision: Union[str, None] = "042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Every table here has a NOT NULL ``tenant_id UUID`` column.
_RLS_TABLES: tuple[str, ...] = (
    "cleaning_rules",
    "exception_rules",
    "exception_billing",
    "config_inventory",
    "config_processes",
    "config_process_steps",
    "config_alignment_findings",
    "config_health_scores",
    "config_drift_log",
    "z_object_registry",
    "z_object_profiles",
    "z_object_baselines",
    "z_object_anomalies",
    "z_object_rules",
    "z_object_findings",
)


def upgrade() -> None:
    for table in _RLS_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        # Idempotent: drop a stale policy of the same name before recreating.
        op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
        op.execute(
            f"CREATE POLICY {table}_rls ON {table} "
            "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
        )


def downgrade() -> None:
    for table in _RLS_TABLES:
        op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
