"""data_requests and data_request_items: a steward asks a business owner to supply missing or wrong values

Revision ID: 165
Revises: 160
Create Date: 2026-11-12

A request names one object in one run, an owner, a due date and a note. Each item is one record and field the owner
fills in. A submitted value is a cleaning_queue proposal (items.queue_id), so approval, apply and audit stay in the
cleaning queue; the request's progress is read from those proposals, never stored.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "165"
down_revision: Union[str, None] = "160"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("data_requests", "data_request_items")


def upgrade() -> None:
    op.execute("""
        CREATE TABLE data_requests (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            version_id uuid NOT NULL REFERENCES analysis_versions(id) ON DELETE CASCADE,
            module text NOT NULL,
            owner_id uuid NOT NULL,
            created_by uuid,
            due_date date NOT NULL,
            note text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        )""")
    op.execute("CREATE INDEX ix_data_requests_tenant_owner ON data_requests (tenant_id, owner_id)")
    op.execute("""
        CREATE TABLE data_request_items (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            request_id uuid NOT NULL REFERENCES data_requests(id) ON DELETE CASCADE,
            check_id text NOT NULL,
            record_key text NOT NULL,
            field text NOT NULL,
            current_value text,
            new_value text,
            queue_id uuid,
            submitted_at timestamptz,
            UNIQUE (request_id, record_key, field)
        )""")
    for t in TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} "
                   "USING (tenant_id = current_setting('app.tenant_id')::uuid) "
                   "WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS data_request_items")
    op.execute("DROP TABLE IF EXISTS data_requests")
