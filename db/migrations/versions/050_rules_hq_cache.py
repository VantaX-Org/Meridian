"""rules_hq_cache — rule governance pushed from Meridian HQ in the licence manifest.

The licence middleware has always upserted into this table, but no migration
created it, so every HQ rule push failed silently. HQ entries whose id matches a
YAML check id set that check's enabled flag and severity (check logic itself
stays in YAML + Python). Deployment-wide catalogue, not tenant data.

Revision ID: 050
Revises: 049
Create Date: 2026-09-30
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "050"
down_revision: Union[str, None] = "049"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rules_hq_cache",
        sa.Column("id", sa.Text(), primary_key=True),  # the YAML check id, e.g. BP001
        sa.Column("name", sa.Text(), nullable=False, server_default=""),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("module", sa.Text(), nullable=False, server_default=""),
        sa.Column("category", sa.Text(), nullable=False, server_default=""),
        sa.Column("severity", sa.Text(), nullable=False, server_default="medium"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("conditions", JSONB(), nullable=False, server_default="[]"),
        sa.Column("thresholds", JSONB(), nullable=False, server_default="{}"),
        sa.Column("tags", JSONB(), nullable=False, server_default="[]"),
        sa.Column("source", sa.Text(), nullable=False, server_default="hq"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("rules_hq_cache")
