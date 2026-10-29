"""steward assignment template and steward assignments per organisational slice

Revision ID: 105
Revises: 104
Create Date: 2026-10-29

  assignment_templates   one row per tenant: the tenant's saved steward assignment template (object -> owner role,
                         slice, steward teams, and the people named for them). No row = the default template in
                         sap/steward_template.yaml.
  steward_assignments    one steward per (object, slice kind, slice value): company code, plant, sales organisation or
                         purchasing organisation, or ``*`` for an object assigned as a whole. The object's owner stays in
                         data_owners (kind 'object'). ``source`` says whether the template's Apply wrote the row.

Both tenant-scoped: ENABLE + FORCE row-level security with the tenant policy, like migration 104.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "105"
down_revision: str | None = "104"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("assignment_templates", "steward_assignments")


def upgrade() -> None:
    op.create_table(
        "assignment_templates",
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("template", JSONB(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_table(
        "steward_assignments",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("slice_kind", sa.Text(), nullable=False),
        sa.Column("slice_value", sa.Text(), nullable=False),
        sa.Column("steward_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("deputy_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source", sa.Text(), nullable=False, server_default="manual"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "module", "slice_kind", "slice_value", name="uq_steward_assignments_slice"),
        sa.CheckConstraint("slice_kind IN ('company_code','plant','sales_org','purchasing_org','none')",
                           name="ck_steward_assignments_kind"),
        sa.CheckConstraint("source IN ('template','manual')", name="ck_steward_assignments_source"),
    )
    op.create_index("ix_steward_assignments_steward", "steward_assignments", ["tenant_id", "steward_user_id"])
    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    for t in reversed(_TABLES):
        op.drop_table(t)
