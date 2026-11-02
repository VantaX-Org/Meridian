"""change request derivation rules and critical fields

Revision ID: 126
Revises: 125
Create Date: 2026-11-02

request_derivations: when a field of a request equals (or is one of) given values, set another field to a constant.
request_critical_fields: TABLE.FIELD a change request may not touch without an extra approval step.
change_request_field_changes.action gains 'derived'.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "126"
down_revision: Union[str, None] = "125"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("request_derivations", "request_critical_fields")
OBJECTS = "('material', 'customer', 'vendor', 'business_partner')"


def upgrade() -> None:
    op.execute(f"""
        CREATE TABLE IF NOT EXISTS request_derivations (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            object text NOT NULL CHECK (object IN {OBJECTS}),
            when_field text NOT NULL,
            when_values jsonb NOT NULL,
            target_field text NOT NULL,
            value text NOT NULL,
            updated_by uuid,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_request_derivations UNIQUE (tenant_id, object, when_field, when_values, target_field)
        )
    """)
    op.execute(f"""
        CREATE TABLE IF NOT EXISTS request_critical_fields (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            object text NOT NULL CHECK (object IN {OBJECTS}),
            field text NOT NULL,
            updated_by uuid,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_request_critical_fields UNIQUE (tenant_id, object, field)
        )
    """)
    for t in TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")
    op.execute("ALTER TABLE change_request_field_changes DROP CONSTRAINT IF EXISTS change_request_field_changes_action_check")
    op.execute("ALTER TABLE change_request_field_changes ADD CONSTRAINT change_request_field_changes_action_check "
               "CHECK (action IN ('set', 'changed', 'removed', 'defaulted', 'derived'))")


def downgrade() -> None:
    op.execute("DELETE FROM change_request_field_changes WHERE action = 'derived'")
    op.execute("ALTER TABLE change_request_field_changes DROP CONSTRAINT IF EXISTS change_request_field_changes_action_check")
    op.execute("ALTER TABLE change_request_field_changes ADD CONSTRAINT change_request_field_changes_action_check "
               "CHECK (action IN ('set', 'changed', 'removed', 'defaulted'))")
    for t in TABLES:
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"DROP TABLE IF EXISTS {t}")
