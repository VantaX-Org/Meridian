"""load_approvals: the server-held four-eyes decision on a load

Revision ID: 180
Revises: 166
Create Date: 2026-11-13

NUMBER NOTE: taken at 180 so it cannot collide with open branches; renumber at merge if the head has moved.

One row per migration run. The user who prepared the run (migration_runs.requested_by) can never decide it; a
second decision on the same run is refused. The route writes an audit_log row for each decision.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "180"
down_revision: Union[str, None] = "166"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS load_approvals (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id),
            run_id uuid NOT NULL REFERENCES migration_runs(id) ON DELETE CASCADE,
            decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
            decided_by uuid NOT NULL REFERENCES users(id),
            comment text,
            decided_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (run_id)
        )""")
    op.execute("ALTER TABLE load_approvals ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE load_approvals FORCE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY tenant_isolation ON load_approvals
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)""")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS load_approvals")
