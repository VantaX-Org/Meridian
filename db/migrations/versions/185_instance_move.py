"""instance_move: plans, runs, record status, checkpoints, reconciliations and cleansing log for a move

Revision ID: 185
Revises: 180
Create Date: 2026-11-17

NUMBER NOTE: taken at 185 so it cannot collide with open branches; renumber at merge if the head has moved.

A move copies the data of one system into another (same IDs, full history, cleansed by default). Nothing is
written to a system unless sap_systems.migration_target is true. Every table carries tenant RLS.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "185"
down_revision: Union[str, None] = "180"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = {
    "move_plans": """
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        source_system_id uuid NOT NULL REFERENCES sap_systems(id),
        target_system_id uuid NOT NULL REFERENCES sap_systems(id),
        modules text[] NOT NULL,
        mode text NOT NULL DEFAULT 'cleansed' CHECK (mode IN ('cleansed', 'as_is')),
        id_map_upload_id uuid,
        plan jsonb NOT NULL DEFAULT '{}'::jsonb,
        preflight jsonb,
        sample jsonb,
        exclude_countries jsonb,
        created_by uuid,
        created_at timestamptz NOT NULL DEFAULT now()""",
    "move_runs": """
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        plan_id uuid NOT NULL REFERENCES move_plans(id) ON DELETE CASCADE,
        kind text NOT NULL DEFAULT 'load' CHECK (kind IN ('load', 'retry', 'delta')),
        dry_run boolean NOT NULL DEFAULT true,
        waves int[],
        since timestamptz,
        status text NOT NULL DEFAULT 'queued',
        reason text,
        report jsonb NOT NULL DEFAULT '{}'::jsonb,
        cleansing jsonb,
        requested_by uuid,
        started_at timestamptz,
        finished_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()""",
    "move_record_status": """
        id bigserial PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        run_id uuid NOT NULL REFERENCES move_runs(id) ON DELETE CASCADE,
        entity text NOT NULL,
        pass int NOT NULL DEFAULT 1,
        record_key text NOT NULL,
        status text NOT NULL,
        http_code int,
        message text,
        row_hash text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (run_id, entity, pass, record_key)""",
    "move_checkpoints": """
        id bigserial PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        run_id uuid NOT NULL REFERENCES move_runs(id) ON DELETE CASCADE,
        wave int NOT NULL,
        entity text NOT NULL,
        pass int NOT NULL DEFAULT 1,
        batch int NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (run_id, entity, pass, batch)""",
    "move_reconciliations": """
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        plan_id uuid NOT NULL REFERENCES move_plans(id) ON DELETE CASCADE,
        status text NOT NULL DEFAULT 'queued',
        result jsonb,
        created_at timestamptz NOT NULL DEFAULT now()""",
    "move_cleansing_log": """
        id bigserial PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        run_id uuid NOT NULL REFERENCES move_runs(id) ON DELETE CASCADE,
        record_key text NOT NULL,
        field text NOT NULL,
        old_value text,
        new_value text,
        rule_id text,
        source text NOT NULL CHECK (source IN ('rule', 'steward', 'workbook'))""",
}


def upgrade() -> None:
    op.execute("ALTER TABLE sap_systems ADD COLUMN IF NOT EXISTS migration_target boolean NOT NULL DEFAULT false")
    for name, cols in _TABLES.items():
        op.execute(f"CREATE TABLE IF NOT EXISTS {name} ({cols})")
        op.execute(f"ALTER TABLE {name} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {name} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {name}")
        op.execute(f"""CREATE POLICY tenant_isolation ON {name}
            USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
            WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)""")
    for col in ("sample", "exclude_countries"):  # plans created before pilot mode
        op.execute(f"ALTER TABLE move_plans ADD COLUMN IF NOT EXISTS {col} jsonb")
    op.execute("CREATE INDEX IF NOT EXISTS ix_move_record_status_failed ON move_record_status (run_id, status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_move_cleansing_log_run ON move_cleansing_log (run_id)")


def downgrade() -> None:
    for name in reversed(list(_TABLES)):
        op.execute(f"DROP TABLE IF EXISTS {name}")
    op.execute("ALTER TABLE sap_systems DROP COLUMN IF EXISTS migration_target")
