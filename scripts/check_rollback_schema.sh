#!/usr/bin/env bash
# D-22: prove the previous release's code runs on the newest schema, which is the state after a rollback
# (scripts/update.sh restores images, not the database). Usage: check_rollback_schema.sh <previous-release-checkout>
# Needs DATABASE_URL_SYNC, DATABASE_URL, REDIS_URL set and pg_isready on PATH; run from the repo root with this
# code's dependencies installed. The previous code is started through this checkout's docker/entrypoint.api.sh.
set -euo pipefail
PREV="$(cd "${1:?previous release checkout}" && pwd)"
HERE="$(pwd)"
LOG="${TMPDIR:-/tmp}/prev-api.log"
export PYTHONPATH=. DB_HOST=127.0.0.1 AUTH_MODE=local CREDENTIAL_MASTER_KEY=ci_credential_master_key_not_a_secret
BASE=http://127.0.0.1:8000
PW='ci-rollback-Pass1!'

alembic upgrade head
python scripts/manage_users.py create --email ci@example.test --password "$PW" --role admin --name CI

cd "$PREV"
bash "$HERE/docker/entrypoint.api.sh" > "$LOG" 2>&1 &
API=$!
trap 'kill $API 2>/dev/null || true; tail -n 40 "$LOG"' EXIT

for i in $(seq 1 60); do
  curl -sf "$BASE/health" | grep -q '"status":"ok"' && break
  [ "$i" -eq 60 ] && { echo "previous release never answered /health on the head schema"; exit 1; }
  sleep 2
done
echo "previous release answers /health on the head schema"

TOKEN=$(curl -sf -X POST "$BASE/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"ci@example.test\",\"password\":\"$PW\"}" | python -c 'import json,sys; print(json.load(sys.stdin)["token"])')
for path in /api/v1/auth/me /api/v1/rules /api/v1/findings; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE$path")
  echo "GET $path -> $code"
  [ "$code" = 200 ] || exit 1
done
