"""Cost of poor data quality and impact ranking.

findings.cost_at_risk / cost_formula — the amount a finding's failing records put at
risk and how it was computed (checks/cost.py); findings.impact_score — $ at risk ×
blocked SAP features × severity, the "impact" sort of GET /api/v1/findings.
tenants.cost_model — the tenant's overrides of checks/cost_model.yaml.

Revision ID: 056
Revises: 055
Create Date: 2026-10-04
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "056"
down_revision: Union[str, None] = "055"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("findings", sa.Column("cost_at_risk", sa.Numeric(), nullable=True))
    op.add_column("findings", sa.Column("cost_formula", sa.Text(), nullable=True))
    op.add_column("findings", sa.Column("impact_score", sa.Numeric(), nullable=True))
    op.add_column("tenants", sa.Column("cost_model", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "cost_model")
    op.drop_column("findings", "impact_score")
    op.drop_column("findings", "cost_formula")
    op.drop_column("findings", "cost_at_risk")
