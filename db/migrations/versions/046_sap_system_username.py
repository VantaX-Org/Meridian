"""Add sap_systems.username — per-system RFC user override and cloud basic-auth user.

Previously the RFC technical user was always read from the SAP_RFC_USER env
var (one value for the whole deployment), and cloud basic-auth connections
(api/services/connectivity_manager.py, api/routes/systems.py test_connection)
mistakenly reused that same SAP_RFC_USER value as the SuccessFactors/etc.
username — never a real per-system value. This column fixes both: RFC systems
can now override the global default, and cloud basic-auth systems get their
own username instead of an unrelated env var.

Revision ID: 046
Revises: 045
Create Date: 2026-08-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "046"
down_revision: Union[str, None] = "045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sap_systems", sa.Column("username", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("sap_systems", "username")
