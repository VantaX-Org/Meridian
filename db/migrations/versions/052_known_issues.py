"""Records the customer's stewards already know are wrong, per system — the recall half
of the pilot scorecard (api/services/pilot_scorecard.py). Replaced as a whole on upload.

Revision ID: 052
Revises: 051
Create Date: 2026-10-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "052"
down_revision: Union[str, None] = "051"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "known_issues",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("scope", sa.Text(), nullable=False),          # source system id
        sa.Column("module", sa.Text(), nullable=False, server_default=""),  # '' = any object
        sa.Column("record_ref", sa.Text(), nullable=False),     # key parts as the steward gave them
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "scope", "module", "record_ref", name="uq_known_issues"),
    )
    op.create_index("ix_known_issues_tenant_scope", "known_issues", ["tenant_id", "scope"])
    op.execute("ALTER TABLE known_issues ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE known_issues FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS known_issues_rls ON known_issues")
    op.execute("CREATE POLICY known_issues_rls ON known_issues USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.drop_table("known_issues")
