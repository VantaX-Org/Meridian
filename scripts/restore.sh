#!/usr/bin/env bash
# =========================================================
# Meridian Platform — Restore script
# scripts/restore.sh
#
# Restores a backup produced by scripts/backup.sh:
#   1. Checks manifest.json and the dump (pg_restore must read it end to end) before anything changes
#   2. Asks for confirmation (type YES), unless --yes
#   3. Stops api, worker and beat, so nothing writes during the restore
#   4. Dumps the current database to backups/pre-restore-<ts>.dump as a way back, then drops (WITH FORCE)
#      and recreates the meridian database (DESTRUCTIVE)
#   5. pg_restore the dump
#   6. Verifies migration head matches the manifest
#   7. Restores object storage from objects.tar and .env (or decrypts env.gpg)
#   8. Starts api, worker and beat again. If the restore fails after step 4 they stay stopped.
#
# Usage:
#   sudo bash scripts/restore.sh /path/to/backups/20260424_120000
#   sudo bash scripts/restore.sh --yes /path/to/backups/20260424_120000   # no prompt (scripts)
#   sudo bash scripts/restore.sh --drill /path/to/backups/20260424_120000
#     # --drill mode: tests the restore against a temporary DB name,
#     #   doesn't touch the real meridian DB, exits non-zero if the
#     #   round-trip fails. Safe to run against a live system.
#
# Exit codes:
#   0  success
#   1  unrecoverable error
#   2  invalid arguments
#   3  verification mismatch (migration head differs)
# =========================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DRILL=false
ASSUME_YES=false
BACKUP_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --drill)   DRILL=true; shift ;;
        -y|--yes)  ASSUME_YES=true; shift ;;
        -h|--help)
            grep '^# ' "$0" | sed 's/^# //'
            exit 0
            ;;
        -*)        echo "Unknown flag: $1 (try --help)" >&2; exit 2 ;;
        *)         BACKUP_DIR="$1"; shift ;;
    esac
done

[[ -n "$BACKUP_DIR" ]] || { echo "Usage: $0 [--drill] [--yes] <backup-dir>" >&2; exit 2; }
[[ -d "$BACKUP_DIR" ]] || fail "Backup directory not found: $BACKUP_DIR"
[[ -f "${BACKUP_DIR}/manifest.json" ]] || fail "Manifest missing: ${BACKUP_DIR}/manifest.json"
[[ -s "${BACKUP_DIR}/meridian.dump" ]] || fail "Database dump missing or empty: ${BACKUP_DIR}/meridian.dump"
[[ "$(head -c 5 "${BACKUP_DIR}/meridian.dump")" == "PGDMP" ]] \
    || fail "Not a pg_dump custom-format file: ${BACKUP_DIR}/meridian.dump"

# Parse manifest fields without requiring jq (portable grep).
EXPECTED_HEAD=$(grep -oE '"migration_head": *"[^"]+"' "${BACKUP_DIR}/manifest.json" | head -1 | sed 's/.*": *"\([^"]*\)"/\1/' || echo "unknown")
info "Manifest head: $EXPECTED_HEAD"

COMPOSE_ARGS=()
if [[ -f "${REPO_ROOT}/docker/docker-compose.customer.yml" ]]; then
    COMPOSE_ARGS+=(-f "${REPO_ROOT}/docker/docker-compose.customer.yml")
    # The same overlays update.sh uses, so `run api` gets the host's DNS and RFC image.
    for overlay in docker-compose.rfc.yml docker-compose.dns.yml; do
        [[ -f "${REPO_ROOT}/docker/${overlay}" ]] && COMPOSE_ARGS+=(-f "${REPO_ROOT}/docker/${overlay}")
    done
elif [[ -f "${REPO_ROOT}/docker-compose.yml" ]]; then
    COMPOSE_ARGS+=(-f "${REPO_ROOT}/docker-compose.yml")
else
    fail "No docker-compose file found"
fi
DC="docker compose ${COMPOSE_ARGS[*]}"

# The whole dump must be readable before the live database is touched: reading it end to end
# (to /dev/null) also catches a file cut short, which a table-of-contents check would miss.
info "Checking the dump..."
$DC exec -T db pg_restore -f /dev/null < "${BACKUP_DIR}/meridian.dump" \
    || fail "pg_restore cannot read ${BACKUP_DIR}/meridian.dump: the dump is damaged or truncated. Nothing was changed."

TARGET_DB="meridian"
if [[ "$DRILL" == "true" ]]; then
    TARGET_DB="meridian_drill_$(date -u +%s)"
    info "DRILL mode — using temporary database: $TARGET_DB"
fi

# ─── Confirm destructive operation ─────────────────────────────────────────
APP_SERVICES=(api worker beat)
if [[ "$DRILL" != "true" ]]; then
    warn "This will DROP + RECREATE the '$TARGET_DB' database. All current data will be lost."
    warn "api, worker and beat are stopped for the restore and started again when it succeeds."
    if [[ "$ASSUME_YES" != "true" ]]; then
        [[ -t 0 ]] || fail "No terminal to confirm on: pass --yes to restore unattended."
        read -rp "  Type 'YES' to continue: " CONFIRM
        [[ "$CONFIRM" == "YES" ]] || { info "Aborted."; exit 0; }
    fi

    # Nothing may write to the database while it is replaced.
    info "Stopping ${APP_SERVICES[*]}..."
    $DC stop "${APP_SERVICES[@]}" >/dev/null || fail "Could not stop ${APP_SERVICES[*]}. Nothing was changed."
    # Any exit before step 5 (a failed step, set -e) leaves them stopped on purpose: the database may be half-restored.
    trap 'echo -e "${RED}[FAIL]${NC}  Restore did not finish: ${APP_SERVICES[*]} are left stopped. Fix the cause and run restore.sh again, or start them with: $DC start ${APP_SERVICES[*]}" >&2' EXIT

    # Taken after the stop, so it holds every last write. A way back if the wrong bundle was picked.
    # A broken or missing database is often why we restore, so a failed safety dump only warns.
    mkdir -p "${REPO_ROOT}/backups"
    SAFETY_DUMP="${REPO_ROOT}/backups/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).dump"
    if $DC exec -T db pg_dump -U meridian --format=custom --no-owner meridian > "$SAFETY_DUMP" 2>/dev/null \
            && [[ -s "$SAFETY_DUMP" ]]; then
        info "Current database saved to $SAFETY_DUMP"
    else
        rm -f "$SAFETY_DUMP"
        warn "Could not dump the current database first (continuing): there is no way back from this restore."
    fi

fi

# ─── 1. Recreate target database ───────────────────────────────────────────
# WITH (FORCE) ends any session still open (a psql shell, an updater check), PostgreSQL 13+.
info "Ensuring $TARGET_DB does not exist..."
$DC exec -T db psql -U meridian -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $TARGET_DB WITH (FORCE)" >/dev/null

info "Creating $TARGET_DB..."
$DC exec -T db psql -U meridian -d postgres -c "CREATE DATABASE $TARGET_DB" >/dev/null

# ─── 2. pg_restore ─────────────────────────────────────────────────────────
info "Restoring Postgres dump..."
# --no-owner + --no-privileges so we don't need role recreation on restore
# target. --exit-on-error fails the whole restore if any statement errors.
$DC exec -T db pg_restore \
    -U meridian \
    -d "$TARGET_DB" \
    --no-owner --no-privileges --exit-on-error \
    < "${BACKUP_DIR}/meridian.dump"
info "Dump restored"

# The app runs as the non-owner role meridian_app (RLS is enforced against it).
# --no-privileges dropped its grants, so re-grant whenever the role exists.
$DC exec -T db psql -U meridian -d "$TARGET_DB" -v ON_ERROR_STOP=1 -c "
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meridian_app') THEN
    GRANT USAGE ON SCHEMA public TO meridian_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO meridian_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO meridian_app;
  END IF;
END \$\$;" >/dev/null
info "App role grants re-applied"

# ─── 3. Verify migration head ──────────────────────────────────────────────
ACTUAL_HEAD=$($DC exec -T db psql -U meridian -d "$TARGET_DB" -tAc \
    "SELECT version_num FROM alembic_version LIMIT 1" 2>/dev/null | tr -d '\r' || echo "")
if [[ -z "$ACTUAL_HEAD" ]]; then
    fail "alembic_version table missing after restore"
fi
if [[ "$ACTUAL_HEAD" != "$EXPECTED_HEAD" ]]; then
    warn "Migration head mismatch:"
    warn "  expected: $EXPECTED_HEAD"
    warn "  actual:   $ACTUAL_HEAD"
    warn "Run \`alembic upgrade head\` to bring the restored DB forward."
    RESTORE_EXIT=3
else
    info "Migration head verified: $ACTUAL_HEAD"
    RESTORE_EXIT=0
fi

# ─── 4. Object storage + .env (skipped in drill mode) ───────────────────────────────
if [[ "$DRILL" != "true" ]]; then
    if [[ -f "${BACKUP_DIR}/objects.tar" ]]; then
        # Objects added after the backup are left in place (the restored database no longer refers to them).
        info "Restoring object storage..."
        $DC run --rm --no-deps -T --entrypoint python api -m api.services.storage_migration --import < "${BACKUP_DIR}/objects.tar" \
            || fail "Object storage restore failed"
    elif compgen -G "${BACKUP_DIR}/meridian-*.tar.gz" >/dev/null; then
        warn "This backup holds MinIO's raw data files, which Garage cannot load — objects not restored."
        warn "Restore them by hand: start the old MinIO on an empty volume, untar into /data, then run"
        warn "  python -m api.services.storage_migration --source-endpoint <that-minio>:9000  (in the api image)"
    else
        warn "objects.tar not found in backup — skipping object storage"
    fi

    if [[ -f "${BACKUP_DIR}/env.gpg" ]]; then
        if [[ -n "${MERIDIAN_BACKUP_PASSPHRASE_FILE:-}" ]]; then
            info "Decrypting env.gpg (passphrase from MERIDIAN_BACKUP_PASSPHRASE_FILE)..."
            gpg --batch --yes --pinentry-mode loopback --passphrase-file "$MERIDIAN_BACKUP_PASSPHRASE_FILE" \
                --decrypt --output "${REPO_ROOT}/.env" "${BACKUP_DIR}/env.gpg"
        else
            info "Decrypting env.gpg (prompts for passphrase)..."
            gpg --decrypt --output "${REPO_ROOT}/.env" "${BACKUP_DIR}/env.gpg"
        fi
        chmod 600 "${REPO_ROOT}/.env"
    elif [[ -f "${BACKUP_DIR}/env.txt" ]]; then
        cp "${BACKUP_DIR}/env.txt" "${REPO_ROOT}/.env"
        chmod 600 "${REPO_ROOT}/.env"
        info ".env restored"
    fi
fi

# ─── 5. Start the app again (real restore) ────────────────────────────────────
if [[ "$DRILL" != "true" ]]; then
    trap - EXIT
    # start, not up: the existing containers keep their image and overlays. api runs migrations at start.
    info "Starting ${APP_SERVICES[*]}..."
    $DC start "${APP_SERVICES[@]}" >/dev/null || fail "Restore done, but ${APP_SERVICES[*]} did not start: run $DC start ${APP_SERVICES[*]}"
fi

# ─── 6. Drill cleanup ──────────────────────────────────────────────────────
if [[ "$DRILL" == "true" ]]; then
    info "DRILL success — dropping temporary database $TARGET_DB"
    $DC exec -T db psql -U meridian -d postgres -c "DROP DATABASE IF EXISTS $TARGET_DB" >/dev/null
fi

echo ""
if [[ "$RESTORE_EXIT" -eq 0 ]]; then
    info "Restore complete (exit 0)"
else
    warn "Restore complete with migration-head mismatch (exit $RESTORE_EXIT)"
fi
exit "$RESTORE_EXIT"
