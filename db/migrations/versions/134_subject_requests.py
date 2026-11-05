"""subject_requests: the ledger of data-subject access and erasure requests

Revision ID: 134
Revises: 132
Create Date: 2026-11-05

One row per access export, erasure dry run and erasure execution. It holds no personal value: the subject is stored
only as an HMAC of the key (keyed by the tenant secret), plus the number of keys and rows found per table. The
reason is free text written by the admin. Row level security is forced, as on learned_monitor_breaks (migration 132).

Migration 133 is taken by another open change; when it lands, point down_revision here at "133".

"""
from typing import Sequence, Union

from alembic import op

revision: str = "134"
down_revision: Union[str, None] = "132"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS subject_requests (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id),
            kind text NOT NULL CHECK (kind IN ('access', 'erasure')),
            dry_run boolean NOT NULL,
            subject_hmac text NOT NULL,
            key_set_hmac text NOT NULL,
            key_count integer NOT NULL DEFAULT 0,
            rows_by_table jsonb NOT NULL DEFAULT '{}',
            storage jsonb NOT NULL DEFAULT '{}',
            dry_run_id uuid,
            reason text,
            status text NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'incomplete')),
            actor_user_id text,
            actor_email text,
            created_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_subject_requests_tenant_created "
               "ON subject_requests (tenant_id, created_at DESC)")
    op.execute("ALTER TABLE subject_requests ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE subject_requests FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS subject_requests_rls ON subject_requests")
    op.execute("CREATE POLICY subject_requests_rls ON subject_requests "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS subject_requests")
