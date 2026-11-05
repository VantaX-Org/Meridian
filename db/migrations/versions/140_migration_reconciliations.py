"""migration_reconciliations: the result of reconciling one migration run against the target system

Revision ID: 140
Revises: 137
Create Date: 2026-11-05

One row per reconciliation of a migration run's load against the target system's latest extraction: per-table counts,
the three DQS figures, and the capped per-record rows (missing, differing, unexpected). The record rows hold the
compared field values, as migration_gap_findings does. target_version_id and target_synced_at say which target
extraction was judged, so the API can show the result as stale once a newer one lands. Row level security is forced, as
on subject_requests (migration 134).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "140"
down_revision: Union[str, None] = "137"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS migration_reconciliations (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id),
            run_id uuid NOT NULL REFERENCES migration_runs(id) ON DELETE CASCADE,
            status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
            target_system_id uuid REFERENCES sap_systems(id) ON DELETE SET NULL,
            target_version_id uuid,
            target_synced_at timestamptz,
            summary jsonb NOT NULL DEFAULT '{}',
            tables jsonb NOT NULL DEFAULT '[]',
            records jsonb NOT NULL DEFAULT '{}',
            scores jsonb,
            record_cap integer,
            error_detail text,
            task_id text,
            requested_by uuid REFERENCES users(id),
            created_at timestamptz NOT NULL DEFAULT now(),
            completed_at timestamptz
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_migration_reconciliations_run "
               "ON migration_reconciliations (tenant_id, run_id, created_at DESC)")
    op.execute("ALTER TABLE migration_reconciliations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE migration_reconciliations FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS migration_reconciliations_rls ON migration_reconciliations")
    op.execute("CREATE POLICY migration_reconciliations_rls ON migration_reconciliations "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS migration_reconciliations")
