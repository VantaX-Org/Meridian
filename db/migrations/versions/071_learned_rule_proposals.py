"""learned rule proposals

Revision ID: 071
Revises: 068
Create Date: 2026-10-10

House rules the tenant's own data follows (checks/house_rules.py), awaiting a
person's decision. One row per (tenant, module, fingerprint) for ever: re-mining
refreshes a pending row's statistics; approved and rejected rows are never
re-proposed. Approval writes an active rule_versions row under a new LR- id.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "071"
down_revision: Union[str, None] = "068"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "learned_rule_proposals",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("analysis_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("table_name", sa.Text(), nullable=False),
        sa.Column("determinant", sa.Text(), nullable=True),
        sa.Column("field", sa.Text(), nullable=False),
        sa.Column("fingerprint", sa.Text(), nullable=False),
        sa.Column("body", postgresql.JSONB(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("support_rows", sa.BigInteger(), nullable=False),
        sa.Column("violations", sa.BigInteger(), nullable=False),
        sa.Column("sample_keys", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("rule_id", sa.Text(), nullable=True),
        sa.Column("decided_by", sa.Text(), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "module", "fingerprint", name="uq_learned_rule_proposals_fp"),
        sa.CheckConstraint("kind IN ('dependency', 'value_set', 'format', 'range')", name="ck_learned_rule_kind"),
        sa.CheckConstraint("status IN ('pending', 'approved', 'rejected')", name="ck_learned_rule_status"),
    )
    op.create_index("ix_learned_rule_proposals_status", "learned_rule_proposals", ["tenant_id", "status"])
    _rls("learned_rule_proposals")


def downgrade() -> None:
    op.drop_table("learned_rule_proposals")
