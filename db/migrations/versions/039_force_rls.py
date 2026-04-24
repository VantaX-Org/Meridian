"""Force row-level security on every RLS-enabled table.

Postgres's ENABLE ROW LEVEL SECURITY does NOT apply to the table owner by
default. In production the API connects as the role that owns the schema
(via Alembic), so every policy is silently bypassed — a missing
`SET app.tenant_id` in any code path leaks data across tenants without
any error. The RLS integration tests in 2026-04 caught this.

FORCE closes the gap: the policies apply to the owner as well. DDL is
still allowed (migrations run fine), but DML must set app.tenant_id like
every other caller.

Applied dynamically — introspects pg_tables for tables that already have
rowsecurity=true so we don't have to enumerate 40+ tables by name and
keep this list in sync with every future migration.

Revision ID: 039
Revises: 038
Create Date: 2026-04-24
"""

from typing import Sequence, Union

from alembic import op


revision: str = "039"
down_revision: Union[str, None] = "038"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Discover RLS-enabled tables and FORCE each. Idempotent:
    # `FORCE ROW LEVEL SECURITY` is a no-op on tables that already have it.
    op.execute(
        """
        DO $$
        DECLARE
            t record;
        BEGIN
            FOR t IN
                SELECT schemaname, tablename
                FROM pg_tables
                WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                  AND rowsecurity = true
            LOOP
                EXECUTE format(
                    'ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
                    t.schemaname, t.tablename
                );
            END LOOP;
        END $$;
        """
    )


def downgrade() -> None:
    # Mirror image — unset FORCE on everything that still has rowsecurity=true.
    # We can't distinguish tables we FORCEd here from tables that were
    # already FORCEd, so NO FORCE on all of them on downgrade.
    op.execute(
        """
        DO $$
        DECLARE
            t record;
        BEGIN
            FOR t IN
                SELECT schemaname, tablename
                FROM pg_tables
                WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                  AND rowsecurity = true
            LOOP
                EXECUTE format(
                    'ALTER TABLE %I.%I NO FORCE ROW LEVEL SECURITY',
                    t.schemaname, t.tablename
                );
            END LOOP;
        END $$;
        """
    )
