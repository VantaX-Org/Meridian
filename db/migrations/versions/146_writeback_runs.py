"""writeback_runs and writeback_run_records: batch write-back at volume

Revision ID: 146
Revises: 145
Create Date: 2026-11-05

A live write-back of an approved batch is a run a worker executes in chunks, not one HTTP request. ``writeback_runs``
holds the run (at most one open run per batch) and ``writeback_run_records`` one row per record with its state
(pending, sending, committed, failed, needs_check, export_only), the values to write (taken from the approved batch
items when the run is created) and SAP's answer. Both tables carry tenant_id under row level security.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "146"
down_revision: Union[str, None] = "145"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("writeback_runs", "writeback_run_records")


def upgrade() -> None:
    op.execute("""
        CREATE TABLE writeback_runs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            batch_id uuid NOT NULL REFERENCES remediation_batches(id) ON DELETE CASCADE,
            status text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued', 'running', 'paused', 'cancelling', 'completed',
                                  'completed_with_errors', 'cancelled')),
            pause_reason text,
            requested_by text NOT NULL,
            requested_label text,
            export_only integer NOT NULL DEFAULT 0,
            errors jsonb NOT NULL DEFAULT '[]',
            conn_failures integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            started_at timestamptz,
            heartbeat_at timestamptz NOT NULL DEFAULT now(),
            finished_at timestamptz,
            exported_at timestamptz
        )""")
    op.execute("CREATE INDEX ix_writeback_runs_batch ON writeback_runs (tenant_id, batch_id, created_at)")
    op.execute("CREATE UNIQUE INDEX uq_writeback_runs_open ON writeback_runs (tenant_id, batch_id) "
               "WHERE status IN ('queued', 'running', 'paused', 'cancelling')")
    op.execute("""
        CREATE TABLE writeback_run_records (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            run_id uuid NOT NULL REFERENCES writeback_runs(id) ON DELETE CASCADE,
            seq integer NOT NULL,
            system_id text NOT NULL,
            module text NOT NULL,
            record_key text NOT NULL,
            changes jsonb NOT NULL,
            state text NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending', 'sending', 'committed', 'failed', 'needs_check', 'export_only')),
            result jsonb,
            error text,
            attempts integer NOT NULL DEFAULT 0,
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (run_id, system_id, module, record_key)
        )""")
    op.execute("CREATE INDEX ix_writeback_run_records_state ON writeback_run_records (tenant_id, run_id, state, seq)")
    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid) "
                   f"WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS writeback_run_records")
    op.execute("DROP TABLE IF EXISTS writeback_runs")
