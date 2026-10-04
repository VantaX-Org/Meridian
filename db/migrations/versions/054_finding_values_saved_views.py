"""finding_records.field_values — the rule's column values of each failing record
(privacy-sensitive columns masked at evaluation), so the drill-down shows what is
wrong, not only which record. saved_views — named filter sets per user and page.

Revision ID: 054
Revises: 053
Create Date: 2026-10-04
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "054"
down_revision: Union[str, None] = "053"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("finding_records", sa.Column("field_values", JSONB(), nullable=True))

    op.create_table(
        "saved_views",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("route", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("filters", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "user_id", "route", "name", name="uq_saved_views_user_route_name"),
    )
    op.execute("ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE saved_views FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS saved_views_rls ON saved_views")
    op.execute("CREATE POLICY saved_views_rls ON saved_views "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.drop_table("saved_views")
    op.drop_column("finding_records", "field_values")
