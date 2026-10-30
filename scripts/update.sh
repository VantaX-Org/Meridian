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
    "ghcr.io/vantax-org/meridian-garage"
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
    mkdir -p "$(dirname "$2")" && install -m "$3" "$1" "$2"  # not install -D: GNU-only
}

# Tier 2 installs run Ollama from a resolved copy of the overlay (the model tag
# substituted in at deploy time). Re-resolve it from the new release, keeping
# the installed model tag, and recreate only the ollama container when its
# definition changed. Installs without a resolved overlay are left alone.
sync_ollama_overlay() {  # sync_ollama_overlay <stage> <compose_dir>
    local template="$1/docker/docker-compose.customer.ollama.yml"
    local resolved="$2/docker-compose.customer.ollama.resolved.yml" tag
    [[ -f "$template" && -f "$resolved" ]] || return 0
    tag=$(sed -n 's|.*image: *ghcr.io/vantax-org/meridian-ollama:||p' "$resolved" | head -1)
    [[ -n "$tag" ]] || { warn "Could not read the Ollama model tag — keeping the current Ollama overlay"; return 0; }
    place "$template" "$2/docker-compose.customer.ollama.yml" 0644
    sed "s|{{MODEL_TAG}}|${tag}|g" "$template" > "$resolved.new"
    if cmp -s "$resolved.new" "$resolved"; then rm -f "$resolved.new"; return 0; fi
    mv "$resolved.new" "$resolved"
    docker compose -f "$COMPOSE_FILE" -f "$resolved" up -d --no-deps ollama >/dev/null \
        && info "Ollama settings updated from the new release" \
        || warn "Ollama overlay updated but the container was not recreated — run: docker compose -f $COMPOSE_FILE -f $resolved up -d ollama"
}

# The release's meridian.conf ships with HTTPS commented out. An install that
# has certificates (SSL mode 2 or 3) gets HTTPS and the port 80 redirect back
# after the files are synced; nginx-https.sh is idempotent. Runs outside
# sync_deployment_files so it also runs after update.sh re-executes itself.
reapply_https_nginx() {
    local compose_dir conf
    compose_dir=$(dirname "$COMPOSE_FILE")
    conf="$compose_dir/nginx/meridian.conf"
    [[ -s "$compose_dir/nginx/certs/fullchain.pem" && -f "$conf" ]] || return 0
    [[ -f scripts/nginx-https.sh ]] || { warn "scripts/nginx-https.sh missing - HTTPS not re-applied to $conf"; return 0; }
    bash scripts/nginx-https.sh "$conf" && info "HTTPS kept enabled in nginx" \
        || warn "Could not re-apply HTTPS to $conf"
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
    sync_ollama_overlay "$stage" "$compose_dir"
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

# One time, on installs that still run MinIO: copy every object into Garage
# (api.services.storage_migration verifies each copy by SHA-256) before the
# stack is switched over. The old MinIO volume is never touched, so the data
# stays recoverable until an operator removes it.
STORAGE_MARKER=".storage-migrated"
migrate_object_storage() {
    [[ -f "$STORAGE_MARKER" ]] && return 0
    local cfg project net old vol apps old_env
    cfg=$(dc config --format json 2>/dev/null | python3 -c \
        'import json,sys; c=json.load(sys.stdin); print(c["name"], c["networks"]["meridian-net"]["name"])' 2>/dev/null) \
        || error "Could not read the compose configuration — update aborted before any restart."
    read -r project net <<<"$cfg"
    old=$(docker ps -aq --filter "label=com.docker.compose.project=${project}" \
        --filter "label=com.docker.compose.service=minio" | head -1)
    if [[ -z "$old" ]]; then
        if docker volume inspect "${project}_minio_data" >/dev/null 2>&1 \
                && ! docker volume inspect "${project}_storage_data" >/dev/null 2>&1; then
            error "MinIO data (volume ${project}_minio_data) found but no MinIO container to copy it from — update aborted, nothing changed."
        fi
        return 0
    fi
    info "Moving object storage from MinIO to Garage (one time; every object is verified)..."
    # Read with the old MinIO's own credentials, so .env may already carry new (16+ char) ones.
    old_env=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$old")
    export STORAGE_SOURCE_ACCESS_KEY STORAGE_SOURCE_SECRET_KEY
    STORAGE_SOURCE_ACCESS_KEY=$(sed -n 's/^MINIO_ROOT_USER=//p' <<<"$old_env")
    STORAGE_SOURCE_SECRET_KEY=$(sed -n 's/^MINIO_ROOT_PASSWORD=//p' <<<"$old_env")
    write_status "migrating_storage" "Copying object storage from MinIO to Garage..."
    apps=$(dc ps -q api worker beat)
    [[ -n "$apps" ]] && docker stop $apps >/dev/null
    docker start "$old" >/dev/null
    # The old MinIO answers only as meridian-minio-migrate; "minio" becomes Garage.
    docker network disconnect "$net" "$old" 2>/dev/null || true
    docker network connect --alias meridian-minio-migrate "$net" "$old"
    if dc up -d --wait storage \
            && dc run --rm --no-deps -T -e STORAGE_SOURCE_ACCESS_KEY -e STORAGE_SOURCE_SECRET_KEY \
                --entrypoint python api \
                -m api.services.storage_migration --source-endpoint meridian-minio-migrate:9000; then
        vol=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$old")
        docker rm -f "$old" >/dev/null
        date -u +%FT%TZ > "$STORAGE_MARKER"
        info "Object storage moved to Garage ✓"
        warn "The old MinIO volume ${vol} is kept for rollback. Once Meridian checks out, free it with: docker volume rm ${vol}"
        return 0
    fi
    dc logs --no-log-prefix storage 2>/dev/null | grep '^storage:' | tail -5 >&2 || true
    dc rm -sf storage >/dev/null 2>&1 || true
    docker network disconnect "$net" "$old" 2>/dev/null || true
    docker network connect --alias minio "$net" "$old"
    [[ -n "$apps" ]] && docker start $apps >/dev/null
    write_status "failed" "Object storage copy to Garage failed — still running on MinIO."
    error "Copying object storage to Garage failed — update aborted; Meridian keeps running on MinIO and the previous images. Reason in the log lines above."
}

pull_images() {
    # Meridian images first, by name — independent of the (possibly outdated)
    # compose file on this host, which is refreshed from the new image next.
    info "Pulling latest images..."
    # Docker's own root and containerd's content store (used by the containerd image store) can sit on
    # different filesystems; an image pull fills whichever one holds the layers.
    local d free
    for d in "$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)" /var/lib/containerd; do
        [[ -d "$d" ]] || continue
        free=$(df -Pk "$d" | awk 'NR==2{print int($4/1048576)}')
        [[ "${free:-0}" -ge 10 ]] \
            || error "Only ${free:-?} GB free on ${d}. Running stack is untouched. Free space (docker image prune -f; docker builder prune -f) and rerun."
    done
    local out
    for img in "${IMAGES[@]}"; do
        if ! out=$(docker pull "${img}:latest" 2>&1 >/dev/null); then
            echo "$out" | tail -3 >&2
            if grep -q 'no space left on device' <<<"$out"; then
                error "Pull of ${img} failed: disk full. Running stack is untouched. Free space (docker image prune -f; docker builder prune -f) and rerun."
            fi
            error "Pull of ${img} failed. Running stack is untouched. Check network / docker login ghcr.io."
        fi
    done
    info "Images pulled successfully"
}

pull_dependencies() {
    # Postgres / Redis as pinned by this release's compose file (object storage is a Meridian image). A
    # failure here never blocks the update: running containers keep their image.
    docker compose -f "$COMPOSE_FILE" pull --ignore-pull-failures db redis >/dev/null 2>&1 \
        || warn "Could not pull db/redis images — the running ones are kept."
}

# `docker compose up -d` recreates a container whose configuration changed; it does NOT
# start one left merely in the `Created` state, which is what an interrupted update leaves
# behind. Observed on this deployment (2026-10-16): api, worker, beat and frontend came up
# while nginx stayed `Created` through both the roll-forward and the rollback, so the site was
# down even though the API itself was healthy - and verify_health, which polls only the API,
# could not see it. Start anything left behind before judging health.
ensure_started() {
    local stuck
    stuck=$(docker ps -a --filter "status=created" --format "{{.Names}}" \
        | grep -E "^docker-(api|worker|beat|frontend|nginx)-1$" || true)
    if [[ -n "$stuck" ]]; then
        warn "Containers left in 'created' by an earlier attempt, starting them:"
        for c in $stuck; do
            warn "  $c"
            docker start "$c" >/dev/null 2>&1 || true
        done
    fi
}

# `verify_health` talks to the api, so it passed while nginx was stopped and the site was
# unreachable. This checks the entry point end to end, from wherever the script is running:
# the updater container is on the same docker network (alias `nginx`) and the host reaches it
# on loopback. It reports rather than fails on a deployment whose network layout differs.
verify_entrypoint() {
    # An HTTP 200 from the front door is the only conclusive evidence, so it is tried first and
    # decides on its own. Container state is a tiebreaker for the case where HTTP cannot be
    # reached: stopped is a real failure, anything else (unknown, or a docker the caller cannot
    # query) is reported rather than failed - the script must not call an update broken because
    # it could not ask the question.
    local code="" url
    for url in http://nginx/health http://127.0.0.1/health; do
        if command -v curl >/dev/null 2>&1; then
            code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$url" 2>/dev/null || true)
        elif command -v python3 >/dev/null 2>&1; then
            code=$(python3 - "$url" <<'PYEOF' 2>/dev/null || true
import sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=8) as r:
        print(r.status)
except Exception:
    print("")
PYEOF
)
        fi
        if [[ "$code" == "200" ]]; then
            info "Entry point reachable at $url (200) ✓"
            return 0
        fi
    done

    # Checked by container state, not `dc ps`: compose reads .env for `ps` and this runs in
    # contexts where it cannot (measured: "open /opt/meridian/docker/.env: permission denied"),
    # which made `dc ps nginx` print nothing and look like a stopped container.
    local state
    state=$(docker inspect --format '{{.State.Status}}' docker-nginx-1 2>/dev/null || true)
    if [[ "$state" == "exited" || "$state" == "dead" || "$state" == "created" ]]; then
        error "nginx is $state after the update — the site is unreachable even if the api is healthy"
        return 1
    fi
    warn "Could not confirm the entry point over HTTP (last code: '${code:-none}', nginx state: '${state:-unknown}'). Check it from your network."
    return 0
}

verify_health() {
    ensure_started
    # 120s was too tight. The api runs `alembic upgrade head` before it serves, which on this
    # 8-core box took ~90s on its own, leaving almost no room for the container to be
    # recreated and nginx to come up behind it.
    info "Verifying /health for up to 300s..."
    local timeout=300 interval=5 elapsed=0
    while [[ $elapsed -lt $timeout ]]; do
        if dc exec -T api curl -sf http://localhost:8000/health 2>/dev/null | grep -q '"status":"ok"'; then
            info "API healthy ✓"
            verify_entrypoint
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
# An update recreates the worker, which kills whatever it is running. That is fine for an idle
# deployment and disastrous for a 15-hour analysis: it happened three times - twice to a
# material_master baseline that had already finished its extraction, once while DDIC conformance
# was mid-flight - and each time the run was lost with its version left at 'running'. The
# checkpoint saves the extraction, but hours of work still go.
#
# Refuse to deploy over a live run unless somebody explicitly insists.
assert_no_active_run() {
    if [[ "${MERIDIAN_UPDATE_FORCE:-0}" == "1" ]]; then
        warn "MERIDIAN_UPDATE_FORCE=1 — updating even if a run is active"
        return 0
    fi
    # The worker's own task list is authoritative: a run can only make progress on a worker, so
    # no active task means no run is progressing, whatever the database says. A run killed by a
    # deploy or the OOM killer leaves its version at 'running' forever, and refusing on that row
    # alone would block every future update (it did, immediately: the first update after this
    # guard was added was refused by a version from a run that had died an hour earlier).
    local busy
    busy="$(dc exec -T worker celery -A workers.celery_app inspect active --timeout 10 2>/dev/null \
        | grep -cE "run_extraction|run_checks" || true)"
    busy="${busy//[^0-9]/}"
    if [[ -n "$busy" && "$busy" -gt 0 ]]; then
        error "Refusing to update: the worker is executing a run right now."
        error "Recreating it would kill the run and lose the work."
        error "Wait for it to finish, or re-run with MERIDIAN_UPDATE_FORCE=1 to override."
    fi
    local queued
    queued="$(dc exec -T redis redis-cli LLEN celery 2>/dev/null || echo 0)"
    queued="${queued//[^0-9]/}"
    local stale
    stale="$(dc exec -T db psql -U meridian -d meridian -t -A -c \
        "SELECT count(*) FROM analysis_versions WHERE status IN ('running','pending','queued')" 2>/dev/null || echo 0)"
    stale="${stale//[^0-9]/}"
    if [[ -n "$stale" && "$stale" -gt 0 ]]; then
        warn "$stale analysis row(s) still say running, but no task is executing them."
        warn "That is a stale status from a run that died; the update will proceed."
    fi
    if [[ -n "$queued" && "$queued" -gt 0 ]]; then
        warn "the celery queue holds $queued pending task(s); the worker will pick them up after the restart"
    fi
    info "No analysis or extraction is executing — safe to update."
}

assert_no_active_run

pull_images
sync_deployment_files
reapply_https_nginx
pull_dependencies
rebuild_rfc_overlay

write_status "backing_up" "Backing up the database..."
backup_database
migrate_object_storage

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