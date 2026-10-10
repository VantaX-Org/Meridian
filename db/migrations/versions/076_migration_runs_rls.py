"""migration_runs row-level security

Revision ID: 076
Revises: 075
Create Date: 2026-10-10

migration_runs had no RLS policy, so a query missing its tenant predicate could
read another tenant's runs. Same tenant policy as migration_waves (068).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "076"
down_revision: Union[str, None] = "075"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE migration_runs ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE migration_runs FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS migration_runs_rls ON migration_runs")
    op.execute("CREATE POLICY migration_runs_rls ON migration_runs "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS migration_runs_rls ON migration_runs")
    op.execute("ALTER TABLE migration_runs NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE migration_runs DISABLE ROW LEVEL SECURITY")
