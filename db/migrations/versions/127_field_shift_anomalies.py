"""field_shift_anomalies: null spikes and unexpected codes found by comparing a run's field profile with earlier runs

Revision ID: 127
Revises: 126
Create Date: 2026-11-02

One row per (run, object, TABLE.FIELD, kind). Aggregates only: row and blank counts of the run and of the run it is
compared with, and for an unexpected code the code values (non-sensitive code fields only) with their counts.
Row level security is forced, as on field_profiles (migration 051).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "127"
down_revision: Union[str, None] = "126"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS field_shift_anomalies (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id),
            version_id uuid NOT NULL REFERENCES analysis_versions(id) ON DELETE CASCADE,
            prev_version_id uuid REFERENCES analysis_versions(id) ON DELETE SET NULL,
            module text NOT NULL,
            table_name text NOT NULL,
            field text NOT NULL,
            kind text NOT NULL CHECK (kind IN ('null_spike', 'unexpected_code')),
            severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
            current jsonb NOT NULL DEFAULT '{}',
            previous jsonb NOT NULL DEFAULT '{}',
            codes jsonb NOT NULL DEFAULT '[]',
            detected_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_field_shift_anomalies UNIQUE (version_id, module, table_name, field, kind)
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_field_shift_anomalies_tenant_version "
               "ON field_shift_anomalies (tenant_id, version_id)")
    op.execute("ALTER TABLE field_shift_anomalies ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE field_shift_anomalies FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS field_shift_anomalies_rls ON field_shift_anomalies")
    op.execute("CREATE POLICY field_shift_anomalies_rls ON field_shift_anomalies "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS field_shift_anomalies")
