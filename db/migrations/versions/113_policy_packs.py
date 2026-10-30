"""policy packs: which packs a tenant applied, and their field classes materialised

Revision ID: 113
Revises: 112
Create Date: 2026-10-29

* policy_packs: one row per (tenant, pack of sap/policy_packs.yaml): whether it is applied, when and by whom it was
  applied and last unapplied. Unapplying keeps the row (the history of who turned the pack on and off is in
  audit_log as well).
* policy_field_classes: the field classes of every applied pack, materialised from the YAML at apply time: the
  class's label, authority reference, fields and the catalogue rules that evidence it. Removed on unapply. Read by
  GET /policy-packs, the evidence route and the ``policy_breaches`` count of the landscape cells and the receipt.

Both tenant-scoped with ENABLE + FORCE row-level security and the tenant policy.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, UUID

revision: str = "113"
down_revision: str | None = "112"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("policy_packs", "policy_field_classes")


def _tenant_fk() -> sa.Column:
    return sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "policy_packs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tenant_fk(),
        sa.Column("pack_id", sa.Text(), nullable=False),
        sa.Column("applied", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("applied_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("applied_by_label", sa.Text(), nullable=True),
        sa.Column("unapplied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("unapplied_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("unapplied_by_label", sa.Text(), nullable=True),
        sa.UniqueConstraint("tenant_id", "pack_id", name="uq_policy_packs_pack"),
    )
    op.create_table(
        "policy_field_classes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tenant_fk(),
        sa.Column("pack_id", sa.Text(), nullable=False),
        sa.Column("class_id", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("authority", sa.Text(), nullable=False),
        sa.Column("fields", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("rules", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("materialised_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "pack_id", "class_id", name="uq_policy_field_classes_class"),
    )
    op.create_index("ix_policy_field_classes_rules", "policy_field_classes", ["rules"], postgresql_using="gin")
    for table in _TABLES:
        _rls(table)


def downgrade() -> None:
    op.drop_table("policy_field_classes")
    op.drop_table("policy_packs")
