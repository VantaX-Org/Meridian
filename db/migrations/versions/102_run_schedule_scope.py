"""run schedules carry a name, a cadence preset and an extraction scope

Revision ID: 102
Revises: 101
Create Date: 2026-10-29

sync_profiles (the run schedules: GET/POST/PATCH/DELETE /api/v1/schedules and the older /systems/{id}/profiles)
gain ``name`` (text, NULL = unnamed), ``preset`` (text: hourly, daily, weekdays, weekly or monthly when the cadence
was chosen as a preset, NULL for a hand-written cron or a manual schedule) and ``scope`` (jsonb, the same shape as a
download's scope: company_codes, plants, sales_orgs, purchasing_orgs, date_from, date_to, exclude_deleted; '{}' =
everything). Existing rows keep NULL, NULL and '{}'.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "102"
down_revision: Union[str, None] = "101"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sync_profiles", sa.Column("name", sa.Text(), nullable=True))
    op.add_column("sync_profiles", sa.Column("preset", sa.Text(), nullable=True))
    op.add_column("sync_profiles", sa.Column("scope", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")))


def downgrade() -> None:
    op.drop_column("sync_profiles", "scope")
    op.drop_column("sync_profiles", "preset")
    op.drop_column("sync_profiles", "name")
