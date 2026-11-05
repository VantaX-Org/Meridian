"""external_db_connections: read-only SQL database sources

Revision ID: 147
Revises: 146
Create Date: 2026-11-05

A tenant admin registers a connection to a non-SAP database (Postgres). The password is stored encrypted with the same
tenant-derived key as SAP system passwords (api/services/credential_store.py) and is never returned by the API.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "147"
down_revision: Union[str, None] = "146"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE external_db_connections (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            name text NOT NULL,
            engine text NOT NULL DEFAULT 'postgres' CHECK (engine IN ('postgres')),
            host text NOT NULL,
            port integer NOT NULL DEFAULT 5432,
            database text NOT NULL,
            username text NOT NULL,
            encrypted_password text NOT NULL,
            ssl_mode text NOT NULL DEFAULT 'require'
                CHECK (ssl_mode IN ('disable', 'require', 'verify-ca', 'verify-full')),
            created_by text,
            created_at timestamptz NOT NULL DEFAULT now(),
            last_tested_at timestamptz,
            last_test_ok integer,
            last_loaded_at timestamptz,
            UNIQUE (tenant_id, name)
        )""")
    op.execute("ALTER TABLE external_db_connections ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE external_db_connections FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS external_db_connections_rls ON external_db_connections")
    op.execute("CREATE POLICY external_db_connections_rls ON external_db_connections "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid) "
               "WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS external_db_connections")
