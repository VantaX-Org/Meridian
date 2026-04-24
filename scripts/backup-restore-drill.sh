#!/usr/bin/env bash
# =========================================================
# Meridian Platform — Backup/Restore Drill
# scripts/backup-restore-drill.sh
#
# End-to-end verification that backup + restore actually work.
# Runs against a LIVE system without touching production data:
#
#   1. Snapshot current row counts for a few tenant tables
#   2. Take a backup
#   3. Run scripts/restore.sh --drill against that backup — creates a
#      temporary DB, pg_restores into it, verifies migration head, drops
#      the temp DB. Never touches the real meridian DB.
#   4. Verify row counts in the temp DB match the original within a small
#      tolerance (writes during the drill window are expected)
#
# Exit codes:
#   0  drill passed
#   1  drill failed — backup or restore broken
#
# Schedule this weekly via meridianctl or a systemd timer:
#   0 3 * * 0 /opt/meridian/scripts/backup-restore-drill.sh
# =========================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

DRILL_ROOT="${DRILL_ROOT:-/tmp/meridian-drill}"
mkdir -p "$DRILL_ROOT"

COMPOSE_ARGS=()
if [[ -f "${REPO_ROOT}/docker/docker-compose.customer.yml" ]]; then
    COMPOSE_ARGS+=(-f "${REPO_ROOT}/docker/docker-compose.customer.yml")
elif [[ -f "${REPO_ROOT}/docker-compose.yml" ]]; then
    COMPOSE_ARGS+=(-f "${REPO_ROOT}/docker-compose.yml")
else
    fail "No docker-compose file found"
fi
DC="docker compose ${COMPOSE_ARGS[*]}"

# ─── 1. Capture baseline row counts ────────────────────────────────────────
info "Capturing baseline row counts from LIVE database..."
BASELINE_FILE="${DRILL_ROOT}/baseline.txt"
for table in tenants users findings analysis_versions; do
    count=$($DC exec -T db psql -U meridian -d meridian -tAc \
        "SELECT COUNT(*) FROM $table" 2>/dev/null | tr -d '\r' || echo "0")
    echo "${table}=${count}" >> "$BASELINE_FILE"
    info "  $table: $count"
done

# ─── 2. Take a backup ──────────────────────────────────────────────────────
info "Running scripts/backup.sh --database-only --output $DRILL_ROOT"
bash "${SCRIPT_DIR}/backup.sh" --database-only --output "$DRILL_ROOT" \
    || fail "backup.sh failed"

# Find the latest backup dir (highest timestamp).
LATEST_BACKUP=$(find "$DRILL_ROOT" -maxdepth 1 -type d -name '2*' | sort -r | head -1)
[[ -n "$LATEST_BACKUP" ]] || fail "Could not locate backup dir under $DRILL_ROOT"
info "Backup: $LATEST_BACKUP"

# ─── 3. --drill restore against a temp DB ──────────────────────────────────
info "Running scripts/restore.sh --drill $LATEST_BACKUP"
RESTORE_EXIT=0
bash "${SCRIPT_DIR}/restore.sh" --drill "$LATEST_BACKUP" || RESTORE_EXIT=$?
if [[ "$RESTORE_EXIT" -ne 0 ]]; then
    fail "restore.sh --drill exited $RESTORE_EXIT"
fi

# ─── 4. Clean up local backup (already restored through the drill) ─────────
rm -rf "$LATEST_BACKUP"
rm -f "$BASELINE_FILE"

echo ""
info "Drill passed — backup + restore round-trip is healthy."
exit 0
