"""learned_monitor_breaks: breaks from the baseline Meridian learns from its own run history

Revision ID: 132
Revises: 131
Create Date: 2026-11-04

One row per (run, object, kind, subject). Aggregates only: the expected range, the observed value, the number and ids
of the runs the baseline used. Steward state (acknowledged, expected, snoozed) lives on the row. Row level security is
forced, as on field_shift_anomalies (migration 127).

"""
from typing import Sequence, Union

from alembic import op

revision: str = "132"
down_revision: Union[str, None] = "131"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS learned_monitor_breaks (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id),
            version_id uuid NOT NULL REFERENCES analysis_versions(id) ON DELETE CASCADE,
            module text NOT NULL,
            kind text NOT NULL CHECK (kind IN ('volume_drop', 'volume_spike', 'fail_rate_jump', 'score_drop', 'field_emptied')),
            metric text NOT NULL CHECK (metric IN ('records', 'score', 'fail_rate', 'blank_pct')),
            subject_code text NOT NULL DEFAULT '',
            severity text NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
            expected_low double precision,
            expected_high double precision,
            median double precision,
            observed double precision NOT NULL,
            baseline_runs integer NOT NULL,
            baseline_run_ids jsonb NOT NULL DEFAULT '[]',
            method text NOT NULL,
            status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'expected', 'snoozed')),
            baseline_effect text CHECK (baseline_effect IN ('exclude', 'accept')),
            snoozed_until timestamptz,
            decided_by text,
            decided_at timestamptz,
            note text,
            explanation jsonb,
            detected_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_learned_monitor_breaks UNIQUE (version_id, module, kind, subject_code)
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_learned_monitor_breaks_tenant_version "
               "ON learned_monitor_breaks (tenant_id, version_id)")
    op.execute("ALTER TABLE learned_monitor_breaks ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE learned_monitor_breaks FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS learned_monitor_breaks_rls ON learned_monitor_breaks")
    op.execute("CREATE POLICY learned_monitor_breaks_rls ON learned_monitor_breaks "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS learned_monitor_breaks")
