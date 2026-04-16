#!/bin/bash
set -e

echo "🔄 Waiting for database to be ready..."
until pg_isready -h db -U meridian; do
  echo "Database is unavailable - sleeping"
  sleep 2
done

echo "✅ Database is ready!"

echo "🔄 Running database migrations..."
alembic upgrade head

echo "✅ Migrations complete!"

echo "🚀 Starting API server..."
exec uvicorn api.main:app --host 0.0.0.0 --port 8000
