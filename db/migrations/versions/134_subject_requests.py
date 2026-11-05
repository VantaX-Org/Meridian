"""subject_requests: the ledger of data-subject access and erasure requests

Revision ID: 134
Revises: 133
Create Date: 2026-11-05

One row per access export, erasure dry run and erasure execution. It holds no personal value: the subject is stored
only as an HMAC of the key (keyed by the tenant secret), plus the number of keys and rows found per table. The
reason is free text written by the admin. Row level security is forced, as on learned_monitor_breaks (migration 132).

Erasure also has to reach two tables that refuse change. The append-only triggers on master_record_history and
mdm_merge_events now step aside when the transaction sets app.subject_erasure = 'on' (SET LOCAL, so it ends with the
transaction). This is a soft guard against mistakes, not a security boundary: the ledger records each use. The foreign
key from mdm_merge_events to master_records becomes ON DELETE SET NULL so a golden record can go while its scrubbed
merge event stays. A partial unique index makes a dry run executable once, whatever the timing of two requests.

"""
from typing import Sequence, Union

from alembic import op

revision: str = "134"
down_revision: Union[str, None] = "133"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TRIGGER_FN = """
    CREATE OR REPLACE FUNCTION {name}() RETURNS TRIGGER AS $$
    BEGIN
        {bypass}RAISE EXCEPTION '{message}';
    END;
    $$ LANGUAGE plpgsql"""
_BYPASS = """IF current_setting('app.subject_erasure', true) = 'on' THEN
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END IF;
        """
_GUARDED = (
    ("prevent_mdm_merge_event_mutation", "mdm_merge_events is append-only"),
    ("prevent_master_record_history_mutation",
     "master_record_history is append-only — UPDATE and DELETE are not permitted"),
)
_FK = "mdm_merge_events_golden_record_id_fkey"


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
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_subject_requests_executed "
               "ON subject_requests (tenant_id, dry_run_id) WHERE dry_run = false")
    for name, message in _GUARDED:
        op.execute(_TRIGGER_FN.format(name=name, bypass=_BYPASS, message=message))
    op.execute(f"ALTER TABLE mdm_merge_events DROP CONSTRAINT IF EXISTS {_FK}, ADD CONSTRAINT {_FK} "
               "FOREIGN KEY (golden_record_id) REFERENCES master_records(id) ON DELETE SET NULL")


def downgrade() -> None:
    op.execute(f"ALTER TABLE mdm_merge_events DROP CONSTRAINT IF EXISTS {_FK}, ADD CONSTRAINT {_FK} "
               "FOREIGN KEY (golden_record_id) REFERENCES master_records(id)")
    for name, message in _GUARDED:
        op.execute(_TRIGGER_FN.format(name=name, bypass="", message=message))
    op.execute("DROP TABLE IF EXISTS subject_requests")
