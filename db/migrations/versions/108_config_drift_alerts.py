"""config drift alerts: what a config change touches, who was told and the re-score it queued

Revision ID: 108
Revises: 107
Create Date: 2026-10-29

Independent of 104 and 105. Tenant-scoped with ENABLE + FORCE row-level security and the tenant policy.

* config_drift_alerts: one per config load or config sync that changed something (api/services/drift_alerts.py):
  the changed areas (config tables or objects, with added / removed / changed counts read from config_drift_log),
  the rules whose field, reference table or rule context depends on them, the objects those rules run on, how many
  owners were notified and the version queued for a re-score. One row per (tenant, run_id): reprocessing a load is a
  no-op.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

revision: str = "108"
down_revision: str | None = "107"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("config_drift_alerts",)


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "config_drift_alerts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("run_id", UUID(as_uuid=True), nullable=False),
        sa.Column("areas", JSONB(), nullable=False, server_default="[]"),
        sa.Column("rules", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("objects", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("notified", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rescore_queued", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("source IN ('config_load', 'config_sync')", name="ck_config_drift_alerts_source"),
        sa.UniqueConstraint("tenant_id", "run_id", name="uq_config_drift_alerts_run"),
    )
    op.create_index("ix_config_drift_alerts_tenant_created", "config_drift_alerts", ["tenant_id", "created_at"])
    for table in _TABLES:
        _rls(table)


def downgrade() -> None:
    op.drop_table("config_drift_alerts")
