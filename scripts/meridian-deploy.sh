#!/usr/bin/env bash
# =============================================================================
# Meridian Platform — Deployment Script v3.0
# scripts/meridian-deploy.sh
#
# Installs Meridian v3.0 on a fresh Linux server. Pulls pre-built images from GHCR.
# Supports HTTP, self-signed HTTPS, and Let's Encrypt HTTPS.
#
# New in v3.0:
#   - Two-lane workers (fast/full)
#   - Airgap deployment mode
#   - meridianctl CLI included
#   - Embedded LLM (Ollama bundled)
#
# Requirements: Docker 24+, curl, python3, openssl
# Run as root:  sudo bash meridian-deploy.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()     { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; exit 1; }
section() { echo -e "\n${BLUE}${BOLD}━━━ $* ━━━${NC}"; }

clear
echo -e "${CYAN}"
cat << 'BANNER'
╔══════════════════════════════════════════════════╗
║                                                  ║
║        MERIDIAN PLATFORM v3.0 INSTALLER          ║
║        SAP Data Quality & MDM Platform            ║
║                                                  ║
║        © 2026 Vantax. All rights reserved.       ║
║                                                  ║
╚══════════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

INSTALL_DIR="/opt/meridian"
GHCR_REGISTRY="ghcr.io"
IMAGE_PREFIX="ghcr.io/vantax-org/meridian"
LICENCE_SERVER_BASE="https://licence.meridian.vantax.co.za"
LICENCE_VALIDATE_URL="${LICENCE_SERVER_BASE}/validate"

# Pre-configured GHCR pull credentials (read:packages only)
GHCR_USER="vantax-org"
GHCR_TOKEN="__GHCR_TOKEN__"

MAX_RETRIES=3
RETRY_DELAY=5
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PRECONFIGURED=false
if [[ -f "${REPO_ROOT}/.env" ]]; then
    PRECONFIGURED=true
fi

ask() {
    local __var=$1 __prompt=$2 __default=${3:-} __secret=${4:-}
    local __val
    if [[ "$__secret" == "secret" ]]; then
        read -rsp "  ${__prompt}${__default:+ [default: ${__default}]}: " __val
        echo
    else
        read -rp  "  ${__prompt}${__default:+ [default: ${__default}]}: " __val
    fi
    printf -v "$__var" '%s' "${__val:-$__default}"
}

section "Pre-flight checks"

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash meridian-deploy.sh"

if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS="${ID:-unknown}"
    log "OS: ${PRETTY_NAME:-$OS}"
else
    OS="unknown"
    warn "Cannot detect OS — proceeding anyway"
fi

# v3.0 requires more RAM for two-lane workers
TOTAL_RAM_GB=$(awk '/MemTotal/{printf "%.0f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 0)
if [[ "$TOTAL_RAM_GB" -lt 16 ]]; then
    warn "RAM: ${TOTAL_RAM_GB}GB — 16GB recommended for v3.0"
else
    log "RAM: ${TOTAL_RAM_GB}GB ✓"
fi

# v3.0 includes more components
FREE_DISK_GB=$(df /opt --output=avail -BG 2>/dev/null | tail -1 | tr -d 'G' || echo 0)
[[ "$FREE_DISK_GB" -lt 50 ]] && \
    error "Insufficient disk: ${FREE_DISK_GB}GB free in /opt, need 50GB minimum"
log "Disk: ${FREE_DISK_GB}GB free ✓"

ARCH=$(uname -m)
[[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" ]] && \
    error "Unsupported architecture: $ARCH (need x86_64 or aarch64)"
log "Architecture: $ARCH ✓"

for tool in curl python3 openssl; do
    command -v "$tool" &>/dev/null || \
        error "$tool not found — install it and re-run"
done
log "Required tools present ✓"

if ! command -v docker &>/dev/null; then
    error "Docker not found — install Docker 24+ and re-run"
fi
DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0")
DOCKER_MAJOR=$(echo "$DOCKER_VERSION" | cut -d. -f1)
DOCKER_MINOR=$(echo "$DOCKER_VERSION" | cut -d. -f2)
if [[ "$DOCKER_MAJOR" -lt 24 || ("$DOCKER_MAJOR" -eq 24 && "$DOCKER_MINOR" -lt 0) ]]; then
    warn "Docker ${DOCKER_VERSION} detected — 24+ recommended"
else
    log "Docker: ${DOCKER_VERSION} ✓"
fi

# v3.0 includes worker compose
for f in \
    "${REPO_ROOT}/docker/docker-compose.customer.yml" \
    "${REPO_ROOT}/docker/docker-compose.customer.ollama.yml" \
    "${REPO_ROOT}/docker/docker-compose.customer.workers.yml" \
    "${REPO_ROOT}/docker/nginx/meridian.conf"; do
    [[ -f "$f" ]] || error "Required file missing: $f"
done
log "Compose and config files found ✓"

# --- Licence ---
if [[ "$PRECONFIGURED" == "true" ]]; then
    section "Licence (pre-configured)"
    LICENCE_MODE=$(grep -oP '^MERIDIAN_LICENCE_MODE=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "online")
    LICENCE_KEY=$(grep -oP '^MERIDIAN_LICENCE_KEY=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "")
    LICENCE_TOKEN=$(grep -oP '^MERIDIAN_LICENCE_TOKEN=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "")
    log "Licence mode: ${LICENCE_MODE}"
else
    section "Licence"
    ask LICENCE_MODE "Licence mode (online / offline / airgap)" "online"
    [[ "$LICENCE_MODE" =~ ^(online|offline|airgap)$ ]] || \
        error "Licence mode must be 'online', 'offline', or 'airgap'"

    if [[ "$LICENCE_MODE" == "online" ]]; then
        ask LICENCE_KEY "Licence key [hidden]" "" secret
        [[ -n "$LICENCE_KEY" ]] || error "Licence key is required for online mode"
        LICENCE_TOKEN=""
    else
        ask LICENCE_TOKEN "Offline JWT token [hidden]" "" secret
        [[ -n "$LICENCE_TOKEN" ]] || error "Offline/airgap token is required"
        LICENCE_KEY=""
    fi
fi

# --- Licence validation ---
if [[ "$PRECONFIGURED" == "true" ]]; then
    _LLM_PROVIDER=$(grep -oP '^LLM_PROVIDER=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "anthropic")
    case "$_LLM_PROVIDER" in
        none|off|"")        TIER="0" ;;
        ollama)             TIER="2" ;;
        ollama_cloud)       TIER="1.5" ;;
        custom)             TIER="3" ;;
        *)                  TIER="1" ;;
    esac
    log "Tier ${TIER} (LLM_PROVIDER=${_LLM_PROVIDER:-none})"

elif [[ "$LICENCE_MODE" == "online" ]]; then
    section "Validating licence"
    if [[ ! "$LICENCE_KEY" =~ ^MRDX-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$ ]]; then
        error "Invalid key format. Expected: MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
    fi
    log "Key format valid: ${LICENCE_KEY:0:9}****-****-****"

    ATTEMPT=0
    while [[ $ATTEMPT -lt $MAX_RETRIES ]]; do
        ATTEMPT=$(( ATTEMPT + 1 ))
        echo -n "  Contacting licence server (attempt ${ATTEMPT}/${MAX_RETRIES})..."

        HTTP_RESPONSE=$(curl -s --max-time 15 --connect-timeout 10 \
            -w "\n%{http_code}" \
            -X POST "$LICENCE_VALIDATE_URL" \
            -H "Content-Type: application/json" \
            -d "{\"licenceKey\":\"${LICENCE_KEY}\",\"machineFingerprint\":\"$(hostname)\"}" \
            2>/dev/null) || {
                echo " ✗"
                [[ $ATTEMPT -lt $MAX_RETRIES ]] && { warn "  Retrying in ${RETRY_DELAY}s..."; sleep "$RETRY_DELAY"; }
                continue
            }

        HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n1)
        if [[ "$HTTP_CODE" == "200" ]]; then
            echo " ✓"
            break
        else
            echo " ✗ (HTTP ${HTTP_CODE})"
            [[ $ATTEMPT -lt $MAX_RETRIES ]] && sleep "$RETRY_DELAY"
        fi
    done

    [[ "$HTTP_CODE" != "200" ]] && error "Licence validation failed. Contact support@vantax.co.za"
    log "Licence validated"

elif [[ "$LICENCE_MODE" == "airgap" ]]; then
    section "Airgap Mode"
    log "Airgap deployment: no external API calls"
    # Airgap defaults to bundled Ollama (Tier 2); operators can override to
    # Tier 0 (LLM-less) by setting LLM_PROVIDER=none in .env before install.
    TIER="${TIER:-2}"
fi

# --- Compose profile selection ---
# Tier 2 (bundled Ollama) → activate the "llm-bundled" compose profile so the
# ollama container starts. All other tiers leave the profile unset so it stays
# stopped (LLM-less deployments save ~4 GB RAM + the model volume).
case "${TIER:-}" in
    2)  export COMPOSE_PROFILES="llm-bundled" ;;
    *)  export COMPOSE_PROFILES="${COMPOSE_PROFILES:-}" ;;
esac
if [[ -n "${COMPOSE_PROFILES:-}" ]]; then
    log "Compose profiles: ${COMPOSE_PROFILES}"
else
    log "Compose profiles: (none) — no bundled LLM container"
fi

# --- Deployment config ---
if [[ "$PRECONFIGURED" == "true" ]]; then
    section "Configuration (pre-configured)"
    SERVER_DOMAIN=$(grep -oP '^SERVER_DOMAIN=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "")
    SSL_MODE=$(grep -oP '^SSL_MODE=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "1")
    WORKER_LANE=$(grep -oP '^WORKER_LANE=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "all")
    log "Server: ${SERVER_DOMAIN}, SSL: ${SSL_MODE}, Lane: ${WORKER_LANE}"
else
    section "Deployment configuration"
    ask SERVER_DOMAIN "Server domain" "meridian.${HOSTNAME:-company.com}"
    ask SSL_MODE "SSL mode (1=none, 2=self-signed, 3=letsencrypt)" "1"
    [[ "$SSL_MODE" =~ ^[123]$ ]] || error "SSL mode must be 1, 2, or 3"

    # v3.0 two-lane workers
    section "Worker Configuration (v3.0)"
    echo "Two-lane architecture:"
    echo "  fast  — low-latency path (checks, extraction, delta)"
    echo "  full  — deep analysis (mining, agents, enrichment)"
    echo "  all   — both lanes (recommended)"
    ask WORKER_LANE "Worker lane (fast / full / all)" "all"
    [[ "$WORKER_LANE" =~ ^(fast|full|all)$ ]] || error "Lane must be fast, full, or all"
    log "Worker lane: ${WORKER_LANE}"
fi

# --- Admin user ---
if [[ "$PRECONFIGURED" == "true" ]]; then
    ADMIN_EMAIL=$(grep -oP '^ADMIN_EMAIL=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "")
    ADMIN_PASSWORD=$(grep -oP '^ADMIN_PASSWORD=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "")
    ADMIN_NAME=$(grep -oP '^ADMIN_NAME=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "Admin")
else
    section "Admin user"
    ask ADMIN_EMAIL "Admin email" "admin@company.com"
    ask ADMIN_NAME "Admin name" "Admin"
    ask ADMIN_PASSWORD "Admin password [hidden]" "" secret
    [[ -n "$ADMIN_PASSWORD" ]] || error "Admin password is required"
fi

# --- SSL ---
configure_ssl_none() { log "SSL: disabled (HTTP only)"; }

configure_ssl_self_signed() {
    section "Self-signed SSL"
    mkdir -p "${INSTALL_DIR}/nginx/certs"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "${INSTALL_DIR}/nginx/certs/privkey.pem" \
        -out "${INSTALL_DIR}/nginx/certs/fullchain.pem" \
        -subj "/CN=${SERVER_DOMAIN}" 2>/dev/null
    log "Self-signed certificate generated"
}

configure_ssl_letsencrypt() {
    section "Let's Encrypt SSL"
    if ! command -v certbot &>/dev/null; then
        apt-get update && apt-get install -y certbot
    fi
    mkdir -p "${INSTALL_DIR}/nginx/certs"
    certbot certonly --standalone -d "${SERVER_DOMAIN}" --agree-tos -m "admin@${SERVER_DOMAIN}" -n
    cp "/etc/letsencrypt/live/${SERVER_DOMAIN}/fullchain.pem" "${INSTALL_DIR}/nginx/certs/fullchain.pem"
    cp "/etc/letsencrypt/live/${SERVER_DOMAIN}/privkey.pem" "${INSTALL_DIR}/nginx/certs/privkey.pem"
    chmod 600 "${INSTALL_DIR}/nginx/certs/privkey.pem"
    log "Let's Encrypt certificate issued"
}

case "$SSL_MODE" in
    1) configure_ssl_none ;;
    2) configure_ssl_self_signed ;;
    3) configure_ssl_letsencrypt ;;
esac

# --- Pull images ---
section "Pulling images from GHCR"
echo "$GHCR_TOKEN" | docker login "$GHCR_REGISTRY" -u "$GHCR_USER" --password-stdin \
    || error "GHCR login failed"
log "Authenticated to ghcr.io"
warn "Pulling images — this may take several minutes"
docker compose -f "${REPO_ROOT}/docker/docker-compose.customer.yml" pull \
    || error "Image pull failed"
log "All images pulled"

# --- Start services ---
section "Starting services"
docker compose -f "${REPO_ROOT}/docker/docker-compose.customer.yml" up -d db redis

echo -n "  Waiting for Postgres"
for i in $(seq 1 30); do
    docker compose -f "${REPO_ROOT}/docker/docker-compose.customer.yml" exec -T db \
        pg_isready -U meridian -q 2>/dev/null && { echo " ✓"; break; }
    [[ $i -eq 30 ]] && { echo ""; error "Postgres failed to start"; }
    echo -n "."; sleep 2
done

section "Running database migrations"
docker compose -f "${REPO_ROOT}/docker/docker-compose.customer.yml" run --rm -T api \
    alembic upgrade head || error "Migration failed"
log "Migrations applied"

# Start full stack
docker compose -f "${REPO_ROOT}/docker/docker-compose.customer.yml" up -d
log "All containers started"

# --- meridianctl CLI ---
section "Setting up meridianctl CLI"
if [[ -f "${REPO_ROOT}/scripts/meridianctl.py" ]]; then
    cp "${REPO_ROOT}/scripts/meridianctl.py" "${INSTALL_DIR}/meridianctl"
    chmod +x "${INSTALL_DIR}/meridianctl"
    log "meridianctl CLI installed"
    ln -sf "${INSTALL_DIR}/meridianctl" /usr/local/bin/meridianctl 2>/dev/null \
        && log "Linked to /usr/local/bin/meridianctl" || true
else
    warn "meridianctl.py not found"
fi

# --- Create admin ---
section "Creating admin user"
docker compose -f "${REPO_ROOT}/docker/docker-compose.customer.yml" exec -T api \
    python scripts/manage_users.py create \
    --email "$ADMIN_EMAIL" --password "$ADMIN_PASSWORD" --name "$ADMIN_NAME" --role admin \
    && log "Admin user created: ${ADMIN_EMAIL}" \
    || warn "Admin creation failed — create manually"

# --- Helper scripts ---
section "Writing helper scripts"

cat > "${INSTALL_DIR}/update.sh" << 'UPDATEEOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/meridian
BASE="-f docker-compose.customer.yml"
[[ -f "docker-compose.customer.ollama.yml" ]] && BASE="$BASE -f docker-compose.customer.ollama.yml"
[[ -f "docker-compose.customer.workers.yml" ]] && BASE="$BASE -f docker-compose.customer.workers.yml"
docker compose $BASE pull
docker compose $BASE run --rm -T api alembic upgrade head
docker compose $BASE up -d --remove-orphans
echo "[✓] Updated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
UPDATEEOF
chmod 755 "${INSTALL_DIR}/update.sh"

cat > "${INSTALL_DIR}/healthcheck.sh" << 'HCEOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/meridian
BASE="-f docker-compose.customer.yml"
[[ -f "docker-compose.customer.ollama.yml" ]] && BASE="$BASE -f docker-compose.customer.ollama.yml"
[[ -f "docker-compose.customer.workers.yml" ]] && BASE="$BASE -f docker-compose.customer.workers.yml"
C="docker compose $BASE"
G='\033[0;32m'; R='\033[0;31m'; NC='\033[0m'
P=0; F=0
chk() { local n=$1; shift; if "$@" >/dev/null 2>&1; then echo -e "  ${G}✓${NC}  $n"; ((P++)); else echo -e "  ${R}✗${NC}  $n"; ((F++)); fi; }
echo ""; echo "  Service       Status"; echo "  ──────────────────────"
chk nginx    $C exec -T nginx    nginx -t
chk api      $C exec -T api      curl -sf http://localhost:8000/health
chk frontend $C exec -T frontend wget -qO- http://localhost:3000/ >/dev/null
chk postgres $C exec -T db       pg_isready -U meridian
chk redis    $C exec -T redis    redis-cli ping
chk minio    $C exec -T minio    curl -sf http://localhost:9000/minio/health/live
if $C ps --services --status=running 2>/dev/null | grep -qx ollama; then
    chk ollama $C exec -T ollama curl -sf http://localhost:11434/api/tags
fi
chk "worker-fast" $C exec -T worker-fast python -c "import celery; print('ok')" 2>/dev/null || true
chk "worker-full"  $C exec -T worker-full python -c "import celery; print('ok')" 2>/dev/null || true
echo "  ──────────────────────"
echo "  Passed: $P  Failed: $F"
[[ $F -eq 0 ]] && exit 0 || exit 1
HCEOF
chmod 755 "${INSTALL_DIR}/healthcheck.sh"
log "Helper scripts written"

# --- Final output ---
PROTO="http"
[[ "$SSL_MODE" != "1" ]] && PROTO="https"

echo ""
echo -e "${GREEN}${BOLD}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║        Meridian v3.0 is installed and running         ║${NC}"
echo -e "${GREEN}${BOLD}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Dashboard   :  ${BOLD}${PROTO}://${SERVER_DOMAIN}${NC}"
echo -e "  API health  :  ${BOLD}${PROTO}://${SERVER_DOMAIN}/health${NC}"
echo -e "  API docs    :  ${BOLD}${PROTO}://${SERVER_DOMAIN}/docs${NC}"
echo ""
echo "  Install dir  : ${INSTALL_DIR}"
echo "  CLI          : meridianctl (or ${INSTALL_DIR}/meridianctl)"
echo "  Worker lane  : ${WORKER_LANE}"
echo "  Update       : sudo bash ${INSTALL_DIR}/update.sh"
echo "  Health check : sudo bash ${INSTALL_DIR}/healthcheck.sh"
echo ""
warn "Back up ${INSTALL_DIR}/.env — it contains all secrets."
warn "SAP connector is 'mock'. Configure in Settings → SAP Connection."
