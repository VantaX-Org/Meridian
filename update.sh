#!/usr/bin/env bash
# =========================================================
# Meridian Platform — Update script with canary + rollback
# scripts/update.sh
#
# Pulls the latest prod images, runs migrations, restarts services,
# and verifies the stack is healthy. If /health doesn't come up inside
# 120s, the previous image tags are restored automatically.
#
# Before pulling we snapshot the currently-running `:latest` tags to
# `:rollback`, so a failed roll-forward restores to exactly the bits
# that were running — not "the :latest of yesterday", which may have
# moved under us.
#
# Usage:
#   sudo bash scripts/update.sh              # update to latest
#   sudo bash scripts/update.sh --rollback   # roll back to previous
#   sudo bash scripts/update.sh --no-verify  # skip the /health probe
# =========================================================
set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

ACTION=update
VERIFY=true

while [[ $# -gt 0 ]]; do
    case "$1" in
        --rollback)   ACTION=rollback; shift ;;
        --no-verify)  VERIFY=false; shift ;;
        -h|--help)    grep '^# ' "$0" | sed 's/^# //'; exit 0 ;;
        *)            echo "Unknown flag: $1" >&2; exit 2 ;;
    esac
done

# Compose file discovery — match meridian-deploy.sh's logic.
if [[ -f "docker/docker-compose.customer.yml" ]]; then
    COMPOSE_FILE="docker/docker-compose.customer.yml"
elif [[ -f "docker-compose.yml" ]]; then
    COMPOSE_FILE="docker-compose.yml"
else
    error "No docker-compose file found"
fi

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

IMAGES=(
    "ghcr.io/vantax-org/meridian-api"
    "ghcr.io/vantax-org/meridian-worker"
    "ghcr.io/vantax-org/meridian-frontend"
    "ghcr.io/vantax-org/meridian-nginx"
)

# ─── Snapshot current images → :rollback tag ───────────────────────────────
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

# ─── Pull images (no auth required — packages are public) ───────────────────
pull_images() {
    info "Pulling latest images..."
    dc pull || error "Pull failed. Running stack is untouched. Check your network connection."
    info "Images pulled successfully"
}

# ─── Health verification ────────────────────────────────────────────────────
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

# ─── Rollback path ──────────────────────────────────────────────────────────
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
            error "Rollback completed but health check still failing — investigate: dc logs api"
        fi
    fi
    info "Rollback complete."
    exit 0
}

if [[ "$ACTION" == "rollback" ]]; then
    rollback
fi

# ─── Main update flow ───────────────────────────────────────────────────────
info "Updating Meridian to the latest released version..."

# 1. Snapshot current images before pulling new ones
snapshot_rollback_tags

# 2. Pull — failure aborts without touching the running stack
pull_images

# 3. Run migrations against the already-running api container.
#    FIX: use `exec` not `run --rm` — a throwaway container may not share
#    the same network aliases or pick up the correct DATABASE_URL_MIGRATE.
#    Failure stops here so we stay on the old version with unchanged schema.
info "Running database migrations..."
if ! dc exec -T api bash -c "cd /app && alembic upgrade head"; then
    warn "Migration failed. Services still running on previous version."
    error "Investigate the migration error before retrying."
fi

# 4. Roll forward
info "Restarting services..."
dc up -d --force-recreate api worker frontend nginx 2>/dev/null || true

# 5. Verify — if /health doesn't come up, auto-rollback
if [[ "$VERIFY" == "true" ]]; then
    if ! verify_health; then
        warn "/health never turned green after 120s. Auto-rolling back..."
        for img in "${IMAGES[@]}"; do
            if docker image inspect "${img}:rollback" >/dev/null 2>&1; then
                docker tag "${img}:rollback" "${img}:latest"
            fi
        done
        dc up -d --force-recreate api worker frontend nginx 2>/dev/null || true
        if ! verify_health; then
            error "Rollback also failed /health. Manual intervention required. Logs: dc logs api"
        fi
        error "Update rolled back. Running on previous images. Check 'dc logs api' for why the new images failed."
    fi
fi

# 6. Report version
VERSION=$(dc exec -T api curl -sf http://localhost:8000/health 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('version', 'unknown'))
except Exception:
    print('unknown')
" 2>/dev/null || echo "unknown")

echo ""
info "Update complete. Running version: $VERSION"
info "To revert: sudo bash scripts/update.sh --rollback"
