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

ORIGINAL_ARGS=("$@")
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

# SAP RFC overlay (scripts/build-rfc-overlay.sh) — present only on hosts that
# built the NW RFC SDK into api/worker/beat. Rebuilt after every pull below.
RFC_OVERLAY="$(dirname "$COMPOSE_FILE")/docker-compose.rfc.yml"
dc() {
    if [[ -f "$RFC_OVERLAY" ]]; then
        docker compose -f "$COMPOSE_FILE" -f "$RFC_OVERLAY" "$@"
    else
        docker compose -f "$COMPOSE_FILE" "$@"
    fi
}

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
    "ghcr.io/vantax-org/meridian-minio"
)

# Locally built RFC overlay images (scripts/build-rfc-overlay.sh) are
# snapshotted/restored alongside the registry images.
RFC_LOCAL_IMAGES=("meridian-api" "meridian-worker")
retag_rfc() {  # retag_rfc <from-tag> <to-tag>
    for img in "${RFC_LOCAL_IMAGES[@]}"; do
        if docker image inspect "${img}:$1" >/dev/null 2>&1; then
            docker tag "${img}:$1" "${img}:$2"
        fi
    done
}

snapshot_rollback_tags() {
    retag_rfc rfc-local rfc-rollback
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

# Custom-format dump of the whole database, taken before any migration runs.
# Rolling images back cannot un-migrate a schema; this file can
# (pg_restore --clean). Grants are kept so the app role still works after a restore.
backup_database() {
    mkdir -p backups
    PRE_UPDATE_DUMP="backups/pre-update-$(date -u +%Y%m%dT%H%M%SZ).dump"
    info "Backing up the database to ${PRE_UPDATE_DUMP}..."
    if ! dc exec -T db pg_dump -U meridian --format=custom --no-owner meridian > "$PRE_UPDATE_DUMP" \
            || [[ ! -s "$PRE_UPDATE_DUMP" ]]; then
        rm -f "$PRE_UPDATE_DUMP"
        error "Database backup failed — update aborted. Nothing was changed."
    fi
    info "Database backed up ($(du -h "$PRE_UPDATE_DUMP" | cut -f1))"
}

# Copy this release's deployment files (baked into the api image under /deploy)
# onto the host. When update.sh itself changed, re-run the new version so the
# rest of the update follows the new release's procedure.
place() {  # place <src> <dest> <mode> — keeps a .bak of a locally changed file
    if [[ -f "$2" ]] && ! cmp -s "$1" "$2"; then cp -p "$2" "$2.bak"; fi
    install -D -m "$3" "$1" "$2"
}

sync_deployment_files() {
    [[ -n "${MERIDIAN_UPDATE_REEXEC:-}" ]] && return 0
    local stage cid compose_dir changed_self=false
    stage=$(mktemp -d)
    cid=$(docker create ghcr.io/vantax-org/meridian-api:latest) \
        || { warn "Could not read deployment files from the new image — keeping current ones"; return 0; }
    if ! docker cp "$cid:/deploy/." "$stage/" 2>/dev/null; then
        docker rm "$cid" >/dev/null
        warn "New image carries no deployment bundle — keeping current deployment files"
        return 0
    fi
    docker rm "$cid" >/dev/null
    compose_dir=$(dirname "$COMPOSE_FILE")
    [[ "$COMPOSE_FILE" == *customer.yml ]] && place "$stage/docker/docker-compose.customer.yml" "$COMPOSE_FILE" 0644
    place "$stage/docker/docker-compose.updater.yml" "$compose_dir/docker-compose.updater.yml" 0644
    place "$stage/docker/Dockerfile.rfc" "$compose_dir/Dockerfile.rfc" 0644
    place "$stage/docker/nginx/meridian.conf" "$compose_dir/nginx/meridian.conf" 0644
    place "$stage/docker/nginx/nginx.conf" "$compose_dir/nginx/nginx.conf" 0644
    for f in "$stage"/scripts/*.sh; do
        name=$(basename "$f")
        [[ "$name" == "update.sh" ]] && ! cmp -s "$f" scripts/update.sh && changed_self=true
        place "$f" "scripts/$name" 0755
    done
    rm -rf "$stage"
    info "Deployment files synced from the new release (changed local files kept as *.bak)"
    if [[ "$changed_self" == "true" ]]; then
        info "update.sh changed in this release — continuing with the new version"
        exec env MERIDIAN_UPDATE_REEXEC=1 bash scripts/update.sh ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
    fi
}

rebuild_rfc_overlay() {
    [[ -f "$RFC_OVERLAY" ]] || return 0
    info "Rebuilding the SAP RFC overlay on the new images..."
    bash scripts/build-rfc-overlay.sh \
        || error "RFC overlay rebuild failed — update aborted before any restart. Running stack is untouched."
}

pull_images() {
    # Meridian images first, by name — independent of the (possibly outdated)
    # compose file on this host, which is refreshed from the new image next.
    info "Pulling latest images..."
    for img in "${IMAGES[@]}"; do
        docker pull "${img}:latest" >/dev/null \
            || error "Pull of ${img} failed. Running stack is untouched. Check network / docker login ghcr.io."
    done
    info "Images pulled successfully"
}

pull_dependencies() {
    # Postgres / Redis / MinIO as pinned by this release's compose file. A
    # failure here never blocks the update: running containers keep their image.
    docker compose -f "$COMPOSE_FILE" pull --ignore-pull-failures db redis minio >/dev/null 2>&1 \
        || warn "Could not pull db/redis/minio images — the running ones are kept."
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
    retag_rfc rfc-rollback rfc-local
    info "Restarting services on rolled-back images..."
    dc up -d --force-recreate api worker beat frontend nginx 2>/dev/null || true
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
    retag_rfc rfc-rollback rfc-local
    dc up -d --force-recreate api worker beat frontend nginx 2>/dev/null || true
    if ! verify_health; then
        write_status "failed" "Rollback also failed /health after: $1"
        error "Rollback also failed /health. Manual intervention required. Logs: docker compose logs api"
    fi
    write_status "rolled_back" "Update rolled back to previous images after: $1"
    if [[ -n "${PRE_UPDATE_DUMP:-}" ]]; then
        warn "If migrations had already run, restore the pre-update database with:"
        warn "  docker compose -f $COMPOSE_FILE exec -T db pg_restore -U meridian -d meridian --clean --if-exists < $PRE_UPDATE_DUMP"
    fi
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

if [[ -z "${MERIDIAN_UPDATE_REEXEC:-}" ]]; then
    snapshot_rollback_tags
fi

write_status "pulling" "Pulling latest images..."
pull_images
sync_deployment_files
pull_dependencies
rebuild_rfc_overlay

write_status "backing_up" "Backing up the database..."
backup_database

# Roll forward onto the new images BEFORE migrating: `dc exec` targets the
# live container, so the api container must already be the new image — or
# `alembic upgrade head` execs into the OLD image and silently skips any
# migrations shipped with this release.
info "Restarting services on the new images..."
write_status "restarting" "Restarting services on the new images..."
dc up -d --force-recreate api worker beat frontend nginx 2>/dev/null || true

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