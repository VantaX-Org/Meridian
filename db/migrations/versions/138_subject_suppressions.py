"""subject_suppressions: record keys that an erasure removed and extraction must not bring back

Revision ID: 138
Revises: 137
Create Date: 2026-11-05

Written when an erasure completes (api/services/subject_requests.py). One row per erased record key. It holds the
keyed hash of the key only (HMAC-SHA256 under the tenant secret, label "suppress"), the names of the key fields (no
values) so a row of an extract can be hashed the same way, and a count of the records dropped since. Row level
security is forced, as on subject_requests (migration 134). A lifted suppression stays as a row with lifted_at set, so
the trail survives; a partial unique index lets the same key be suppressed again after a lift.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "138"
down_revision: Union[str, None] = "137"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS subject_suppressions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id),
            key_hmac text NOT NULL,
            key_fields text NOT NULL,
            request_id uuid,
            dropped_count bigint NOT NULL DEFAULT 0,
            last_dropped_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            created_by text,
            lifted_at timestamptz,
            lifted_by text,
            lift_reason text
        )""")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_subject_suppressions_active "
               "ON subject_suppressions (tenant_id, key_hmac) WHERE lifted_at IS NULL")
    op.execute("ALTER TABLE subject_suppressions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE subject_suppressions FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS subject_suppressions_rls ON subject_suppressions")
    op.execute("CREATE POLICY subject_suppressions_rls ON subject_suppressions "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS subject_suppressions")
