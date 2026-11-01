"""aletheia actions: the findings a person acted on, with the baseline to prove the result

Revision ID: 123
Revises: 122
Create Date: 2026-11-01

One row per (object, rule, action, run): the run, the object's score and the rule's failing records when the
person acted. GET /insights/findings compares them with the object's next run to show the realised gain.
Counts and scores only, never record values.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "123"
down_revision: Union[str, None] = "122"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS aletheia_actions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            module text NOT NULL,
            check_id text NOT NULL,
            action text NOT NULL,
            version_id uuid NOT NULL,
            affected_before integer,
            score_before numeric,
            created_by uuid,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_aletheia_actions UNIQUE (tenant_id, module, check_id, action, version_id)
        )
    """)
    op.execute("ALTER TABLE aletheia_actions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE aletheia_actions FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS aletheia_actions_rls ON aletheia_actions")
    op.execute("CREATE POLICY aletheia_actions_rls ON aletheia_actions "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS aletheia_actions_rls ON aletheia_actions")
    op.execute("DROP TABLE IF EXISTS aletheia_actions")
