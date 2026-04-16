"""Add unique constraint on findings(version_id, check_id, tenant_id)
and unique index on dqs_history(tenant_id, module_id, date).

Revision ID: 027
Revises: 026
Create Date: 2026-04-03
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "027"
down_revision: Union[str, None] = "026"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint(
        "uq_findings_version_check_tenant",
        "findings",
        ["version_id", "check_id", "tenant_id"],
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_dqs_history_tenant_module_day "
        "ON dqs_history (tenant_id, module_id, ((recorded_at AT TIME ZONE 'UTC')::date))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_dqs_history_tenant_module_day")
    op.drop_constraint("uq_findings_version_check_tenant", "findings", type_="unique")
