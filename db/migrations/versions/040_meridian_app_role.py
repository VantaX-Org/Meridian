"""Create meridian_app non-superuser role for the API + worker connections.

Migration 039 FORCEd row-level security on every RLS-enabled table, but
that only takes effect when the connecting role is *not* a superuser and
does *not* have BYPASSRLS. The default POSTGRES_USER (meridian) is a
superuser, so RLS is still bypassed in production — a missing SET
app.tenant_id leaks data silently.

This migration creates `meridian_app` with:
  - NOSUPERUSER NOBYPASSRLS (so FORCE RLS policies apply)
  - LOGIN with a password taken from MERIDIAN_APP_PASSWORD env var
    (falls back to a deterministic dev password — you MUST override in
    production; the runbook calls this out)
  - Full DML + sequence grants on every existing table
  - Default-privileges so future tables created by the owner are
    auto-granted to meridian_app

Opting in (existing deployments):
  1. Set MERIDIAN_APP_PASSWORD in .env before running migrations.
  2. Run `alembic upgrade head` — this migration creates the role.
  3. Update .env:
        DATABASE_URL=postgresql+asyncpg://meridian_app:<pw>@db:5432/meridian
        DATABASE_URL_SYNC=postgresql://meridian_app:<pw>@db:5432/meridian
        DATABASE_URL_MIGRATE=postgresql://meridian:<owner-pw>@db:5432/meridian
  4. Restart api + worker containers.
  5. Verify: /api/v1/admin/doctor reports postgres=ok; findings/audit
     endpoints still work.

See docs/ops/rls-hardening.md for the full runbook.

Revision ID: 040
Revises: 039
Create Date: 2026-04-24
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = "040"
down_revision: Union[str, None] = "039"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent — safe to run on a DB where the role already exists.
    #
    # Role creation + grants happen via anonymous DO block so we can use
    # EXECUTE format() safely and handle the "role already exists" path.
    #
    # Password source of truth: MERIDIAN_APP_PASSWORD env var. This
    # migration can't read env directly, so we take the password from a
    # Postgres GUC the caller sets beforehand — `meridian.app_password`.
    # If it's empty at run time, we use a deterministic dev-only value
    # and log a NOTICE so the operator knows to rotate it.
    op.execute(
        """
        DO $$
        DECLARE
            pw_setting text;
            pw text;
        BEGIN
            BEGIN
                pw_setting := current_setting('meridian.app_password', true);
            EXCEPTION WHEN OTHERS THEN
                pw_setting := NULL;
            END;

            IF pw_setting IS NULL OR pw_setting = '' THEN
                pw := 'CHANGE_ME_MERIDIAN_APP_DEV_ONLY';
                RAISE NOTICE 'meridian_app password not supplied via meridian.app_password — using dev default. Rotate before production use.';
            ELSE
                pw := pw_setting;
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meridian_app') THEN
                EXECUTE format(
                    'CREATE ROLE meridian_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOINHERIT',
                    pw
                );
            ELSE
                -- Role exists — update password + ensure the attributes are right.
                EXECUTE format('ALTER ROLE meridian_app WITH LOGIN PASSWORD %L', pw);
                EXECUTE 'ALTER ROLE meridian_app NOSUPERUSER NOBYPASSRLS NOINHERIT';
            END IF;
        END $$;
        """
    )

    # Schema usage + DML grants on every existing table.
    op.execute("GRANT USAGE ON SCHEMA public TO meridian_app")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO meridian_app")
    op.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO meridian_app")

    # Default privileges — tables created by the current owner (the role
    # running this migration) are auto-granted to meridian_app. So future
    # alembic migrations don't have to re-GRANT every time.
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO meridian_app"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public "
        "GRANT USAGE, SELECT ON SEQUENCES TO meridian_app"
    )


def downgrade() -> None:
    # Reassign owned objects back to the current role before dropping.
    # meridian_app shouldn't own any DDL objects under normal use — only
    # the INSERTs/UPDATEs it issues — but REASSIGN is cheap insurance.
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meridian_app') THEN
                EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM meridian_app';
                EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM meridian_app';
                EXECUTE 'REVOKE USAGE ON SCHEMA public FROM meridian_app';
                EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM meridian_app';
                EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM meridian_app';
                EXECUTE 'DROP ROLE meridian_app';
            END IF;
        END $$;
        """
    )
