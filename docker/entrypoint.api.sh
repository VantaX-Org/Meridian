#!/bin/bash
set -e

echo "🔄 Waiting for database to be ready..."
until pg_isready -h "${DB_HOST:-db}" -U meridian; do
  echo "Database is unavailable - sleeping"
  sleep 2
done

echo "✅ Database is ready!"

echo "🔄 Running database migrations..."
if ! alembic upgrade head; then
  # After a rollback the database is at a newer revision than this image ships, and alembic cannot
  # locate it. Serve on the newer schema. Any other failure (a real migration error) stays fatal.
  python - <<'PY' || exit 1
import os, sys
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text
url = os.getenv("DATABASE_URL_MIGRATE") or os.getenv("DATABASE_URL_SYNC") or os.getenv("DATABASE_URL", "")
with create_engine(url.replace("postgresql+asyncpg://", "postgresql://")).connect() as c:
    rev = c.execute(text("select version_num from alembic_version")).scalar()
known = {r.revision for r in ScriptDirectory.from_config(Config("alembic.ini")).walk_revisions()}
if rev is None or rev in known:  # an empty table is a failed first install, not a rollback
    sys.exit(1)
print(f"Database revision {rev} is newer than this image; skipping migrations (rollback).")
PY
fi

echo "✅ Migrations complete!"

echo "🚀 Starting API server..."
# Several processes: a slow request or blocking work (an export, a large page) holds one, not the whole API.
exec uvicorn api.main:app --host 0.0.0.0 --port 8000 --workers "${API_WORKERS:-3}"
