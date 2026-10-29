"""data contract enforcement: enforce flag, per-object thresholds and the breaches each run records

Revision ID: 110
Revises: 109
Create Date: 2026-10-29

Independent of 104 and 105.

* contracts.enforce: an enforced contract's breaches block pinning a run as the baseline (POST
  /versions/{id}/baseline answers 409 unless forced with a reason, which is audited).
* contracts.thresholds: per object of the contract's scope ``{min_score, max_critical_breaches, dimensions: {dim:
  min}}``; when unset, the quality_contract's ``min_dqs`` and dimension minimums apply per object.
* contract_breaches: one row per (contract, run, object, metric) a finished run breached
  (api/services/contract_enforcement.py, written by the contract evaluation after each run). Tenant-scoped with
  ENABLE + FORCE row-level security and the tenant policy.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "110"
down_revision: str | None = "109"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("contract_breaches",)


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.add_column("contracts", sa.Column("enforce", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("contracts", sa.Column("thresholds", JSONB(), nullable=True))
    op.create_table(
        "contract_breaches",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contract_id", UUID(as_uuid=True), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("metric", sa.Text(), nullable=False),
        sa.Column("threshold", sa.Float(), nullable=True),
        sa.Column("actual", sa.Float(), nullable=True),
        sa.Column("enforced", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("contract_id", "version_id", "module", "metric", name="uq_contract_breaches_metric"),
    )
    op.create_index("ix_contract_breaches_contract", "contract_breaches", ["tenant_id", "contract_id", "created_at"])
    op.create_index("ix_contract_breaches_version", "contract_breaches", ["tenant_id", "version_id"])
    for table in _TABLES:
        _rls(table)


def downgrade() -> None:
    op.drop_table("contract_breaches")
    op.drop_column("contracts", "thresholds")
    op.drop_column("contracts", "enforce")
