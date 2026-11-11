"""system_pairs and system_comparisons: any source and target system compared per module

Revision ID: 150
Revises: 149
Create Date: 2026-11-11

A pair names a source and a target system for one module, with optional per-table key overrides
(``key_map``: {"MARA": {"source": ["MATNR"], "target": ["BISMT"]}}). Each comparison run stores
counts, field differences, capped record pairs, a config comparison and source, projected and
actual target DQS (api/services/system_compare.py).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "150"
down_revision: Union[str, None] = "149"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_RLS = ("ALTER TABLE {t} ENABLE ROW LEVEL SECURITY",
        "ALTER TABLE {t} FORCE ROW LEVEL SECURITY",
        "DROP POLICY IF EXISTS {t}_rls ON {t}",
        "CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid) "
        "WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS system_pairs (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            module text NOT NULL,
            source_system_id uuid NOT NULL REFERENCES sap_systems(id) ON DELETE CASCADE,
            target_system_id uuid NOT NULL REFERENCES sap_systems(id) ON DELETE CASCADE,
            key_map jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_by uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_system_pairs UNIQUE (tenant_id, module, source_system_id, target_system_id),
            CONSTRAINT ck_system_pairs_distinct CHECK (source_system_id <> target_system_id)
        )""")
    op.execute("""
        CREATE TABLE IF NOT EXISTS system_comparisons (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            pair_id uuid NOT NULL REFERENCES system_pairs(id) ON DELETE CASCADE,
            status text NOT NULL DEFAULT 'queued',
            progress jsonb NOT NULL DEFAULT '{}'::jsonb,
            source_version_id uuid,
            target_version_id uuid,
            summary jsonb, tables jsonb, records jsonb, pairs jsonb, config jsonb, scores jsonb,
            task_id text, error_detail text,
            created_by uuid REFERENCES users(id) ON DELETE SET NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            completed_at timestamptz
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_system_comparisons_pair ON system_comparisons (tenant_id, pair_id, created_at DESC)")
    for t in ("system_pairs", "system_comparisons"):
        for sql in _RLS:
            op.execute(sql.format(t=t))


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS system_comparisons")
    op.execute("DROP TABLE IF EXISTS system_pairs")
