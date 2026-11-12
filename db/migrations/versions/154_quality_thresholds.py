"""quality_thresholds: tenant target / warning / critical per DQS dimension and module

Revision ID: 154
Revises: 153
Create Date: 2026-11-11

One row per (module, dimension). module '*' is the tenant default; dimension 'overall' is the
composite DQS. A module with no row of its own takes the tenant default, and a tenant with no
row takes tenants.dqs_weights.thresholds (api/services/scoring.py resolve_thresholds).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "154"
down_revision: Union[str, None] = "153"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE quality_thresholds (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            module text NOT NULL DEFAULT '*',
            dimension text NOT NULL,
            target numeric NOT NULL,
            warning numeric NOT NULL,
            critical numeric NOT NULL,
            updated_by uuid,
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT quality_thresholds_order CHECK (
                critical >= 0 AND critical <= warning AND warning <= target AND target <= 100),
            UNIQUE (tenant_id, module, dimension)
        )""")
    op.execute("ALTER TABLE quality_thresholds ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE quality_thresholds FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS quality_thresholds_rls ON quality_thresholds")
    op.execute("CREATE POLICY quality_thresholds_rls ON quality_thresholds "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid) "
               "WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS quality_thresholds")
