"""steward decisions on verified AI survivorship picks

Revision ID: 129
Revises: 128
Create Date: 2026-11-04

survivorship_decisions: one row per steward accept or override of an AI pick for a golden-record field.
Source systems only, never a value. The accept/override rates on the Aletheia screen are computed from it.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "129"
down_revision: Union[str, None] = "128"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS survivorship_decisions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            domain text NOT NULL,
            sap_object_key text NOT NULL,
            field text NOT NULL,
            decision text NOT NULL CHECK (decision IN ('accept', 'override')),
            prior_source text NOT NULL,
            new_source text NOT NULL,
            reason_code text CHECK (reason_code IN ('wrong_source', 'stale_value', 'incomplete_value', 'format_issue', 'other')),
            actor uuid,
            decided_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_survivorship_override_differs CHECK (decision = 'accept' OR prior_source <> new_source)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_survivorship_decisions_key "
               "ON survivorship_decisions (tenant_id, domain, sap_object_key, field, decided_at DESC)")
    op.execute("ALTER TABLE survivorship_decisions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE survivorship_decisions FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS survivorship_decisions_rls ON survivorship_decisions")
    op.execute("CREATE POLICY survivorship_decisions_rls ON survivorship_decisions "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS survivorship_decisions_rls ON survivorship_decisions")
    op.execute("DROP TABLE IF EXISTS survivorship_decisions")
