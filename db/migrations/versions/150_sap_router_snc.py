"""sap_systems: SAP router string and SNC settings

Revision ID: 150
Revises: 149
Create Date: 2026-11-11

An ABAP system behind a SAProuter, or one that only accepts Secure Network Communication, could not be
connected: the RFC connection had no router string and no SNC parameters. None of these are secrets: the
router string is a route, the SNC names are distinguished names. The SNC library path stays a deployment
setting (SNC_LIB), never a per-system field.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "150"
down_revision: Union[str, None] = "149"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE sap_systems
            ADD COLUMN IF NOT EXISTS saprouter text,
            ADD COLUMN IF NOT EXISTS snc_mode boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS snc_partnername text,
            ADD COLUMN IF NOT EXISTS snc_qop text,
            ADD COLUMN IF NOT EXISTS snc_myname text""")


def downgrade() -> None:
    op.execute("""
        ALTER TABLE sap_systems
            DROP COLUMN IF EXISTS snc_myname,
            DROP COLUMN IF EXISTS snc_qop,
            DROP COLUMN IF EXISTS snc_partnername,
            DROP COLUMN IF EXISTS snc_mode,
            DROP COLUMN IF EXISTS saprouter""")
