#!/usr/bin/env bash
# =========================================================
# Meridian Platform — Restore script
# scripts/restore.sh
#
# Restores a backup produced by scripts/backup.sh:
#   1. Verifies manifest.json exists + can be parsed
#   2. Drops + recreates the meridian database (DESTRUCTIVE)
#   3. pg_restore the dump (--clean --if-exists so it can run twice)
#   4. Restores MinIO buckets from tar.gz
#   5. Copies .env back (or decrypts env.gpg if present)
#   6. Verifies migration head matches the manifest
#
# Usage:
#   sudo bash scripts/restore.sh /path/to/backups/20260424_120000
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
BACKUP_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --drill)   DRILL=true; shift ;;
        -h|--help)
            grep '^# ' "$0" | sed 's/^# //'
            exit 0
            ;;
        -*)        echo "Unknown flag: $1 (try --help)" >&2; exit 2 ;;
        *)         BACKUP_DIR="$1"; shift ;;
    esac
done

[[ -n "$BACKUP_DIR" ]] || { echo "Usage: $0 [--drill] <backup-dir>" >&2; exit 2; }
[[ -d "$BACKUP_DIR" ]] || fail "Backup directory not found: $BACKUP_DIR"
[[ -f "${BACKUP_DIR}/manifest.json" ]] || fail "Manifest missing: ${BACKUP_DIR}/manifest.json"
[[ -f "${BACKUP_DIR}/meridian.dump" ]] || fail "Database dump missing: ${BACKUP_DIR}/meridian.dump"

# Parse manifest fields without requiring jq (portable grep).
EXPECTED_HEAD=$(grep -oE '"migration_head": *"[^"]+"' "${BACKUP_DIR}/manifest.json" | head -1 | sed 's/.*": *"\([^"]*\)"/\1/' || echo "unknown")
info "Manifest head: $EXPECTED_HEAD"

COMPOSE_ARGS=()
if [[ -f "${REPO_ROOT}/docker/docker-compose.customer.yml" ]]; then
    COMPOSE_ARGS+=(-f "${REPO_ROOT}/docker/docker-compose.customer.yml")
elif [[ -f "${REPO_ROOT}/docker-compose.yml" ]]; then
    COMPOSE_ARGS+=(-f "${REPO_ROOT}/docker-compose.yml")
else
    fail "No docker-compose file found"
fi
DC="docker compose ${COMPOSE_ARGS[*]}"

TARGET_DB="meridian"
if [[ "$DRILL" == "true" ]]; then
    TARGET_DB="meridian_drill_$(date -u +%s)"
    info "DRILL mode — using temporary database: $TARGET_DB"
fi

# ─── Confirm destructive operation ─────────────────────────────────────────
if [[ "$DRILL" != "true" ]]; then
    warn "This will DROP + RECREATE the '$TARGET_DB' database. All current data will be lost."
    read -rp "  Type 'YES' to continue: " CONFIRM
    [[ "$CONFIRM" == "YES" ]] || { info "Aborted."; exit 0; }
fi

# ─── 1. Recreate target database ───────────────────────────────────────────
info "Ensuring $TARGET_DB does not exist..."
$DC exec -T db psql -U meridian -d postgres -c "DROP DATABASE IF EXISTS $TARGET_DB" >/dev/null

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

# ─── 4. MinIO + .env (skipped in drill mode) ───────────────────────────────
if [[ "$DRILL" != "true" ]]; then
    for bucket in meridian-uploads meridian-reports; do
        tarball="${BACKUP_DIR}/${bucket}.tar.gz"
        if [[ -f "$tarball" ]]; then
            info "Restoring MinIO bucket: $bucket"
            $DC cp "$tarball" "minio:/tmp/${bucket}.tar.gz"
            $DC exec -T minio sh -c \
                "rm -rf /data/${bucket} && mkdir -p /data && cd /data && tar -xzf /tmp/${bucket}.tar.gz"
            info "  $bucket restored"
        else
            warn "$bucket.tar.gz not found in backup — skipping"
        fi
    done

    if [[ -f "${BACKUP_DIR}/env.gpg" ]]; then
        info "Decrypting env.gpg (prompts for passphrase)..."
        gpg --decrypt --output "${REPO_ROOT}/.env" "${BACKUP_DIR}/env.gpg"
        chmod 600 "${REPO_ROOT}/.env"
    elif [[ -f "${BACKUP_DIR}/env.txt" ]]; then
        cp "${BACKUP_DIR}/env.txt" "${REPO_ROOT}/.env"
        chmod 600 "${REPO_ROOT}/.env"
        info ".env restored"
    fi
fi

# ─── 5. Drill cleanup ──────────────────────────────────────────────────────
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
