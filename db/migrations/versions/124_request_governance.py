"""change request governance: per-field change history and tenant entry defaults

Revision ID: 124
Revises: 123
Create Date: 2026-11-02

change_request_field_changes: one row per field a draft gained, changed, lost or had defaulted (old and new value, who).
workflow_events carry no field values by design, so the values live here, tenant scoped.
request_defaults: a value a tenant administrator sets for a field of a create request; filled in when the field is empty.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "124"
down_revision: Union[str, None] = "123"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("change_request_field_changes", "request_defaults")


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS change_request_field_changes (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            request_id uuid NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
            field text NOT NULL,
            action text NOT NULL CHECK (action IN ('set', 'changed', 'removed', 'defaulted')),
            old_value text,
            new_value text,
            actor_id uuid,
            actor_label text,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_cr_field_changes_request "
               "ON change_request_field_changes (tenant_id, request_id, created_at)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS request_defaults (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            object text NOT NULL CHECK (object IN ('material', 'customer', 'vendor', 'business_partner')),
            field text NOT NULL,
            value text NOT NULL,
            updated_by uuid,
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_request_defaults UNIQUE (tenant_id, object, field)
        )
    """)
    for t in TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    for t in TABLES:
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"DROP TABLE IF EXISTS {t}")
