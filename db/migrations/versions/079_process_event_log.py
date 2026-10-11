"""process event log

Revision ID: 079
Revises: 078
Create Date: 2026-10-11

Process discovery: runs, the per-case event log and mined variants (spec §2.1).
The variant table is process_discovery_variants because process_variants already
exists (config-variant discovery, db/schema.py ProcessVariant).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "079"
down_revision: Union[str, None] = "078"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("process_discovery_runs", "process_events", "process_discovery_variants")


def upgrade() -> None:
    op.execute("ALTER TABLE sap_systems ADD COLUMN IF NOT EXISTS timezone text")
    op.execute("""
        CREATE TABLE IF NOT EXISTS process_discovery_runs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            system_id uuid NOT NULL REFERENCES sap_systems(id) ON DELETE CASCADE,
            l1 varchar(8) NOT NULL,
            mode varchar(12) NOT NULL,
            status varchar(16) NOT NULL,
            coverage varchar(12) NOT NULL DEFAULT 'reference',
            window_from date,
            window_to date,
            watermark timestamptz,
            extraction_version_id uuid,
            job_id varchar(64),
            filters jsonb NOT NULL DEFAULT '{}',
            stats jsonb NOT NULL DEFAULT '{}',
            model jsonb,
            error text,
            created_by uuid REFERENCES users(id),
            started_at timestamptz NOT NULL DEFAULT now(),
            finished_at timestamptz,
            CONSTRAINT ck_pdr_mode CHECK (mode IN ('full', 'incremental')),
            CONSTRAINT ck_pdr_status CHECK (status IN ('queued', 'waiting', 'extracting', 'building',
                                                       'mining', 'completed', 'failed')),
            CONSTRAINT ck_pdr_coverage CHECK (coverage IN ('discovered', 'partial', 'reference'))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_pdr_tenant_system_l1 "
               "ON process_discovery_runs (tenant_id, system_id, l1, started_at DESC)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS process_events (
            id bigserial PRIMARY KEY,
            tenant_id uuid NOT NULL,
            system_id uuid NOT NULL,
            l1 varchar(8) NOT NULL,
            case_type varchar(32) NOT NULL,
            case_id varchar(160) NOT NULL,
            activity varchar(64) NOT NULL,
            l5_id varchar(120),
            ts timestamptz NOT NULL,
            ts_precision varchar(6) NOT NULL,
            seq smallint NOT NULL DEFAULT 0,
            resource varchar(64),
            automated boolean,
            doc_type varchar(16),
            org jsonb NOT NULL DEFAULT '{}',
            object_refs jsonb NOT NULL DEFAULT '[]',
            attributes jsonb NOT NULL DEFAULT '{}',
            source_table varchar(40) NOT NULL,
            run_id uuid NOT NULL REFERENCES process_discovery_runs(id) ON DELETE CASCADE,
            CONSTRAINT ck_pe_precision CHECK (ts_precision IN ('second', 'day'))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_pe_case ON process_events "
               "(tenant_id, system_id, l1, case_type, case_id, ts, seq, id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pe_activity ON process_events (tenant_id, system_id, l1, activity)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pe_ts ON process_events (tenant_id, system_id, l1, ts)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_pe_run ON process_events (run_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS process_discovery_variants (
            run_id uuid NOT NULL REFERENCES process_discovery_runs(id) ON DELETE CASCADE,
            tenant_id uuid NOT NULL,
            case_type varchar(32) NOT NULL,
            variant_hash char(32) NOT NULL,
            activities text[] NOT NULL,
            case_count integer NOT NULL,
            share numeric(7,6) NOT NULL,
            median_seconds bigint,
            p90_seconds bigint,
            fitness numeric(5,4),
            sample_case_ids text[] NOT NULL,
            PRIMARY KEY (run_id, case_type, variant_hash)
        )
    """)
    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    for t in reversed(_TABLES):
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"DROP TABLE IF EXISTS {t}")
    op.execute("ALTER TABLE sap_systems DROP COLUMN IF EXISTS timezone")
