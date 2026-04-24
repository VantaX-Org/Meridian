import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, text

from db.schema import Base

config = context.config

# Override sqlalchemy.url from environment if available.
# Precedence: DATABASE_URL_MIGRATE > DATABASE_URL_SYNC > DATABASE_URL.
# DATABASE_URL_MIGRATE lets operators point migrations at a privileged
# owner role while leaving DATABASE_URL / DATABASE_URL_SYNC pointing at
# a non-superuser app role (see migration 040 + docs/ops/rls-hardening.md).
database_url = (
    os.getenv("DATABASE_URL_MIGRATE")
    or os.getenv("DATABASE_URL_SYNC")
    or os.getenv("DATABASE_URL", "")
)
# Ensure we use the sync driver for migrations
if database_url:
    database_url = database_url.replace("postgresql+asyncpg://", "postgresql://")
    config.set_main_option("sqlalchemy.url", database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        # Thread MERIDIAN_APP_PASSWORD through as a per-session GUC so
        # migration 040 (meridian_app role) can read it. Safe if unset —
        # migration 040 falls back to a logged dev default.
        #
        # Postgres `SET` rejects bound parameters — must interpolate the
        # string literal. Escape single quotes the SQL-standard way.
        app_password = os.getenv("MERIDIAN_APP_PASSWORD", "")
        if app_password:
            escaped = app_password.replace("'", "''")
            connection.execute(text(f"SET meridian.app_password = '{escaped}'"))

        context.configure(
            connection=connection, target_metadata=target_metadata
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
