"""migration waves

Revision ID: 068
Revises: 067
Create Date: 2026-10-10

A wave is a planned cutover unit: source and target systems, modules, target
date, stage, readiness thresholds and sign-off. migration_runs.wave_id ties a
run to its wave so the cockpit can show a trend. Existing tenant settings
(alert_thresholds.readiness_waves: name -> [modules]) are copied into rows.
The copy runs before RLS is enabled, as the migration owner.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, UUID

revision: str = "068"
down_revision: Union[str, None] = "067"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STAGES = ("plan", "mock1", "mock2", "dress", "cutover")


def upgrade() -> None:
    op.create_table(
        "migration_waves",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("source_system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("target_system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("target_release", sa.Text(), nullable=False, server_default="s4hana"),
        sa.Column("modules", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("stage", sa.Text(), nullable=False, server_default="plan"),
        sa.Column("min_readiness", sa.Float(), nullable=False, server_default="95"),
        sa.Column("min_dqs", sa.Float(), nullable=True),
        sa.Column("signed_off_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("signed_off_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.CheckConstraint("stage IN ('plan', 'mock1', 'mock2', 'dress', 'cutover')", name="ck_migration_waves_stage"),
        sa.UniqueConstraint("tenant_id", "name", name="uq_migration_waves_tenant_name"),
    )
    op.create_index("ix_migration_waves_source", "migration_waves", ["tenant_id", "source_system_id"])
    op.add_column("migration_runs", sa.Column(
        "wave_id", UUID(as_uuid=True), sa.ForeignKey("migration_waves.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_migration_runs_wave", "migration_runs", ["wave_id", "completed_at"])

    op.execute("""
        INSERT INTO migration_waves (tenant_id, name, modules, min_dqs)
        SELECT t.id, w.key,
               ARRAY(SELECT jsonb_array_elements_text(w.value)),
               (t.alert_thresholds->>'readiness_dqs_threshold')::float
          FROM tenants t,
               jsonb_each(COALESCE(t.alert_thresholds->'readiness_waves', '{}'::jsonb)) AS w
         WHERE jsonb_typeof(w.value) = 'array'
        ON CONFLICT (tenant_id, name) DO NOTHING
    """)

    op.execute("ALTER TABLE migration_waves ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE migration_waves FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS migration_waves_rls ON migration_waves")
    op.execute("CREATE POLICY migration_waves_rls ON migration_waves "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.drop_index("ix_migration_runs_wave", table_name="migration_runs")
    op.drop_column("migration_runs", "wave_id")
    op.execute("DROP POLICY IF EXISTS migration_waves_rls ON migration_waves")
    op.drop_index("ix_migration_waves_source", table_name="migration_waves")
    op.drop_table("migration_waves")
