"""Remediation batches: approved fix files a human loads into SAP.

  remediation_batches  draft → approved (approver recorded) → exported
  remediation_items    one row per (record, check): field, current value,
                       proposed value and where it came from (rule fix_value,
                       steward entry, or blank = manual); reconciled against
                       the next extraction (fixed / still_failing)
  remediation_events   per-record audit trail

Meridian never writes to SAP: a batch is only ever exported as a file.

Revision ID: 058
Revises: 057
Create Date: 2026-10-04
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "058"
down_revision: Union[str, None] = "057"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("remediation_batches", "remediation_items", "remediation_events")


def upgrade() -> None:
    op.create_table(
        "remediation_batches",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),
        sa.Column("filter", JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_by", UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_label", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("approved_by", UUID(as_uuid=True), nullable=True),
        sa.Column("approved_by_label", sa.Text(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exported_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('draft', 'approved', 'exported')", name="ck_remediation_batches_status"),
    )
    op.create_index("ix_remediation_batches_tenant", "remediation_batches", ["tenant_id", "status"])

    op.create_table(
        "remediation_items",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("batch_id", UUID(as_uuid=True), sa.ForeignKey("remediation_batches.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("issue_id", UUID(as_uuid=True), sa.ForeignKey("record_issues.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("check_id", sa.Text(), nullable=False),
        sa.Column("record_key", sa.Text(), nullable=False),
        sa.Column("grain", sa.Text(), nullable=True),
        sa.Column("field", sa.Text(), nullable=True),
        sa.Column("current_value", sa.Text(), nullable=True),
        sa.Column("proposed_value", sa.Text(), nullable=True),
        sa.Column("proposal_source", sa.Text(), nullable=False, server_default="manual"),
        sa.Column("recon_status", sa.Text(), nullable=True),
        sa.Column("recon_version", UUID(as_uuid=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("batch_id", "check_id", "record_key", name="uq_remediation_items"),
        sa.CheckConstraint("proposal_source IN ('rule', 'steward', 'manual')", name="ck_remediation_items_source"),
        sa.CheckConstraint("recon_status IS NULL OR recon_status IN ('fixed', 'still_failing')",
                           name="ck_remediation_items_recon"),
    )
    op.create_index("ix_remediation_items_batch", "remediation_items", ["batch_id"])
    op.create_index("ix_remediation_items_recon", "remediation_items", ["tenant_id", "scope", "check_id"])

    op.create_table(
        "remediation_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("batch_id", UUID(as_uuid=True), sa.ForeignKey("remediation_batches.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("item_id", UUID(as_uuid=True), sa.ForeignKey("remediation_items.id", ondelete="CASCADE"),
                  nullable=True),
        sa.Column("user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("user_label", sa.Text(), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),  # created|proposed|approved|exported|reconciled
        sa.Column("from_value", sa.Text(), nullable=True),
        sa.Column("to_value", sa.Text(), nullable=True),
        sa.Column("version_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_remediation_events_item", "remediation_events", ["batch_id", "item_id", "created_at"])

    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    for t in reversed(_TABLES):
        op.drop_table(t)
