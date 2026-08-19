#!/usr/bin/env bash
# =========================================================
# Meridian Platform — Update script with canary + rollback
# scripts/update.sh
#
# Usage:
#   sudo bash scripts/update.sh                    # update to latest
#   sudo bash scripts/update.sh --rollback         # roll back to previous
#   sudo bash scripts/update.sh --no-verify        # skip the /health probe
#   sudo bash scripts/update.sh --include-updater  # also upgrade the updater
#                                                   # sidecar's own image, as
#                                                   # the very last step,
#                                                   # after the rest of the
#                                                   # update has already
#                                                   # verified healthy. Rare,
#                                                   # operator-driven — never
#                                                   # passed by the sidecar's
#                                                   # own POST /update.
# =========================================================
set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# write_status <state> <message>
# Lets the updater sidecar (updater/main.py) surface progress via GET
# /status. A complete no-op unless MERIDIAN_UPDATE_STATUS_FILE is set, so a
# human running this script directly (no sidecar, no env var) sees zero
# behavior change. Writes atomically (tmp file + mv) since the sidecar reads
# this file's contents directly for its API response — a torn write would
# corrupt it. `state == "pulling"` always resets started_at to now: it's
# structurally the first write of every run (see the main flow below), so
# this is how a fresh run's timestamp is distinguished from a stale one left
# over by a previous run.
write_status() {
    [[ -z "${MERIDIAN_UPDATE_STATUS_FILE:-}" ]] && return 0
    local state="$1" message="$2"
    python3 - "$MERIDIAN_UPDATE_STATUS_FILE" "$state" "$message" <<'PYEOF' 2>/dev/null || true
import json
import os
import sys
from datetime import datetime, timezone

path, state, message = sys.argv[1], sys.argv[2], sys.argv[3]
now = datetime.now(timezone.utc).isoformat()

started_at = now
if state != "pulling" and os.path.exists(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            existing = json.load(f)
        started_at = existing.get("started_at") or now
    except Exception:
        started_at = now

data = {"state": state, "message": message, "started_at": started_at, "updated_at": now}
tmp = f"{path}.tmp"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f)
os.replace(tmp, path)
PYEOF
}

ACTION=update
VERIFY=true
INCLUDE_UPDATER=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --rollback)         ACTION=rollback; shift ;;
        --no-verify)        VERIFY=false; shift ;;
        --include-updater)  INCLUDE_UPDATER=true; shift ;;
        -h|--help)          grep '^# ' "$0" | sed 's/^# //'; exit 0 ;;
        *)                  echo "Unknown flag: $1" >&2; exit 2 ;;
    esac
done

# Compose file discovery — use a function so -f is always passed correctly.
if [[ -f "docker/docker-compose.customer.yml" ]]; then
    COMPOSE_FILE="docker/docker-compose.customer.yml"
elif [[ -f "docker-compose.yml" ]]; then
    COMPOSE_FILE="docker-compose.yml"
else
    error "No docker-compose file found"
fi

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

# The `updater` service is defined only in the docker-compose.updater.yml
# overlay, never in $COMPOSE_FILE itself — so it needs its own explicit -f
# merge, used only by the --include-updater step at the very end. It is
# deliberately NOT part of dc()/$COMPOSE_FILE: every other `dc ...` call in
# this script (pulls, --force-recreate) must never be able to touch the
# updater service, or it could kill the very process running this update.
UPDATER_OVERLAY="docker/docker-compose.updater.yml"
[[ -f "$UPDATER_OVERLAY" ]] || UPDATER_OVERLAY=""

IMAGES=(
    "ghcr.io/vantax-org/meridian-api"
    "ghcr.io/vantax-org/meridian-worker"
    "ghcr.io/vantax-org/meridian-frontend"
    "ghcr.io/vantax-org/meridian-nginx"
)

snapshot_rollback_tags() {
    info "Snapshotting current images as :rollback..."
    for img in "${IMAGES[@]}"; do
        if docker image inspect "${img}:latest" >/dev/null 2>&1; then
            docker tag "${img}:latest" "${img}:rollback"
            info "  ${img}: :latest → :rollback"
        else
            warn "  ${img}:latest not present — no snapshot for this image"
        fi
    done
}

pull_images() {
    info "Pulling latest images..."
    dc pull || error "Pull failed. Running stack is untouched. Check your network connection."
    info "Images pulled successfully"
}

verify_health() {
    info "Verifying /health for up to 120s..."
    local timeout=120 interval=5 elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
        if dc exec -T api curl -sf http://localhost:8000/health 2>/dev/null | grep -q '"status":"ok"'; then
            info "API healthy ✓"
            return 0
        fi
        sleep "$interval"
        elapsed=$((elapsed + interval))
        printf "."
    done
    echo ""
    return 1
}

rollback() {
    info "Rolling back to previously-running images..."
    local missing=0
    for img in "${IMAGES[@]}"; do
        if ! docker image inspect "${img}:rollback" >/dev/null 2>&1; then
            warn "  ${img}:rollback not found — skipping"
            missing=$((missing + 1))
            continue
        fi
        docker tag "${img}:rollback" "${img}:latest"
        info "  ${img}: :latest ← :rollback"
    done
    if [[ "$missing" -eq "${#IMAGES[@]}" ]]; then
        error "No :rollback tags found — nothing to roll back to."
    fi
    info "Restarting services on rolled-back images..."
    dc up -d --force-recreate api worker frontend nginx 2>/dev/null || true
    if [[ "$VERIFY" == "true" ]]; then
        if ! verify_health; then
            error "Rollback completed but health check still failing — check: docker compose logs api"
        fi
    fi
    info "Rollback complete."
    exit 0
}

# ─── Emergency rollback during a failed roll-forward ────────────────────────
# Reached only when an update has already gone wrong. Restores the :rollback
# snapshot, recreates services, and always exits non-zero.
auto_rollback() {
    warn "$1 Auto-rolling back to previous images..."
    for img in "${IMAGES[@]}"; do
        if docker image inspect "${img}:rollback" >/dev/null 2>&1; then
            docker tag "${img}:rollback" "${img}:latest"
        fi
    done
    dc up -d --force-recreate api worker frontend nginx 2>/dev/null || true
    if ! verify_health; then
        write_status "failed" "Rollback also failed /health after: $1"
        error "Rollback also failed /health. Manual intervention required. Logs: docker compose logs api"
    fi
    write_status "rolled_back" "Update rolled back to previous images after: $1"
    error "Update rolled back. Running on previous images. Check 'docker compose logs api' for why the new version failed."
}

# Wait for the freshly-recreated api container to accept `exec` (up to ~30s),
# so the migration step below doesn't trip a false rollback on a slow start.
wait_for_api_container() {
    local tries=0
    while [[ $tries -lt 15 ]]; do
        if dc exec -T api true >/dev/null 2>&1; then return 0; fi
        sleep 2
        tries=$((tries + 1))
    done
    return 1
}

if [[ "$ACTION" == "rollback" ]]; then
    rollback
fi

info "Updating Meridian to the latest released version..."

snapshot_rollback_tags

write_status "pulling" "Pulling latest images..."
pull_images

# Roll forward onto the new images BEFORE migrating: `dc exec` targets the
# live container, so the api container must already be the new image — or
# `alembic upgrade head` execs into the OLD image and silently skips any
# migrations shipped with this release.
info "Restarting services on the new images..."
write_status "restarting" "Restarting services on the new images..."
dc up -d --force-recreate api worker frontend nginx 2>/dev/null || true

info "Running database migrations..."
if ! wait_for_api_container; then
    auto_rollback "New api container never became reachable."
fi
write_status "migrating" "Running database migrations..."
if ! dc exec -T api bash -c "cd /app && alembic upgrade head"; then
    auto_rollback "Migration failed on the new image."
fi

if [[ "$VERIFY" == "true" ]]; then
    write_status "verifying" "Verifying /health..."
    if ! verify_health; then
        auto_rollback "/health never turned green after 120s."
    fi
fi

VERSION=$(dc exec -T api curl -sf http://localhost:8000/health 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('version', 'unknown'))
except Exception:
    print('unknown')
" 2>/dev/null || echo "unknown")

echo ""
write_status "done" "Update complete. Running version: $VERSION"
info "Update complete. Running version: $VERSION"
info "To revert: sudo bash scripts/update.sh --rollback"

if [[ "$INCLUDE_UPDATER" == "true" ]]; then
    # Deliberately last, and only reached after verify_health has already
    # passed above — i.e. the new stack is known-healthy — before we touch
    # the updater sidecar's own image. Never add `updater` to the IMAGES
    # array or any --force-recreate list above this line: recreating it
    # mid-script would kill the very process running this update.
    if [[ -z "$UPDATER_OVERLAY" ]]; then
        warn "--include-updater requested but ${UPDATER_OVERLAY:-docker/docker-compose.updater.yml} was not found — skipping."
    else
        info "Pulling and recreating the updater sidecar (--include-updater)..."
        docker compose -f "$COMPOSE_FILE" -f "$UPDATER_OVERLAY" pull updater \
            && docker compose -f "$COMPOSE_FILE" -f "$UPDATER_OVERLAY" up -d --force-recreate updater
    fi
fi