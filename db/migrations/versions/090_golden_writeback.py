"""golden_writeback_requests: four-eyes write-back of a golden record to its SAP source systems

Revision ID: 090
Revises: 089
Create Date: 2026-10-26

write_back_log is keyed to a finding (finding_id NOT NULL) and carries one host; a golden-record
write-back has no finding and goes to several systems with a result per field, so it gets its own
request row:

  status   simulating -> simulated | simulation_failed -> pending_approval -> approved -> applying
           -> applied | applied_with_errors | failed;  rejected / cancelled close it
  targets  per system: system_id, name, type, supported, method, reason, and per field the golden
           value, the SAP target (BAPI or OData property), the current value and the result

At most one request per golden record may be waiting for approval or running (partial unique index).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "090"
down_revision: Union[str, None] = "089"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

T = "golden_writeback_requests"


def upgrade() -> None:
    op.create_table(
        T,
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("master_record_id", UUID(as_uuid=True), sa.ForeignKey("master_records.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="simulating"),
        sa.Column("requested_by", sa.Text(), nullable=False),
        sa.Column("approved_by", sa.Text(), nullable=True),
        sa.Column("rejected_by", sa.Text(), nullable=True),
        sa.Column("golden_snapshot", JSONB(), nullable=False, server_default="{}"),
        sa.Column("targets", JSONB(), nullable=False, server_default="[]"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("simulated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_golden_writeback_record", T, ["tenant_id", "master_record_id", "created_at"])
    op.execute(f"CREATE UNIQUE INDEX uq_golden_writeback_open ON {T} (tenant_id, master_record_id) "
               "WHERE status IN ('pending_approval', 'approved', 'applying')")
    op.execute("ALTER TABLE golden_writeback_requests ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE golden_writeback_requests FORCE ROW LEVEL SECURITY")
    op.execute(f"CREATE POLICY {T}_rls ON {T} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute(f"DROP POLICY IF EXISTS {T}_rls ON {T}")
    op.drop_table(T)
