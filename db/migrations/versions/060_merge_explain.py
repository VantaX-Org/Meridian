"""Merge explainability and unmerge.

- match_scores.explanation: per-attribute comparator, masked normalised values,
  similarity, weight, contribution and the band/threshold that fired.
- match_scores.steward_decision / steward_reason: accept/reject of a candidate pair.
- master_records.merged_into: cluster membership (member -> golden record).
  master_records.own_fields: the record's own pre-merge values, so unmerge can
  recompute survivorship for both sides. steward_overrides / survivorship_explanation
  keep the per-attribute winner, rule and losing values.
- mdm_merge_events: immutable merge / unmerge / undo / override / pair decision log
  with before/after snapshots (append-only trigger).
- mdm_pair_constraints: do_not_match / always_match pairs that survive cleaning reruns.

Revision ID: 060
Revises: 059
Create Date: 2026-10-04
"""

from typing import Sequence, Union

from alembic import op

revision: str = "060"
down_revision: Union[str, None] = "059"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE match_scores
            ADD COLUMN IF NOT EXISTS explanation JSONB,
            ADD COLUMN IF NOT EXISTS steward_decision TEXT,
            ADD COLUMN IF NOT EXISTS steward_reason TEXT
    """)
    op.execute("""
        ALTER TABLE master_records
            ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES master_records(id),
            ADD COLUMN IF NOT EXISTS own_fields JSONB,
            ADD COLUMN IF NOT EXISTS steward_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
            ADD COLUMN IF NOT EXISTS survivorship_explanation JSONB
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_master_records_merged_into ON master_records (tenant_id, merged_into)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS mdm_merge_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id),
            domain TEXT NOT NULL,
            event_type TEXT NOT NULL CHECK (event_type IN
                ('merge','unmerge','undo','remerge','override','pair_accept','pair_reject','pair_clear')),
            golden_record_id UUID REFERENCES master_records(id),
            member_keys TEXT[] NOT NULL DEFAULT '{}',
            actor UUID,
            reason TEXT,
            before JSONB,
            after JSONB,
            reverses_event_id UUID REFERENCES mdm_merge_events(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_mdm_merge_events_golden "
               "ON mdm_merge_events (tenant_id, golden_record_id, created_at DESC)")
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_mdm_merge_event_mutation() RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'mdm_merge_events is append-only';
        END;
        $$ LANGUAGE plpgsql
    """)
    op.execute("DROP TRIGGER IF EXISTS mdm_merge_events_immutable ON mdm_merge_events")
    op.execute("""
        CREATE TRIGGER mdm_merge_events_immutable BEFORE UPDATE OR DELETE ON mdm_merge_events
        FOR EACH ROW EXECUTE FUNCTION prevent_mdm_merge_event_mutation()
    """)

    op.execute("""
        CREATE TABLE IF NOT EXISTS mdm_pair_constraints (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id UUID NOT NULL REFERENCES tenants(id),
            domain TEXT NOT NULL,
            key_lo TEXT NOT NULL,
            key_hi TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('do_not_match','always_match')),
            reason TEXT,
            created_by UUID,
            event_id UUID REFERENCES mdm_merge_events(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (tenant_id, domain, key_lo, key_hi)
        )
    """)
    for t in ("mdm_merge_events", "mdm_pair_constraints"):
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS mdm_pair_constraints")
    op.execute("DROP TABLE IF EXISTS mdm_merge_events")
    op.execute("DROP FUNCTION IF EXISTS prevent_mdm_merge_event_mutation()")
    op.execute("DROP INDEX IF EXISTS ix_master_records_merged_into")
    op.execute("""
        ALTER TABLE master_records
            DROP COLUMN IF EXISTS survivorship_explanation,
            DROP COLUMN IF EXISTS steward_overrides,
            DROP COLUMN IF EXISTS own_fields,
            DROP COLUMN IF EXISTS merged_into
    """)
    op.execute("""
        ALTER TABLE match_scores
            DROP COLUMN IF EXISTS steward_reason,
            DROP COLUMN IF EXISTS steward_decision,
            DROP COLUMN IF EXISTS explanation
    """)
