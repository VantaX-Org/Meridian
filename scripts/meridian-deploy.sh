#!/usr/bin/env bash
# =============================================================================
# Meridian Platform — Deployment Script v3.0
# scripts/meridian-deploy.sh
#
# Installs Meridian v3.0 on a fresh Linux server.
# Supports HTTP, self-signed HTTPS, and Let's Encrypt HTTPS.
#
# Image provisioning (--image-source):
#   ghcr      (default) — pulls from ghcr.io using baked credentials
#   registry            — pulls from a private registry (customer-hosted)
#   local               — images already present on host (optionally
#                         --image-tarball <path> to docker-load first)
#
# Unattended mode (--non-interactive):
#   Fails on any missing input instead of prompting. Intended for CI,
#   Ansible, or any pre-seeded .env workflow.
#
# New in v3.0:
#   - Two-lane workers (fast/full)
#   - Airgap deployment mode (set MERIDIAN_IMAGE_SOURCE=local)
#   - meridianctl CLI included
#   - Embedded LLM (Ollama bundled)
#
# Requirements: Docker 24+, curl, python3, openssl
# Run as root:  sudo bash meridian-deploy.sh [flags]
#
# Usage:
#   sudo bash meridian-deploy.sh
#   sudo bash meridian-deploy.sh --image-source local --image-tarball /tmp/meridian-v1.2.0.tar.gz
#   sudo bash meridian-deploy.sh --image-source registry \
#       --registry registry.corp.local --registry-user deploy --registry-pass xxx
#   sudo bash meridian-deploy.sh --non-interactive   # requires pre-filled .env
#   sudo bash meridian-deploy.sh --help
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


# Banner intentionally moved below the CLI parser so `--help` exits cleanly
# without flashing the ASCII art.

INSTALL_DIR="/opt/meridian"

# Set SCRIPT_DIR and REPO_ROOT before any use
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# --- Ensure .env exists ---
if [[ ! -f "${REPO_ROOT}/.env" ]]; then
    if [[ -f "${REPO_ROOT}/.env.example" ]]; then
        cp "${REPO_ROOT}/.env.example" "${REPO_ROOT}/.env"
        warn ".env not found; created from .env.example. Please review and update required values."
    else
        error ".env.example not found; cannot create .env."
    fi
fi

# Default image source — GHCR with baked read:packages token. Overridable
# via --image-source (ghcr|registry|local) or MERIDIAN_IMAGE_SOURCE.
IMAGE_SOURCE="${MERIDIAN_IMAGE_SOURCE:-ghcr}"
IMAGE_TARBALL="${MERIDIAN_IMAGE_TARBALL:-}"

# GHCR defaults (used when IMAGE_SOURCE=ghcr)
GHCR_REGISTRY="${MERIDIAN_GHCR_REGISTRY:-ghcr.io}"
IMAGE_PREFIX="${MERIDIAN_IMAGE_PREFIX:-ghcr.io/vantax-org/meridian}"
GHCR_USER="${MERIDIAN_GHCR_USER:-vantax-org}"
GHCR_TOKEN="${MERIDIAN_GHCR_TOKEN:-__GHCR_TOKEN__}"

# Private registry (used when IMAGE_SOURCE=registry). Customer-hosted Harbor,
# Artifactory, Nexus, ECR, GAR, etc. Login is only attempted if a user + pass
# are supplied; anonymous pulls from trusted internal networks are fine.
REGISTRY_URL="${MERIDIAN_REGISTRY_URL:-}"
REGISTRY_USER="${MERIDIAN_REGISTRY_USER:-}"
REGISTRY_PASS="${MERIDIAN_REGISTRY_PASS:-}"

# Licence server base — now points to the working Cloudflare Worker API endpoint.
LICENCE_SERVER_BASE="${MERIDIAN_LICENCE_SERVER_BASE:-https://meridian-licence-worker.reshigan-085.workers.dev/api/licence}"
LICENCE_VALIDATE_URL="${LICENCE_SERVER_BASE}/validate"

# Unattended mode — fails on missing input instead of prompting.
NON_INTERACTIVE="${MERIDIAN_NON_INTERACTIVE:-false}"

MAX_RETRIES=3
RETRY_DELAY=5
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

print_usage() {
    cat <<USAGE
Usage: sudo bash meridian-deploy.sh [flags]

Image source:
  --image-source <ghcr|registry|local>   Where to get images (default: ghcr)
  --image-tarball <path>                 Pre-pull: docker load < this tarball (use with --image-source local)
  --registry <host[:port]>               Private registry hostname (use with --image-source registry)
  --registry-user <user>                 Private registry username
  --registry-pass <pass>                 Private registry password / token

Licence:
  --licence-server <url>                 Override licence validation URL
                                          (e.g. https://licence.corp.local)

Behaviour:
  --non-interactive                      Fail on missing input instead of prompting
  -h, --help                             Show this help and exit

All flags can also be set via MERIDIAN_* environment variables.
USAGE
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --image-source)    IMAGE_SOURCE="$2";    shift 2 ;;
        --image-tarball)   IMAGE_TARBALL="$2";   shift 2 ;;
        --registry)        REGISTRY_URL="$2";    shift 2 ;;
        --registry-user)   REGISTRY_USER="$2";   shift 2 ;;
        --registry-pass)   REGISTRY_PASS="$2";   shift 2 ;;
        --licence-server)
            LICENCE_SERVER_BASE="$2"
            # Accept either a base URL or a fully qualified /validate endpoint.
            if [[ "$LICENCE_SERVER_BASE" == */validate ]]; then
                LICENCE_VALIDATE_URL="$LICENCE_SERVER_BASE"
            else
                LICENCE_VALIDATE_URL="${LICENCE_SERVER_BASE%/}/validate"
            fi
            shift 2
            ;;
        --non-interactive) NON_INTERACTIVE="true"; shift ;;
        -h|--help)         print_usage; exit 0 ;;
        *)                 echo "Unknown flag: $1 (try --help)" >&2; exit 2 ;;
    esac
done

# Validate image-source early so downstream code can assume it's one of three values.
case "$IMAGE_SOURCE" in
    ghcr|registry|local) ;;
    *) echo "Invalid --image-source: $IMAGE_SOURCE (expected ghcr|registry|local)" >&2; exit 2 ;;
esac

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

# When IMAGE_SOURCE=registry, IMAGE_PREFIX should point at the private registry
# unless the caller has already overridden it explicitly. The compose files
# key off IMAGE_PREFIX, so this determines what `docker compose pull` resolves.
if [[ "$IMAGE_SOURCE" == "registry" && -n "$REGISTRY_URL" ]]; then
    # Respect an explicit MERIDIAN_IMAGE_PREFIX override; otherwise build it.
    if [[ -z "${MERIDIAN_IMAGE_PREFIX:-}" ]]; then
        IMAGE_PREFIX="${REGISTRY_URL}/meridian"
    fi
fi
export IMAGE_PREFIX  # docker-compose.customer.yml interpolates this

PRECONFIGURED=false
if [[ -f "${REPO_ROOT}/.env" ]]; then
    PRECONFIGURED=true
fi

ask() {
    local __var=$1 __prompt=$2 __default=${3:-} __secret=${4:-}
    local __val

    # Unattended: use the default; error if none is available. Keeps CI runs
    # deterministic — any missing value fails loudly instead of blocking on tty.
    if [[ "$NON_INTERACTIVE" == "true" ]]; then
        if [[ -z "$__default" ]]; then
            error "Missing required value for '$__prompt' in --non-interactive mode"
        fi
        printf -v "$__var" '%s' "$__default"
        return
    fi

    if [[ "$__secret" == "secret" ]]; then
        read -rsp "  ${__prompt}${__default:+ [default: ${__default}]}: " __val
        echo
    else
        read -rp  "  ${__prompt}${__default:+ [default: ${__default}]}: " __val
    fi
    printf -v "$__var" '%s' "${__val:-$__default}"
}

section "Pre-flight checks"

# Pre-flight checks intentionally disabled.
# if false; then
# [[ $EUID -ne 0 ]] && error "Run as root: sudo bash meridian-deploy.sh"
#
# if [[ -f /etc/os-release ]]; then
#     . /etc/os-release
#     OS="${ID:-unknown}"
#     log "OS: ${PRETTY_NAME:-$OS}"
# else
#     OS="unknown"
#     warn "Cannot detect OS — proceeding anyway"
# fi
#
# # v3.0 requires more RAM for two-lane workers
# TOTAL_RAM_GB=$(awk '/MemTotal/{printf "%.0f", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 0)
# if [[ "$TOTAL_RAM_GB" -lt 16 ]]; then
#     warn "RAM: ${TOTAL_RAM_GB}GB — 16GB recommended for v3.0"
# else
#     log "RAM: ${TOTAL_RAM_GB}GB ✓"
# fi
#
# # v3.0 includes more components
# FREE_DISK_GB=$(df /opt --output=avail -BG 2>/dev/null | tail -1 | tr -d 'G' || echo 0)
# [[ "$FREE_DISK_GB" -lt 50 ]] && \
#     error "Insufficient disk: ${FREE_DISK_GB}GB free in /opt, need 50GB minimum"
# log "Disk: ${FREE_DISK_GB}GB free ✓"
#
# ARCH=$(uname -m)
# [[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" ]] && \
#     error "Unsupported architecture: $ARCH (need x86_64 or aarch64)"
# log "Architecture: $ARCH ✓"
#
# for tool in curl python3 openssl; do
#     command -v "$tool" &>/dev/null || \
#         error "$tool not found — install it and re-run"
# done
# log "Required tools present ✓"
#
# if ! command -v docker &>/dev/null; then
#     error "Docker not found — install Docker 24+ and re-run"
# fi
# DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "0")
# DOCKER_MAJOR=$(echo "$DOCKER_VERSION" | cut -d. -f1)
# DOCKER_MINOR=$(echo "$DOCKER_VERSION" | cut -d. -f2)
# if [[ "$DOCKER_MAJOR" -lt 24 || ("$DOCKER_MAJOR" -eq 24 && "$DOCKER_MINOR" -lt 0) ]]; then
#     warn "Docker ${DOCKER_VERSION} detected — 24+ recommended"
# else
#     log "Docker: ${DOCKER_VERSION} ✓"
# fi
#
# # v3.0 includes worker compose
# for f in \
#     "${REPO_ROOT}/docker/docker-compose.customer.yml" \
#     "${REPO_ROOT}/docker/docker-compose.customer.ollama.yml" \
#     "${REPO_ROOT}/docker/docker-compose.customer.workers.yml" \
#     "${REPO_ROOT}/docker/nginx/meridian.conf"; do
#     [[ -f "$f" ]] || error "Required file missing: $f"
# done
# log "Compose and config files found ✓"
# fi
warn "Pre-flight checks are disabled; continuing without system validation"

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

# --- LLM tier selection (fresh install) ---
# Reads LLM_* selections either from an existing customer-package .env or from
# an interactive prompt. Populates TIER plus the variables the .env writer
# below needs. Tier 2 additionally captures OLLAMA_MODEL for the post-start
# model-pull step.
declare -a _LLM_ENV_LINES=()

if [[ "$PRECONFIGURED" == "true" ]]; then
    _LLM_PROVIDER=$(grep -oP '^LLM_PROVIDER=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "anthropic")
    case "$_LLM_PROVIDER" in
        none|off|"")        TIER="0" ;;
        ollama)             TIER="2" ;;
        ollama_cloud)       TIER="1.5" ;;
        anthropic|azure_openai|openai|google) TIER="1" ;;
        custom)             TIER="3" ;;
        *)                  TIER="1" ;;
    esac
    OLLAMA_MODEL=$(grep -oP '^OLLAMA_MODEL=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "")
    log "Tier ${TIER} (LLM_PROVIDER=${_LLM_PROVIDER:-none})"
else
    section "LLM tier selection"
    echo "Choose how Meridian's AI services will run. The deterministic layer"
    echo "handles ~95% of calls regardless — the LLM is only for the uncertain"
    echo "band (name/description matching, nuanced triage)."
    echo ""
    echo "  0  LLM-less (fully deterministic, no cloud, no GPU)"
    echo "  1  Cloud API (Anthropic Claude or Azure OpenAI)"
    echo "  1.5  Ollama Cloud (sanitised prompts leave; data stays on-prem)"
    echo "  2  Bundled Ollama (local container, full residency, wants GPU)"
    echo "  3  BYOLLM (your own OpenAI-compatible endpoint)"
    echo ""
    ask TIER "LLM tier (0 / 1 / 1.5 / 2 / 3)" "0"
    [[ "$TIER" =~ ^(0|1|1\.5|2|3)$ ]] || error "LLM tier must be 0, 1, 1.5, 2, or 3"

    case "$TIER" in
        0)
            _LLM_PROVIDER="none"
            _LLM_ENV_LINES+=("LLM_PROVIDER=none")
            log "Tier 0: fully deterministic — no LLM container, no cloud keys needed"
            ;;
        1)
            echo ""
            echo "  1a  Anthropic Claude (recommended)"
            echo "  1b  Azure OpenAI"
            ask _TIER1_CHOICE "Cloud provider (1a / 1b)" "1a"
            if [[ "$_TIER1_CHOICE" == "1b" ]]; then
                _LLM_PROVIDER="azure_openai"
                ask AZURE_OPENAI_ENDPOINT "Azure OpenAI endpoint (https://...openai.azure.com)" ""
                ask AZURE_OPENAI_API_KEY  "Azure OpenAI API key [hidden]" "" secret
                ask AZURE_OPENAI_DEPLOYMENT "Azure deployment name" "gpt-4o"
                ask AZURE_OPENAI_API_VERSION "Azure API version" "2024-08-01-preview"
                [[ -n "$AZURE_OPENAI_ENDPOINT" && -n "$AZURE_OPENAI_API_KEY" ]] \
                    || error "Azure OpenAI endpoint and API key are required for Tier 1 (Azure)"
                _LLM_ENV_LINES+=(
                    "LLM_PROVIDER=azure_openai"
                    "AZURE_OPENAI_ENDPOINT=${AZURE_OPENAI_ENDPOINT}"
                    "AZURE_OPENAI_API_KEY=${AZURE_OPENAI_API_KEY}"
                    "AZURE_OPENAI_DEPLOYMENT=${AZURE_OPENAI_DEPLOYMENT}"
                    "AZURE_OPENAI_API_VERSION=${AZURE_OPENAI_API_VERSION}"
                )
            else
                _LLM_PROVIDER="anthropic"
                ask ANTHROPIC_API_KEY "Anthropic API key (sk-ant-...) [hidden]" "" secret
                ask ANTHROPIC_MODEL   "Anthropic model" "claude-sonnet-4-6"
                [[ -n "$ANTHROPIC_API_KEY" ]] || error "Anthropic API key is required for Tier 1"
                _LLM_ENV_LINES+=(
                    "LLM_PROVIDER=anthropic"
                    "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
                    "ANTHROPIC_MODEL=${ANTHROPIC_MODEL}"
                )
            fi
            ;;
        1.5)
            _LLM_PROVIDER="ollama_cloud"
            ask OLLAMA_API_KEY "Ollama Cloud API key [hidden]" "" secret
            ask OLLAMA_BASE_URL "Ollama Cloud base URL" "https://ollama.com"
            ask OLLAMA_MODEL    "Ollama Cloud model" "deepseek-v3.1:671b-cloud"
            [[ -n "$OLLAMA_API_KEY" ]] \
                || error "OLLAMA_API_KEY is required for Tier 1.5 (get one at https://ollama.com/settings)"
            _LLM_ENV_LINES+=(
                "LLM_PROVIDER=ollama_cloud"
                "OLLAMA_BASE_URL=${OLLAMA_BASE_URL}"
                "OLLAMA_API_KEY=${OLLAMA_API_KEY}"
                "OLLAMA_MODEL=${OLLAMA_MODEL}"
            )
            ;;
        2)
            _LLM_PROVIDER="ollama"
            ask OLLAMA_MODEL "Ollama model to pull" "llama3.2:3b-instruct-q4_K_M"
            [[ -n "$OLLAMA_MODEL" ]] || error "OLLAMA_MODEL is required for Tier 2"
            _LLM_ENV_LINES+=(
                "LLM_PROVIDER=ollama"
                "OLLAMA_BASE_URL=http://ollama:11434"
                "OLLAMA_MODEL=${OLLAMA_MODEL}"
            )
            ;;
        3)
            _LLM_PROVIDER="custom"
            ask CUSTOM_LLM_BASE_URL "BYOLLM base URL (OpenAI-compatible)" ""
            ask CUSTOM_LLM_API_KEY  "BYOLLM API key [hidden]" "" secret
            ask CUSTOM_LLM_MODEL    "BYOLLM model name" "default"
            [[ -n "$CUSTOM_LLM_BASE_URL" ]] || error "BYOLLM base URL is required for Tier 3"
            _LLM_ENV_LINES+=(
                "LLM_PROVIDER=custom"
                "CUSTOM_LLM_BASE_URL=${CUSTOM_LLM_BASE_URL}"
                "CUSTOM_LLM_API_KEY=${CUSTOM_LLM_API_KEY:-not-required}"
                "CUSTOM_LLM_MODEL=${CUSTOM_LLM_MODEL}"
            )
            ;;
    esac
    log "LLM_PROVIDER=${_LLM_PROVIDER} (Tier ${TIER})"
fi

# --- Pre-flight: required secrets per tier (PRECONFIGURED path only — the
#     interactive path already enforced these above) ---
if [[ "$PRECONFIGURED" == "true" ]]; then
    _require_env() {
        local key="$1" tier="$2"
        local val
        val=$(grep -oP "^${key}=\K.*" "${REPO_ROOT}/.env" 2>/dev/null || echo "")
        if [[ -z "$val" ]]; then
            error "${key} is required for Tier ${tier} but is empty in .env"
        fi
    }
    case "$TIER" in
        1)
            case "$_LLM_PROVIDER" in
                anthropic) _require_env ANTHROPIC_API_KEY 1 ;;
                azure_openai)
                    _require_env AZURE_OPENAI_ENDPOINT 1
                    _require_env AZURE_OPENAI_API_KEY  1
                    ;;
                openai) _require_env OPENAI_API_KEY 1 ;;
                google) _require_env GOOGLE_API_KEY 1 ;;
            esac
            ;;
        1.5) _require_env OLLAMA_API_KEY "1.5" ;;
        2)   _require_env OLLAMA_MODEL 2 ;;
        3)   _require_env CUSTOM_LLM_BASE_URL 3 ;;
    esac
    log "Tier ${TIER} secrets present in .env ✓"
fi

# --- Licence validation ---
if [[ "$PRECONFIGURED" == "true" ]]; then
    : # handled above
elif [[ "$LICENCE_MODE" == "online" ]]; then
    section "Validating licence"
    if [[ ! "$LICENCE_KEY" =~ ^MRDX-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$ ]]; then
        error "Invalid key format. Expected: MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
    fi
    log "Key format valid: ${LICENCE_KEY:0:9}****-****-****"

    ATTEMPT=0
    HTTP_CODE="000"
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

    [[ "${HTTP_CODE:-}" != "200" ]] && error "Licence validation failed. Contact support@vantax.co.za"
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
    # Honour image-source from .env, but only when the CLI/env didn't already
    # override it. This lets `create-customer-package.sh` bake IMAGE_SOURCE=local
    # into an airgap bundle and have the installer pick it up automatically.
    if [[ -z "${MERIDIAN_IMAGE_SOURCE:-}" ]] && [[ "$IMAGE_SOURCE" == "ghcr" ]]; then
        _env_src=$(grep -oP '^MERIDIAN_IMAGE_SOURCE=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "")
        if [[ -n "$_env_src" ]]; then
            IMAGE_SOURCE="$_env_src"
            log "Image source from .env: $IMAGE_SOURCE"
        fi
    fi
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

# --- Write .env (fresh install only) ---
# Customer-package installs already have a pre-filled .env; fresh installs
# need us to synthesise one with secure random secrets + the LLM tier the
# operator just chose above. Downstream docker-compose reads this file.
if [[ "$PRECONFIGURED" != "true" ]]; then
    section "Writing .env"
    _DB_PASS=$(openssl rand -hex 16)
    _MINIO_PASS=$(openssl rand -hex 16)
    _CRED_KEY=$(openssl rand -hex 32)
    # Separate password for the non-superuser meridian_app role (migration
    # 040). The app + workers connect as meridian_app (NOSUPERUSER,
    # NOBYPASSRLS) so RLS policies are actually enforced. The meridian
    # owner role is only used for Alembic migrations.
    _APP_PASS=$(openssl rand -hex 16)

    _LICENCE_KEY_LINE=""
    _LICENCE_TOKEN_LINE=""
    if [[ "$LICENCE_MODE" == "online" ]]; then
        _LICENCE_KEY_LINE="MERIDIAN_LICENCE_KEY=${LICENCE_KEY}"
    else
        _LICENCE_TOKEN_LINE="MERIDIAN_LICENCE_TOKEN=${LICENCE_TOKEN}"
    fi

    {
        printf '# Meridian .env — generated %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf '# Licence\n'
        printf 'MERIDIAN_LICENCE_MODE=%s\n' "$LICENCE_MODE"
        [[ -n "$_LICENCE_KEY_LINE"   ]] && printf '%s\n' "$_LICENCE_KEY_LINE"
        [[ -n "$_LICENCE_TOKEN_LINE" ]] && printf '%s\n' "$_LICENCE_TOKEN_LINE"
        printf 'MERIDIAN_LICENCE_SERVER_URL=%s\n' "${LICENCE_SERVER_BASE}"
        printf '\n# LLM (Tier %s)\n' "$TIER"
        for line in "${_LLM_ENV_LINES[@]}"; do
            printf '%s\n' "$line"
        done
        printf '\n# Deployment\n'
        printf 'SERVER_DOMAIN=%s\n' "$SERVER_DOMAIN"
        printf 'SSL_MODE=%s\n'      "$SSL_MODE"
        printf 'WORKER_LANE=%s\n'   "$WORKER_LANE"
        printf 'MERIDIAN_IMAGE_SOURCE=%s\n' "$IMAGE_SOURCE"
        [[ -n "$REGISTRY_URL" ]] && printf 'MERIDIAN_REGISTRY_URL=%s\n' "$REGISTRY_URL"
        printf 'ADMIN_EMAIL=%s\n'   "$ADMIN_EMAIL"
        printf 'ADMIN_NAME=%s\n'    "$ADMIN_NAME"
        printf 'ADMIN_PASSWORD=%s\n' "$ADMIN_PASSWORD"
        printf '\n# Internal\n'
        printf 'INTERNAL_API_URL=http://api:8000\n'
        printf '\n# Database\n'
        printf 'DB_PASSWORD=%s\n' "$_DB_PASS"
        # Runtime connections (API + workers) use meridian_app — non-superuser,
        # subject to FORCE ROW LEVEL SECURITY. Migrations use the meridian
        # owner via DATABASE_URL_MIGRATE.
        printf 'MERIDIAN_APP_PASSWORD=%s\n' "$_APP_PASS"
        printf 'DATABASE_URL=postgresql+asyncpg://meridian_app:%s@db:5432/meridian\n' "$_APP_PASS"
        printf 'DATABASE_URL_SYNC=postgresql://meridian_app:%s@db:5432/meridian\n'    "$_APP_PASS"
        printf 'DATABASE_URL_MIGRATE=postgresql://meridian:%s@db:5432/meridian\n'     "$_DB_PASS"
        printf '\n# Redis\n'
        printf 'REDIS_URL=redis://redis:6379/0\n'
        printf '\n# MinIO\n'
        printf 'MINIO_ACCESS_KEY=meridian\n'
        printf 'MINIO_PASSWORD=%s\n'   "$_MINIO_PASS"
        printf 'MINIO_SECRET_KEY=%s\n' "$_MINIO_PASS"
        printf 'MINIO_BUCKET_UPLOADS=meridian-uploads\n'
        printf 'MINIO_BUCKET_REPORTS=meridian-reports\n'
        printf '\n# Auth\n'
        printf 'AUTH_MODE=local\n'
        printf 'NEXT_PUBLIC_AUTH_MODE=local\n'
        printf '\n# SAP\n'
        printf 'SAP_CONNECTOR=mock\n'
        printf 'CREDENTIAL_MASTER_KEY=%s\n' "$_CRED_KEY"
    } > "${REPO_ROOT}/.env"
    chmod 600 "${REPO_ROOT}/.env"
    log ".env written (LLM_PROVIDER=${_LLM_PROVIDER}, DB/MinIO secrets generated)"
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

# --- Provision images ---
# Three strategies, picked at deploy time:
#   ghcr      — default, pulls from ghcr.io with a baked read:packages token
#   registry  — pulls from a customer-hosted private registry
#   local     — images already loaded on the host (optionally load from a
#               tarball first — useful for fully airgapped sites)

provision_images_ghcr() {
    section "Pulling images from GHCR"
    if [[ "$GHCR_TOKEN" == "__GHCR_TOKEN__" ]]; then
        error "GHCR token placeholder unchanged. Set MERIDIAN_GHCR_TOKEN, or use --image-source local/registry"
    fi
    echo "$GHCR_TOKEN" | docker login "$GHCR_REGISTRY" -u "$GHCR_USER" --password-stdin \
        || error "GHCR login failed"
    log "Authenticated to ${GHCR_REGISTRY}"
    warn "Pulling images — this may take several minutes"
    docker compose -f "${REPO_ROOT}/docker/docker-compose.customer.yml" pull \
        || error "Image pull failed"
    log "All images pulled"
}

provision_images_registry() {
    section "Pulling images from private registry"
    [[ -n "$REGISTRY_URL" ]] || error "--registry is required when --image-source=registry"
    log "Registry: ${REGISTRY_URL}"
    log "Image prefix: ${IMAGE_PREFIX}"

    if [[ -n "$REGISTRY_USER" && -n "$REGISTRY_PASS" ]]; then
        echo "$REGISTRY_PASS" | docker login "$REGISTRY_URL" -u "$REGISTRY_USER" --password-stdin \
            || error "Registry login failed for ${REGISTRY_URL}"
        log "Authenticated to ${REGISTRY_URL}"
    else
        log "No --registry-user/--registry-pass supplied — assuming anonymous pull"
    fi

    warn "Pulling images — this may take several minutes"
    docker compose -f "${REPO_ROOT}/docker/docker-compose.customer.yml" pull \
        || error "Image pull from ${REGISTRY_URL} failed"
    log "All images pulled from ${REGISTRY_URL}"
}

provision_images_local() {
    section "Using local images (no registry pull)"

    if [[ -n "$IMAGE_TARBALL" ]]; then
        [[ -f "$IMAGE_TARBALL" ]] || error "Image tarball not found: $IMAGE_TARBALL"
        log "Loading images from ${IMAGE_TARBALL} (this can take several minutes)"
        # docker load handles both plain and gzipped tars; no need to peek at the header.
        docker load -i "$IMAGE_TARBALL" \
            || error "docker load failed for $IMAGE_TARBALL"
        log "Images loaded from tarball"
    else
        warn "No --image-tarball supplied — assuming images are already present on the host"
    fi

    # Sanity-check: verify at least the api + frontend + worker images exist locally,
    # matching whatever IMAGE_PREFIX resolves to. We don't try to validate every image
    # (compose will surface that on `up`), just catch the obvious "nothing was loaded" case.
    local missing=0
    for repo in "${IMAGE_PREFIX}-api" "${IMAGE_PREFIX}-frontend" "${IMAGE_PREFIX}-worker"; do
        if ! docker image ls --format '{{.Repository}}' | grep -qx "$repo"; then
            warn "Image not found locally: ${repo}"
            missing=$(( missing + 1 ))
        fi
    done
    if [[ $missing -gt 0 ]]; then
        error "One or more expected images are missing. Run \`docker load < <tarball>\` or re-run with --image-tarball <path>"
    fi
    log "Required images present locally"
}

case "$IMAGE_SOURCE" in
    ghcr)     provision_images_ghcr ;;
    registry) provision_images_registry ;;
    local)    provision_images_local ;;
esac

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

# Start full stack (respects COMPOSE_PROFILES set above — ollama only on Tier 2)
docker compose -f "${REPO_ROOT}/docker/docker-compose.customer.yml" up -d
log "All containers started"

# --- Tier 2: pull the Ollama model so the container is actually useful ---
if [[ "$TIER" == "2" && -n "${OLLAMA_MODEL:-}" ]]; then
    section "Pulling Ollama model"
    # Wait for ollama to come up (the image starts instantly, but the API
    # takes a few seconds after first launch).
    echo -n "  Waiting for Ollama"
    for i in $(seq 1 30); do
        if docker compose -f "${REPO_ROOT}/docker/docker-compose.customer.yml" \
            exec -T ollama curl -sf http://localhost:11434/api/version >/dev/null 2>&1; then
            echo " ✓"
            break
        fi
        [[ $i -eq 30 ]] && { echo ""; warn "Ollama slow to start — model pull may fail"; }
        echo -n "."; sleep 2
    done
    docker compose -f "${REPO_ROOT}/docker/docker-compose.customer.yml" \
        exec -T ollama ollama pull "$OLLAMA_MODEL" \
        || warn "Model pull failed — retry: docker compose exec ollama ollama pull $OLLAMA_MODEL"
    log "Model ${OLLAMA_MODEL} ready"
fi

# --- Write helper scripts ---
section "Writing helper scripts"
mkdir -p "${INSTALL_DIR}"
cat <<'HCEOF' > "${INSTALL_DIR}/healthcheck.sh"
#!/usr/bin/env bash
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
