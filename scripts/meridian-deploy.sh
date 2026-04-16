#!/usr/bin/env bash
# =============================================================================
# Meridian Platform — Deployment Script
# scripts/meridian-deploy.sh
#
# Installs Meridian on a fresh Linux server. Pulls pre-built images from GHCR.
# Supports HTTP, self-signed HTTPS, and Let's Encrypt HTTPS.
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
╔══════════════════════════════════════════════╗
║                                              ║
║        MERIDIAN PLATFORM INSTALLER           ║
║        SAP Data Quality & MDM Platform       ║
║                                              ║
║        © 2026 Vantax. All rights reserved.   ║
║                                              ║
╚══════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

INSTALL_DIR="/opt/meridian"
GHCR_REGISTRY="ghcr.io"
IMAGE_PREFIX="ghcr.io/vantax-org/meridian"
LICENCE_SERVER_BASE="https://licence.meridian.vantax.co.za"
LICENCE_VALIDATE_URL="${LICENCE_SERVER_BASE}/validate"

# Pre-configured GHCR pull credentials (read:packages only)
# Token is injected by create-customer-package.sh at build time.
GHCR_USER="vantax-org"
GHCR_TOKEN="__GHCR_TOKEN__"

MAX_RETRIES=3
RETRY_DELAY=5
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Detect pre-configured package (created by create-customer-package.sh)
PRECONFIGURED=false
if [[ -f "${REPO_ROOT}/.env" ]]; then
    PRECONFIGURED=true
fi

ask() {
    # ask VARNAME "Prompt text" "default" [secret]
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

# =============================================================================
# Section 1 — Pre-flight checks
# =============================================================================
section "Pre-flight checks"

# Must run as root
[[ $EUID -ne 0 ]] && error "Run as root: sudo bash meridian-deploy.sh"

# OS detection
if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS="${ID:-unknown}"
    log "OS: ${PRETTY_NAME:-$OS}"
else
    OS="unknown"
    warn "Cannot detect OS — proceeding anyway"
fi

# RAM (warn only)
TOTAL_RAM_GB=$(awk '/MemTotal/{printf "%.0f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 0)
if [[ "$TOTAL_RAM_GB" -lt 8 ]]; then
    warn "RAM: ${TOTAL_RAM_GB}GB detected — 8GB minimum recommended"
else
    log "RAM: ${TOTAL_RAM_GB}GB ✓"
fi

# Disk (error if < 20 GB free in /opt)
FREE_DISK_GB=$(df /opt --output=avail -BG 2>/dev/null | tail -1 | tr -d 'G' || echo 0)
[[ "$FREE_DISK_GB" -lt 20 ]] && \
    error "Insufficient disk: ${FREE_DISK_GB}GB free in /opt, need 20GB minimum"
log "Disk: ${FREE_DISK_GB}GB free ✓"

# Architecture
ARCH=$(uname -m)
[[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" ]] && \
    error "Unsupported architecture: $ARCH (need x86_64 or aarch64)"
log "Architecture: $ARCH ✓"

# Required tools
for tool in curl python3 openssl; do
    command -v "$tool" &>/dev/null || \
        error "$tool not found — install it and re-run"
done
log "Required tools present ✓"

# Compose files
for f in \
    "${REPO_ROOT}/docker/docker-compose.customer.yml" \
    "${REPO_ROOT}/docker/docker-compose.customer.ollama.yml" \
    "${REPO_ROOT}/docker/nginx/meridian.conf"; do
    [[ -f "$f" ]] || error "Required file missing: $f
  Ensure you are running this script from inside the Meridian repo."
done
log "Compose and config files found ✓"

# =============================================================================
# Section 2 — Collect licence details
# =============================================================================
if [[ "$PRECONFIGURED" == "true" ]]; then
    section "Licence (pre-configured)"
    # Read licence values from the pre-configured .env
    LICENCE_MODE=$(grep -oP '^MERIDIAN_LICENCE_MODE=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "online")
    LICENCE_KEY=$(grep -oP '^MERIDIAN_LICENCE_KEY=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "")
    LICENCE_TOKEN=$(grep -oP '^MERIDIAN_LICENCE_TOKEN=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "")
    log "Licence mode: ${LICENCE_MODE} (from pre-configured .env)"
else
    section "Licence"

    ask LICENCE_MODE "Licence mode (online / offline)" "online"
    [[ "$LICENCE_MODE" =~ ^(online|offline)$ ]] || \
        error "Licence mode must be 'online' or 'offline'"

    if [[ "$LICENCE_MODE" == "online" ]]; then
        ask LICENCE_KEY "Licence key [hidden]" "" secret
        [[ -n "$LICENCE_KEY" ]] || error "Licence key is required for online mode"
        LICENCE_TOKEN=""
    else
        ask LICENCE_TOKEN "Offline JWT token [hidden]" "" secret
        [[ -n "$LICENCE_TOKEN" ]] || error "Offline token is required for offline mode"
        LICENCE_KEY=""
    fi
fi

# =============================================================================
# Section 3 — Licence validation
# =============================================================================
if [[ "$PRECONFIGURED" == "true" ]]; then
    # Derive tier from LLM_PROVIDER in pre-configured .env
    _LLM_PROVIDER=$(grep -oP '^LLM_PROVIDER=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "anthropic")
    case "$_LLM_PROVIDER" in
        ollama) TIER="2" ;;
        custom) TIER="3" ;;
        *)      TIER="1" ;;
    esac
    log "Tier ${TIER} (detected from pre-configured LLM_PROVIDER=${_LLM_PROVIDER})"

elif [[ "$LICENCE_MODE" == "online" ]]; then

    section "Validating licence"

    # Format check before network round-trip
    if [[ ! "$LICENCE_KEY" =~ ^MRDX-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$ ]]; then
        error "Invalid key format.
  Expected : MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX  (uppercase hex)
  Got      : ${LICENCE_KEY}"
    fi
    log "Key format valid: ${LICENCE_KEY:0:9}****-****-****"

    ATTEMPT=0
    VALIDATED=false
    VALIDATION_ERROR=""

    while [[ $ATTEMPT -lt $MAX_RETRIES ]]; do
        ATTEMPT=$(( ATTEMPT + 1 ))
        echo -n "  Contacting licence server (attempt ${ATTEMPT}/${MAX_RETRIES})..."

        HTTP_RESPONSE=$(curl -s \
            --max-time 15 \
            --connect-timeout 10 \
            -w "\n%{http_code}" \
            -X POST "$LICENCE_VALIDATE_URL" \
            -H "Content-Type: application/json" \
            -d "{\"licenceKey\":\"${LICENCE_KEY}\",\"machineFingerprint\":\"$(hostname)\"}" \
            2>/dev/null) || {
                VALIDATION_ERROR="Cannot reach licence server — check outbound HTTPS to licence.meridian.vantax.co.za:443"
                echo " ✗"
                if [[ $ATTEMPT -lt $MAX_RETRIES ]]; then
                    warn "  ${VALIDATION_ERROR}"
                    warn "  Retrying in ${RETRY_DELAY}s..."
                    sleep "$RETRY_DELAY"
                fi
                continue
            }

        HTTP_CODE=$(echo "$HTTP_RESPONSE" | tail -n1)
        HTTP_BODY=$(echo "$HTTP_RESPONSE" | head -n -1)

        if [[ "$HTTP_CODE" != "200" ]]; then
            VALIDATION_ERROR=$(echo "$HTTP_BODY" | python3 -c \
                "import sys,json
try: print(json.load(sys.stdin).get('reason','HTTP ${HTTP_CODE}'))
except: print('HTTP ${HTTP_CODE}')" 2>/dev/null || echo "HTTP ${HTTP_CODE}")
            echo " ✗"
            # Key-level errors — no point retrying
            if [[ "$VALIDATION_ERROR" == *"not found"* ]] \
            || [[ "$VALIDATION_ERROR" == *"expired"* ]] \
            || [[ "$VALIDATION_ERROR" == *"suspended"* ]]; then
                echo ""
                error "Licence rejected: ${VALIDATION_ERROR}
  Contact support@vantax.co.za with your licence key."
            fi
            if [[ $ATTEMPT -lt $MAX_RETRIES ]]; then
                warn "  ${VALIDATION_ERROR} — retrying in ${RETRY_DELAY}s..."
                sleep "$RETRY_DELAY"
            fi
            continue
        fi

        # HTTP 200 — verify valid flag
        IS_VALID=$(echo "$HTTP_BODY" | python3 -c \
            "import sys,json
try: print('yes' if json.load(sys.stdin).get('valid')==True else 'no')
except: print('no')" 2>/dev/null || echo "no")

        if [[ "$IS_VALID" != "yes" ]]; then
            VALIDATION_ERROR=$(echo "$HTTP_BODY" | python3 -c \
                "import sys,json
try: print(json.load(sys.stdin).get('reason','not valid'))
except: print('not valid')" 2>/dev/null || echo "not valid")
            echo " ✗"; echo ""
            error "Licence rejected: ${VALIDATION_ERROR}
  Contact support@vantax.co.za with your licence key."
        fi

        echo " ✓"
        # Parse manifest fields
        LICENCE_COMPANY=$(echo "$HTTP_BODY" | python3 -c \
            "import sys,json; d=json.load(sys.stdin); print(d.get('company_name',''))" \
            2>/dev/null || echo "")
        LICENCE_TIER=$(echo "$HTTP_BODY" | python3 -c \
            "import sys,json; d=json.load(sys.stdin); print(str(d.get('tier','1')))" \
            2>/dev/null || echo "1")
        LICENCE_EXPIRY=$(echo "$HTTP_BODY" | python3 -c \
            "import sys,json; d=json.load(sys.stdin); print(d.get('expiry_date','unknown'))" \
            2>/dev/null || echo "unknown")
        LICENCE_MODULES=$(echo "$HTTP_BODY" | python3 -c \
            "import sys,json; d=json.load(sys.stdin); print(', '.join(d.get('enabled_modules',[])))" \
            2>/dev/null || echo "")
        VALIDATED=true
        break
    done

    if [[ "$VALIDATED" != "true" ]]; then
        echo ""
        error "Licence validation failed after ${MAX_RETRIES} attempts.
  Last error : ${VALIDATION_ERROR}
  Ensure port 443 outbound to licence.meridian.vantax.co.za is open.
  Contact support@vantax.co.za if the problem persists."
    fi

    echo ""
    echo -e "  ${GREEN}${BOLD}Licence confirmed ✓${NC}"
    echo "  ─────────────────────────────────"
    [[ -n "$LICENCE_COMPANY" ]] && echo "  Company  : ${LICENCE_COMPANY}"
    echo "  Tier     : ${LICENCE_TIER}"
    echo "  Expires  : ${LICENCE_EXPIRY}"
    [[ -n "$LICENCE_MODULES" ]] && echo "  Modules  : ${LICENCE_MODULES}"
    echo ""
    TIER="${LICENCE_TIER:-1}"

else
    # Offline — JWT structure + expiry pre-check
    section "Validating offline token"

    JWT_PARTS=$(echo "$LICENCE_TOKEN" | tr '.' '\n' | wc -l)
    [[ "$JWT_PARTS" -ne 3 ]] && \
        error "Offline token is not a valid JWT (expected 3 parts, got ${JWT_PARTS})"

    JWT_RESULT=$(echo "$LICENCE_TOKEN" | cut -d'.' -f2 | tr '_-' '/+' | \
        python3 -c "
import sys, base64, json, time, datetime
raw = sys.stdin.read().strip()
raw += '=' * (4 - len(raw) % 4)
try:
    d = json.loads(base64.b64decode(raw).decode('utf-8'))
    exp = d.get('exp', 0)
    if exp and exp < time.time():
        print('EXPIRED')
    else:
        expiry = datetime.datetime.fromtimestamp(exp).strftime('%Y-%m-%d') if exp else 'unknown'
        print(f'OK|{d.get(\"company_name\",\"\")}|{d.get(\"tier\",\"1\")}|{expiry}')
except Exception as e:
    print(f'WARN|{e}')
" 2>/dev/null || echo "WARN|decode failed")

    if [[ "$JWT_RESULT" == "EXPIRED" ]]; then
        error "Offline token has expired. Request a new one from Meridian HQ."
    elif [[ "$JWT_RESULT" == WARN* ]]; then
        warn "Could not decode offline token — full validation at API startup."
        TIER="1"
    else
        IFS='|' read -r _ LICENCE_COMPANY TIER LICENCE_EXPIRY <<< "$JWT_RESULT"
        echo -e "  ${GREEN}${BOLD}Offline token valid ✓${NC}"
        [[ -n "$LICENCE_COMPANY" ]] && echo "  Company  : ${LICENCE_COMPANY}"
        echo "  Tier     : ${TIER}"
        echo "  Expires  : ${LICENCE_EXPIRY:-unknown}"
        echo ""
        log "Full cryptographic verification at API startup."
    fi
fi

# =============================================================================
# Section 4 — Docker installation
# =============================================================================
section "Docker"

install_docker_ubuntu() {
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${OS}/gpg" \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/${OS} \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq \
        docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
}

install_docker_amzn() {
    dnf update -y -q
    dnf install -y -q docker
    local ver
    ver=$(curl -s https://api.github.com/repos/docker/compose/releases/latest \
        | grep '"tag_name"' | cut -d'"' -f4)
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -fsSL \
        "https://github.com/docker/compose/releases/download/${ver}/docker-compose-linux-$(uname -m)" \
        -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
}

install_docker_rhel() {
    dnf install -y -q dnf-plugins-core
    dnf config-manager \
        --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
    dnf install -y -q \
        docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin
}

if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
    log "Docker already installed: $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
else
    warn "Docker not found — installing..."
    case "$OS" in
        ubuntu|debian)                    install_docker_ubuntu ;;
        amzn)                             install_docker_amzn  ;;
        rhel|rocky|almalinux|centos)      install_docker_rhel  ;;
        *)
            warn "Unknown OS '$OS' — attempting Ubuntu method"
            install_docker_ubuntu || \
                error "Auto-install failed. Install Docker manually: https://docs.docker.com/engine/install/"
            ;;
    esac
    systemctl enable --now docker
    [[ -n "${SUDO_USER:-}" ]] && usermod -aG docker "$SUDO_USER"
    log "Docker installed"
fi

# =============================================================================
# Section 5 — Collect remaining configuration
# =============================================================================
if [[ "$PRECONFIGURED" == "true" ]]; then
    section "Configuration (pre-configured)"
    log "Passwords, licence, and LLM settings loaded from package .env"
else
    section "Configuration"
    echo "  Press Enter to accept the shown default."
    echo "  Values marked [hidden] will not echo to the terminal."
    echo ""

    # Generate cryptographically random defaults
    DEFAULT_DB_PASS=$(openssl rand -hex 16)
    DEFAULT_MINIO_PASS=$(openssl rand -hex 16)
    DEFAULT_CRED_KEY=$(openssl rand -hex 32)

    ask DB_PASSWORD           "Postgres password [hidden]"              "$DEFAULT_DB_PASS"   secret
    ask MINIO_PASSWORD        "MinIO password [hidden]"                 "$DEFAULT_MINIO_PASS" secret
    ask CREDENTIAL_MASTER_KEY "SAP credential encryption key [hidden]"  "$DEFAULT_CRED_KEY"  secret

    # LLM provider
    ANTHROPIC_API_KEY=""
    OLLAMA_API_KEY=""
    AZURE_OPENAI_ENDPOINT=""
    AZURE_OPENAI_API_KEY=""
    AZURE_OPENAI_DEPLOYMENT="gpt-4o"
    CUSTOM_LLM_BASE_URL=""
    CUSTOM_LLM_API_KEY=""
    CUSTOM_LLM_MODEL=""

    if [[ "$TIER" == "2" ]]; then
        LLM_PROVIDER="ollama"
        OLLAMA_MODEL="qwen3.5:9b-instruct"
        log "Tier 2: LLM provider set to ollama (qwen3.5:9b-instruct)"
    else
        echo ""
        ask LLM_PROVIDER \
            "LLM provider (ollama_cloud / anthropic / azure_openai / custom)" \
            "ollama_cloud"
        case "$LLM_PROVIDER" in
            anthropic)
                ask ANTHROPIC_API_KEY "Anthropic API key [hidden]" "" secret ;;
            ollama_cloud)
                ask OLLAMA_API_KEY    "Ollama Cloud API key [hidden]" "" secret ;;
            azure_openai)
                ask AZURE_OPENAI_ENDPOINT   "Azure OpenAI endpoint"       ""
                ask AZURE_OPENAI_API_KEY    "Azure OpenAI key [hidden]"   "" secret
                ask AZURE_OPENAI_DEPLOYMENT "Azure deployment name"       "gpt-4o" ;;
            custom)
                ask CUSTOM_LLM_BASE_URL "Custom LLM base URL"        ""
                ask CUSTOM_LLM_API_KEY  "Custom LLM key [hidden]"    "" secret
                ask CUSTOM_LLM_MODEL    "Custom LLM model name"      "" ;;
        esac
        OLLAMA_MODEL="qwen3.5:9b-instruct"
    fi
fi

# Server domain/IP
echo ""
DETECTED_IP=$(hostname -I | awk '{print $1}')
ask SERVER_DOMAIN "Public domain or IP for this server" "$DETECTED_IP"

# SSL mode
echo ""
echo "  SSL options:"
echo "    1) HTTP only  — port 80, no SSL  (private/internal networks)"
echo "    2) Self-signed — ports 80 + 443, browser will warn (internal HTTPS)"
echo "    3) Let's Encrypt — ports 80 + 443, trusted cert (needs public domain + DNS)"
echo ""
ask SSL_MODE "SSL mode (1/2/3)" "1"
[[ "$SSL_MODE" =~ ^[123]$ ]] || error "SSL mode must be 1, 2, or 3"
LETSENCRYPT_EMAIL=""
if [[ "$SSL_MODE" == "3" ]]; then
    ask LETSENCRYPT_EMAIL "Email for Let's Encrypt notifications" ""
    [[ -n "$LETSENCRYPT_EMAIL" ]] || error "Email is required for Let's Encrypt"
fi

# Image version
if [[ "$PRECONFIGURED" != "true" ]]; then
    echo ""
    ask VERSION "Image version to install" "latest"
    MODEL_TAG="qwen3-5-9b-instruct"
else
    # Version is already baked into the compose files by create-customer-package.sh
    VERSION="preconfigured"
    MODEL_TAG="qwen3-5-9b-instruct"
fi

# Admin account
echo ""
section "Admin account"
warn "Create your first admin account."
warn "Credentials are stored in the database only — not written to .env."
ask ADMIN_EMAIL    "Admin email"             "admin@company.com"
ask ADMIN_NAME     "Admin name"              "Meridian Admin"
ask ADMIN_PASSWORD "Admin password [hidden]" "" secret
[[ ${#ADMIN_PASSWORD} -ge 8 ]] || error "Password must be at least 8 characters"

# =============================================================================
# Section 6 — Create install directory and deploy files
# =============================================================================
section "Creating install directory"

mkdir -p "${INSTALL_DIR}"/{nginx/certs,logs,backups}
chmod 700 "${INSTALL_DIR}"

if [[ "$PRECONFIGURED" == "true" ]]; then
    # Pre-configured: compose files already have versions baked in
    cp "${REPO_ROOT}/docker-compose.yml" "${INSTALL_DIR}/docker-compose.yml"
    [[ -f "${REPO_ROOT}/docker-compose.ollama.yml" ]] && \
        cp "${REPO_ROOT}/docker-compose.ollama.yml" "${INSTALL_DIR}/docker-compose.ollama.yml"
else
    # Substitute {{VERSION}} and {{MODEL_TAG}} placeholders in compose files
    sed "s/{{VERSION}}/${VERSION}/g" \
        "${REPO_ROOT}/docker/docker-compose.customer.yml" \
        > "${INSTALL_DIR}/docker-compose.yml"

    sed "s/{{VERSION}}/${VERSION}/g; s/{{MODEL_TAG}}/${MODEL_TAG}/g" \
        "${REPO_ROOT}/docker/docker-compose.customer.ollama.yml" \
        > "${INSTALL_DIR}/docker-compose.ollama.yml"
fi

# Copy the nginx config so it can be inspected/edited on the server
cp "${REPO_ROOT}/docker/nginx/meridian.conf" \
    "${INSTALL_DIR}/nginx/meridian.conf"

log "Files deployed to ${INSTALL_DIR}"

# Set compose command — includes ollama overlay for Tier 2
if [[ "$TIER" == "2" ]]; then
    COMPOSE_CMD="docker compose \
        -f ${INSTALL_DIR}/docker-compose.yml \
        -f ${INSTALL_DIR}/docker-compose.ollama.yml"
else
    COMPOSE_CMD="docker compose -f ${INSTALL_DIR}/docker-compose.yml"
fi

# =============================================================================
# Section 7 — Write .env
# =============================================================================
section "Writing configuration"

if [[ "$PRECONFIGURED" == "true" ]]; then
    # Copy pre-configured .env and patch CORS_ORIGINS with the chosen domain
    cp "${REPO_ROOT}/.env" "${INSTALL_DIR}/.env"
    if grep -q "^MERIDIAN_CORS_ORIGINS=" "${INSTALL_DIR}/.env"; then
        sed -i "s|^MERIDIAN_CORS_ORIGINS=.*|MERIDIAN_CORS_ORIGINS=http://${SERVER_DOMAIN},https://${SERVER_DOMAIN}|" \
            "${INSTALL_DIR}/.env"
    else
        echo "MERIDIAN_CORS_ORIGINS=http://${SERVER_DOMAIN},https://${SERVER_DOMAIN}" \
            >> "${INSTALL_DIR}/.env"
    fi
else
    # CRITICAL: DATABASE_URL must hardcode the password value directly.
    # Docker Compose does NOT resolve ${VAR} references inside .env file values.
    DB_URL_ASYNC="postgresql+asyncpg://meridian:${DB_PASSWORD}@db:5432/meridian"
    DB_URL_SYNC="postgresql://meridian:${DB_PASSWORD}@db:5432/meridian"

    cat > "${INSTALL_DIR}/.env" << EOF
# Meridian Platform — generated by meridian-deploy.sh
# $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# !! Keep this file secret — chmod 600 !!

# Licence
LICENCE_MODE=${LICENCE_MODE}
LICENCE_KEY=${LICENCE_KEY}
LICENCE_TOKEN=${LICENCE_TOKEN}
LICENCE_SERVER_URL=${LICENCE_SERVER_BASE}

# Database — password hardcoded in URL (Compose .env limitation)
DB_PASSWORD=${DB_PASSWORD}
DATABASE_URL=${DB_URL_ASYNC}
DATABASE_URL_SYNC=${DB_URL_SYNC}

# Redis
REDIS_URL=redis://redis:6379/0

# MinIO
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=meridian
MINIO_PASSWORD=${MINIO_PASSWORD}
MINIO_SECRET_KEY=${MINIO_PASSWORD}
MINIO_BUCKET_UPLOADS=meridian-uploads
MINIO_BUCKET_REPORTS=meridian-reports

# LLM
LLM_PROVIDER=${LLM_PROVIDER}
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=${OLLAMA_MODEL}
OLLAMA_API_KEY=${OLLAMA_API_KEY}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ANTHROPIC_MODEL=claude-sonnet-4-6
AZURE_OPENAI_ENDPOINT=${AZURE_OPENAI_ENDPOINT}
AZURE_OPENAI_API_KEY=${AZURE_OPENAI_API_KEY}
AZURE_OPENAI_DEPLOYMENT=${AZURE_OPENAI_DEPLOYMENT}
AZURE_OPENAI_API_VERSION=2024-08-01-preview
CUSTOM_LLM_BASE_URL=${CUSTOM_LLM_BASE_URL}
CUSTOM_LLM_API_KEY=${CUSTOM_LLM_API_KEY}
CUSTOM_LLM_MODEL=${CUSTOM_LLM_MODEL}

# SAP (configure RFC credentials post-install via Settings → SAP Connection)
SAP_CONNECTOR=mock
CREDENTIAL_MASTER_KEY=${CREDENTIAL_MASTER_KEY}

# Auth
AUTH_MODE=local
NEXT_PUBLIC_AUTH_MODE=local

# Network
MERIDIAN_CORS_ORIGINS=http://${SERVER_DOMAIN},https://${SERVER_DOMAIN}

# Observability (configure post-install)
SENTRY_DSN=
EOF
fi

chmod 600 "${INSTALL_DIR}/.env"
log ".env written and locked (chmod 600)"

# =============================================================================
# Section 8 — SSL setup
# =============================================================================
section "SSL configuration"

configure_ssl_none() {
    log "HTTP only — no SSL configured"
    warn "Ensure this server is on a private/internal network."
}

configure_ssl_self_signed() {
    log "Generating self-signed certificate (10-year validity)..."
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "${INSTALL_DIR}/nginx/certs/privkey.pem" \
        -out    "${INSTALL_DIR}/nginx/certs/fullchain.pem" \
        -subj   "/C=ZA/ST=Gauteng/O=Meridian/CN=${SERVER_DOMAIN}" \
        2>/dev/null
    chmod 600 "${INSTALL_DIR}/nginx/certs/privkey.pem"

    # Activate HTTPS block — strip ##HTTPS##  prefix from every matching line
    sed -i 's/^##HTTPS## //' "${INSTALL_DIR}/nginx/meridian.conf"

    # Replace HTTP server block with redirect-only block
    python3 - << 'PYEOF'
import re, pathlib
p = pathlib.Path("/opt/meridian/nginx/meridian.conf")
c = p.read_text()
redirect_block = (
    "server {\n"
    "    listen 80;\n"
    "    server_name _;\n"
    "    return 301 https://$host$request_uri;\n"
    "}\n\n"
)
# Replace the HTTP server block (everything from 'server {' up to the HTTPS marker)
c = re.sub(
    r'^server \{.*?(?=# MERIDIAN_HTTPS_BEGIN)',
    redirect_block,
    c, flags=re.DOTALL | re.MULTILINE
)
p.write_text(c)
PYEOF

    log "Self-signed certificate created"
    warn "Browsers will show a security warning on first visit."
    warn "To suppress it: import ${INSTALL_DIR}/nginx/certs/fullchain.pem"
    warn "into your OS or browser trust store."
}

configure_ssl_letsencrypt() {
    log "Installing Certbot..."
    case "$OS" in
        ubuntu|debian) apt-get install -y -qq certbot ;;
        amzn)          dnf install -y -q certbot || \
                       { dnf install -y -q epel-release && dnf install -y -q certbot; } ;;
        rhel|rocky|almalinux|centos)
                       dnf install -y -q epel-release && dnf install -y -q certbot ;;
        *)             apt-get install -y -qq certbot 2>/dev/null || \
                       dnf install -y -q certbot || \
                       error "Cannot install certbot on OS: $OS. Install manually." ;;
    esac

    log "Requesting Let's Encrypt certificate for ${SERVER_DOMAIN}..."
    certbot certonly \
        --standalone \
        --non-interactive \
        --agree-tos \
        --email   "$LETSENCRYPT_EMAIL" \
        -d        "$SERVER_DOMAIN" \
        || error "Let's Encrypt failed.
  Ensure: port 80 is open publicly, DNS for ${SERVER_DOMAIN} points here,
  and certbot can complete the ACME challenge."

    # Copy certs to nginx certs dir
    cp "/etc/letsencrypt/live/${SERVER_DOMAIN}/fullchain.pem" \
        "${INSTALL_DIR}/nginx/certs/fullchain.pem"
    cp "/etc/letsencrypt/live/${SERVER_DOMAIN}/privkey.pem" \
        "${INSTALL_DIR}/nginx/certs/privkey.pem"
    chmod 600 "${INSTALL_DIR}/nginx/certs/privkey.pem"

    # Activate HTTPS block
    sed -i 's/^##HTTPS## //' "${INSTALL_DIR}/nginx/meridian.conf"

    # Replace HTTP block with redirect
    python3 - << 'PYEOF'
import re, pathlib
p = pathlib.Path("/opt/meridian/nginx/meridian.conf")
c = p.read_text()
redirect_block = (
    "server {\n"
    "    listen 80;\n"
    "    server_name _;\n"
    "    return 301 https://$host$request_uri;\n"
    "}\n\n"
)
c = re.sub(
    r'^server \{.*?(?=# MERIDIAN_HTTPS_BEGIN)',
    redirect_block,
    c, flags=re.DOTALL | re.MULTILINE
)
p.write_text(c)
PYEOF

    # Write auto-renewal cron
    cat > /etc/cron.d/meridian-certbot << CRON
# Meridian Let's Encrypt auto-renewal
0 3 * * * root certbot renew --quiet \\
    --pre-hook  "docker compose -f ${INSTALL_DIR}/docker-compose.yml stop nginx" \\
    --post-hook "cp /etc/letsencrypt/live/${SERVER_DOMAIN}/fullchain.pem ${INSTALL_DIR}/nginx/certs/fullchain.pem && \\
                 cp /etc/letsencrypt/live/${SERVER_DOMAIN}/privkey.pem   ${INSTALL_DIR}/nginx/certs/privkey.pem && \\
                 docker compose -f ${INSTALL_DIR}/docker-compose.yml start nginx"
CRON
    chmod 644 /etc/cron.d/meridian-certbot
    log "Let's Encrypt certificate issued — auto-renewal cron written"
}

case "$SSL_MODE" in
    1) configure_ssl_none ;;
    2) configure_ssl_self_signed ;;
    3) configure_ssl_letsencrypt ;;
esac

# =============================================================================
# Section 9 — GHCR login and image pull
# =============================================================================
section "Pulling images from GHCR"

echo "$GHCR_TOKEN" | docker login "$GHCR_REGISTRY" \
    -u "$GHCR_USER" --password-stdin \
    || error "GHCR login failed. Contact support@vantax.co.za"
log "Authenticated to ghcr.io"

warn "Pulling images — this may take several minutes on first install."
$COMPOSE_CMD pull \
    || error "Image pull failed.
  Check: GHCR credentials, outbound HTTPS to ghcr.io,
  and that images exist at ${IMAGE_PREFIX}-*:${VERSION}"
log "All images pulled"

# =============================================================================
# Section 10 — Start services and migrate
# =============================================================================
section "Starting services"

# Postgres and Redis first
$COMPOSE_CMD up -d db redis

echo -n "  Waiting for Postgres"
for i in $(seq 1 30); do
    $COMPOSE_CMD exec -T db pg_isready -U meridian -q 2>/dev/null \
        && { echo " ✓"; break; }
    [[ $i -eq 30 ]] && { echo ""; error "Postgres failed to start.
  Check: $COMPOSE_CMD logs db"; }
    echo -n "."; sleep 2
done

section "Running database migrations"
$COMPOSE_CMD run --rm -T api alembic upgrade head \
    || error "Migration failed. Check: $COMPOSE_CMD logs api"
log "Migrations applied"

# Start full stack
$COMPOSE_CMD up -d
log "All containers started"

# Wait for API health
echo -n "  Waiting for API"
for i in $(seq 1 40); do
    $COMPOSE_CMD exec -T api curl -sf http://localhost:8000/health \
        > /dev/null 2>&1 && { echo " ✓"; break; }
    [[ $i -eq 40 ]] && { echo ""; error "API failed to become healthy.
  Check: $COMPOSE_CMD logs api"; }
    echo -n "."; sleep 3
done

# Wait for nginx
echo -n "  Waiting for nginx"
for i in $(seq 1 15); do
    curl -sf "http://localhost/health" > /dev/null 2>&1 \
        && { echo " ✓"; break; }
    [[ $i -eq 15 ]] && { echo ""; warn "nginx not responding yet — check: $COMPOSE_CMD logs nginx"; }
    echo -n "."; sleep 2
done

# =============================================================================
# Section 11 — Create admin user
# =============================================================================
section "Creating admin user"

$COMPOSE_CMD exec -T api \
    python scripts/manage_users.py create \
    --email    "$ADMIN_EMAIL" \
    --password "$ADMIN_PASSWORD" \
    --name     "$ADMIN_NAME" \
    --role     admin \
    && log "Admin user created: ${ADMIN_EMAIL}" \
    || {
        warn "Admin creation failed — create manually after install:"
        warn "  $COMPOSE_CMD exec api python scripts/manage_users.py create \\"
        warn "    --email admin@company.com --password YourPass --role admin"
    }

# =============================================================================
# Section 12 — Write helper scripts into install dir
# =============================================================================
section "Writing helper scripts"

cat > "${INSTALL_DIR}/update.sh" << 'UPDATEEOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/meridian
BASE="-f docker-compose.yml"
[[ -f "docker-compose.ollama.yml" ]] && BASE="$BASE -f docker-compose.ollama.yml"
COMPOSE="docker compose $BASE"
echo "[*] Pulling latest images..."
$COMPOSE pull
echo "[*] Running migrations..."
$COMPOSE run --rm -T api alembic upgrade head
echo "[*] Restarting services..."
$COMPOSE up -d --remove-orphans
echo "[✓] Updated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
UPDATEEOF
chmod 755 "${INSTALL_DIR}/update.sh"

cat > "${INSTALL_DIR}/healthcheck.sh" << 'HCEOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/meridian
BASE="-f docker-compose.yml"
[[ -f "docker-compose.ollama.yml" ]] && BASE="$BASE -f docker-compose.ollama.yml"
C="docker compose $BASE"
G='\033[0;32m'; R='\033[0;31m'; NC='\033[0m'
P=0; F=0
chk() { local n=$1; shift
    if "$@" >/dev/null 2>&1; then echo -e "  ${G}✓${NC}  $n"; ((P++))
    else                          echo -e "  ${R}✗${NC}  $n"; ((F++)); fi; }
echo ""; echo "  Service       Status"; echo "  ──────────────────────"
chk nginx    $C exec -T nginx    nginx -t
chk api      $C exec -T api      curl -sf http://localhost:8000/health
chk frontend $C exec -T frontend wget -qO- http://localhost:3000/ >/dev/null
chk postgres $C exec -T db       pg_isready -U meridian
chk redis    $C exec -T redis    redis-cli ping
chk minio    $C exec -T minio    curl -sf http://localhost:9000/minio/health/live
$C ps ollama >/dev/null 2>&1 && chk ollama $C exec -T ollama curl -sf http://localhost:11434/api/tags
echo "  ──────────────────────"
echo "  Passed: $P  Failed: $F"; echo ""
[[ $F -eq 0 ]] && exit 0 || exit 1
HCEOF
chmod 755 "${INSTALL_DIR}/healthcheck.sh"

log "Helper scripts written"

# =============================================================================
# Section 13 — Final output
# =============================================================================
PROTO="http"
[[ "$SSL_MODE" != "1" ]] && PROTO="https"

echo ""
echo -e "${GREEN}${BOLD}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║          Meridian is installed and running             ║${NC}"
echo -e "${GREEN}${BOLD}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Dashboard   :  ${BOLD}${PROTO}://${SERVER_DOMAIN}${NC}"
echo -e "  API health  :  ${BOLD}${PROTO}://${SERVER_DOMAIN}/health${NC}"
echo -e "  API docs    :  ${BOLD}${PROTO}://${SERVER_DOMAIN}/docs${NC}"
echo -e "  MinIO       :  ${BOLD}${PROTO}://${SERVER_DOMAIN}/minio-console/${NC}"
echo ""
echo "  Install dir  : ${INSTALL_DIR}"
echo "  Update       : sudo bash ${INSTALL_DIR}/update.sh"
echo "  Health check : sudo bash ${INSTALL_DIR}/healthcheck.sh"
echo "  View logs    : ${COMPOSE_CMD} logs -f [nginx|api|frontend|db|redis|minio]"
echo "  Add users    : ${COMPOSE_CMD} exec api python scripts/manage_users.py create \\"
echo "                   --email user@co.com --password Pass --role admin"
echo ""
warn "Back up ${INSTALL_DIR}/.env — it contains all secrets."
warn "SAP connector is 'mock'. Configure RFC: Settings → SAP Connection."
warn "AWS Security Group: only ports 22, 80, and 443 should be open."
warn "Do NOT expose 3000, 8000, 5432, 6379, 9000, 9001 to the internet."
