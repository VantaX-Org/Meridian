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
set -uo pipefail

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

INSTALL_DIR="/opt/meridian"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default image source
IMAGE_SOURCE="${MERIDIAN_IMAGE_SOURCE:-ghcr}"
IMAGE_TARBALL="${MERIDIAN_IMAGE_TARBALL:-}"

# GHCR defaults
GHCR_REGISTRY="${MERIDIAN_GHCR_REGISTRY:-ghcr.io}"
IMAGE_PREFIX="${MERIDIAN_IMAGE_PREFIX:-ghcr.io/vantax-org/meridian}"
GHCR_USER="${MERIDIAN_GHCR_USER:-vantax-org}"
GHCR_TOKEN="${MERIDIAN_GHCR_TOKEN:-}"

# Private registry
REGISTRY_URL="${MERIDIAN_REGISTRY_URL:-}"
REGISTRY_USER="${MERIDIAN_REGISTRY_USER:-}"
REGISTRY_PASS="${MERIDIAN_REGISTRY_PASS:-}"

# Licence server — production endpoint. Override with --licence-server or
# MERIDIAN_LICENCE_SERVER_BASE for a customer-hosted/self-hosted licence worker.
# NB: do NOT point this at a *.workers.dev dev subdomain — those get torn down
# and a 404 there trips the 2h degradation cutoff, 403-ing the whole API.
LICENCE_SERVER_BASE="${MERIDIAN_LICENCE_SERVER_BASE:-https://licence.meridian.vantax.co.za/api/licence}"
LICENCE_VALIDATE_URL="${LICENCE_SERVER_BASE}/validate"

# Unattended mode
NON_INTERACTIVE="${MERIDIAN_NON_INTERACTIVE:-false}"

MAX_RETRIES=3
RETRY_DELAY=5

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

# =============================================================================
# ask() — must be defined before any call site
# =============================================================================
ask() {
    local __var=$1 __prompt=$2 __default=${3:-} __secret=${4:-}
    local __val

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

# =============================================================================
# Ensure .env exists BEFORE checking PRECONFIGURED
# =============================================================================
if [[ ! -f "${REPO_ROOT}/.env" ]]; then
    if [[ -f "${REPO_ROOT}/.env.example" ]]; then
        cp "${REPO_ROOT}/.env.example" "${REPO_ROOT}/.env"
        warn ".env not found; created from .env.example. Please review and update required values."
    else
        error ".env.example not found; cannot create .env."
    fi
fi

# Now safe to check — .env is guaranteed to exist if we get here
PRECONFIGURED=false
if [[ -f "${REPO_ROOT}/.env" ]]; then
    # Only treat it as pre-configured if it has real content (not just the example)
    if grep -qE '^(DATABASE_URL|DB_PASSWORD)=.+' "${REPO_ROOT}/.env" 2>/dev/null; then
        PRECONFIGURED=true
    fi
fi

# =============================================================================
# GHCR token — load from .env if present, but don't require it upfront.
# Public packages need no token; we only prompt if an authenticated pull
# is actually needed (handled inside provision_images_ghcr).
# =============================================================================
if [[ "$IMAGE_SOURCE" == "ghcr" && -z "$GHCR_TOKEN" ]]; then
    _env_token=$(grep -oP '^MERIDIAN_GHCR_TOKEN=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "")
    if [[ -n "$_env_token" && "$_env_token" != "__GHCR_TOKEN__" ]]; then
        GHCR_TOKEN="$_env_token"
        log "GHCR token loaded from .env (will use if packages require auth)"
    fi
fi

if [[ "$IMAGE_SOURCE" == "registry" && -n "$REGISTRY_URL" ]]; then
    if [[ -z "${MERIDIAN_IMAGE_PREFIX:-}" ]]; then
        IMAGE_PREFIX="${REGISTRY_URL}/meridian"
    fi
fi
export IMAGE_PREFIX

# =============================================================================
# Licence
# =============================================================================
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

# =============================================================================
# LLM tier selection
# =============================================================================
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
    echo "  0    LLM-less (fully deterministic, no cloud, no GPU)"
    echo "  1    Cloud API (Anthropic Claude or Azure OpenAI)"
    echo "  1.5  Ollama Cloud (sanitised prompts leave; data stays on-prem)"
    echo "  2    Bundled Ollama (local container, full residency, wants GPU)"
    echo "  3    BYOLLM (your own OpenAI-compatible endpoint)"
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
            # Default matches the only per-model image confirmed published at
            # ghcr.io/vantax-org/meridian-ollama — llama3.2:3b-instruct-q4_K_M
            # (this prompt's old default) has no matching image tag, so
            # accepting it silently fails at `docker compose pull`.
            ask OLLAMA_MODEL "Ollama model to pull" "qwen3.5:9b-instruct"
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

# =============================================================================
# Pre-flight: required secrets per tier (PRECONFIGURED path only)
# =============================================================================
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

# =============================================================================
# Licence validation
# =============================================================================
if [[ "$PRECONFIGURED" == "true" ]]; then
    : # already handled above
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
    TIER="${TIER:-2}"
fi

# =============================================================================
# Compose file selection — merge in the Ollama overlay for Tier 2
# =============================================================================
# docker-compose.customer.ollama.yml defines the `ollama` service; it is NOT
# part of docker-compose.customer.yml, so every `docker compose` call below
# uses this array instead of a bare -f path, or Tier 2 would silently never
# start (or pull) the bundled LLM container at all.
COMPOSE_FILES=(-f "${REPO_ROOT}/docker/docker-compose.customer.yml")
case "${TIER:-}" in
    2)  export COMPOSE_PROFILES="llm-bundled"
        # The overlay ships with an unresolved {{MODEL_TAG}} image-tag
        # placeholder — create-customer-package.sh normally substitutes it at
        # package-build time. meridian-deploy.sh can also run standalone
        # (e.g. via the install-worker one-liner), so resolve it here too,
        # using the same ":"/"." -> "-" transform the packager uses, and add
        # the RESOLVED copy (never the template) to COMPOSE_FILES.
        _OLLAMA_OVERLAY="${REPO_ROOT}/docker/docker-compose.customer.ollama.yml"
        if [[ -f "$_OLLAMA_OVERLAY" ]]; then
            _OLLAMA_MODEL_TAG=$(echo "${OLLAMA_MODEL:-qwen3.5:9b-instruct}" | tr ':' '-' | tr '.' '-')
            _OLLAMA_OVERLAY_RESOLVED="${REPO_ROOT}/docker/docker-compose.customer.ollama.resolved.yml"
            sed "s|{{MODEL_TAG}}|${_OLLAMA_MODEL_TAG}|g" "$_OLLAMA_OVERLAY" > "$_OLLAMA_OVERLAY_RESOLVED"
            COMPOSE_FILES+=(-f "$_OLLAMA_OVERLAY_RESOLVED")
        else
            warn "Tier 2 selected but docker-compose.customer.ollama.yml is missing — the bundled Ollama container will not start."
        fi
        ;;
    *)  export COMPOSE_PROFILES="${COMPOSE_PROFILES:-}" ;;
esac
if [[ -n "${COMPOSE_PROFILES:-}" ]]; then
    log "Compose profiles: ${COMPOSE_PROFILES}"
else
    log "Compose profiles: (none) — no bundled LLM container"
fi

# =============================================================================
# Deployment config
# =============================================================================
if [[ "$PRECONFIGURED" == "true" ]]; then
    section "Configuration (pre-configured)"
    SERVER_DOMAIN=$(grep -oP '^SERVER_DOMAIN=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "localhost")
    SSL_MODE=$(grep -oP '^SSL_MODE=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "1")
    WORKER_LANE=$(grep -oP '^WORKER_LANE=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "all")
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

    section "Worker Configuration (v3.0)"
    echo "Two-lane architecture:"
    echo "  fast  — low-latency path (checks, extraction, delta)"
    echo "  full  — deep analysis (mining, agents, enrichment)"
    echo "  all   — both lanes (recommended)"
    ask WORKER_LANE "Worker lane (fast / full / all)" "all"
    [[ "$WORKER_LANE" =~ ^(fast|full|all)$ ]] || error "Lane must be fast, full, or all"
    log "Worker lane: ${WORKER_LANE}"
fi

# =============================================================================
# Admin user
# =============================================================================
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

# =============================================================================
# Write .env (fresh install only)
# =============================================================================
if [[ "$PRECONFIGURED" != "true" ]]; then
    section "Writing .env"
    _DB_PASS=$(openssl rand -hex 16)
    _MINIO_PASS=$(openssl rand -hex 16)
    _CRED_KEY=$(openssl rand -hex 32)
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
        printf 'ADMIN_EMAIL=%s\n'    "$ADMIN_EMAIL"
        printf 'ADMIN_NAME=%s\n'     "$ADMIN_NAME"
        printf 'ADMIN_PASSWORD=%s\n' "$ADMIN_PASSWORD"
        printf '\n# Internal\n'
        printf 'INTERNAL_API_URL=http://api:8000\n'
        printf '\n# Database\n'
        printf 'DB_PASSWORD=%s\n' "$_DB_PASS"
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

# =============================================================================
# FIX: Ensure DATABASE_URL_MIGRATE is set for pre-configured envs that only
# have DATABASE_URL. Alembic must use the owner role (meridian), not
# meridian_app (which is NOSUPERUSER and NOBYPASSRLS). Without this,
# migrations silently run against the wrong URL or fail auth entirely.
# =============================================================================
_migrate_url=$(grep -oP '^DATABASE_URL_MIGRATE=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "")
if [[ -z "$_migrate_url" ]]; then
    warn "DATABASE_URL_MIGRATE not found in .env — deriving from DATABASE_URL"
    # Swap asyncpg driver and meridian_app user for plain psycopg2 + meridian owner
    _base_url=$(grep -oP '^DATABASE_URL=\K.*' "${REPO_ROOT}/.env" 2>/dev/null || echo "")
    if [[ -z "$_base_url" ]]; then
        error "Neither DATABASE_URL nor DATABASE_URL_MIGRATE found in .env"
    fi
    # Strip asyncpg driver variant and replace user
    _migrate_url=$(echo "$_base_url" \
        | sed 's|postgresql+asyncpg://|postgresql://|' \
        | sed 's|//[^:]*:|//meridian:|')
    echo "DATABASE_URL_MIGRATE=${_migrate_url}" >> "${REPO_ROOT}/.env"
    log "DATABASE_URL_MIGRATE written to .env: ${_migrate_url}"
fi

# Copy the env file to the docker/ subdirectory so compose picks it up
# regardless of which directory docker-compose.customer.yml lives in.
_compose_dir="$(dirname "${REPO_ROOT}/docker/docker-compose.customer.yml")"
if [[ "$_compose_dir" != "$REPO_ROOT" ]]; then
    cp "${REPO_ROOT}/.env" "${_compose_dir}/.env"
    log ".env copied to ${_compose_dir}/.env"
fi

# =============================================================================
# SSL
# =============================================================================
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

# =============================================================================
# Provision images
# =============================================================================
provision_images_ghcr() {
    section "Pulling images from GHCR"
    # Authenticate with the baked/env token so a packaged deployment can pull
    # private images without the operator ever running `docker login` or
    # supplying a token themselves. No token → anonymous pull (public images
    # only). GHCR_TOKEN is populated from the environment or the .env
    # (MERIDIAN_GHCR_TOKEN) earlier in this script.
    if [[ -n "$GHCR_TOKEN" ]]; then
        if echo "$GHCR_TOKEN" | docker login "$GHCR_REGISTRY" -u "$GHCR_USER" --password-stdin >/dev/null 2>&1; then
            log "Authenticated to ${GHCR_REGISTRY} as ${GHCR_USER}"
        else
            warn "GHCR login failed — falling back to anonymous pull (works only for public images)"
        fi
    else
        warn "No GHCR token present — attempting anonymous pull (private images will be denied)"
    fi

    # Tier 2 pulls a per-model Ollama image from a separate, fixed repository
    # (ghcr.io/vantax-org/meridian-ollama) that only has pre-built tags for
    # specific models — not every OLLAMA_MODEL a customer might set actually
    # has one. Without this check, a bad model name only surfaces after
    # minutes of pulling everything else, as a "not found" on the very last
    # image. Check it up front so that fails immediately and actionably.
    if [[ "${TIER:-}" == "2" && -n "${_OLLAMA_MODEL_TAG:-}" ]]; then
        _OLLAMA_IMAGE="${IMAGE_PREFIX}-ollama:${_OLLAMA_MODEL_TAG}"
        echo -n "  Checking Ollama model image exists: ${_OLLAMA_IMAGE} ..."
        if docker manifest inspect "$_OLLAMA_IMAGE" >/dev/null 2>&1; then
            echo " ✓"
        else
            echo " ✗"
            error "Ollama model image not found: ${_OLLAMA_IMAGE}
  OLLAMA_MODEL='${OLLAMA_MODEL:-}' has no matching pre-built image (or GHCR auth failed — check the login result above).
  Known-good model: qwen3.5:9b-instruct
  Fix: set OLLAMA_MODEL=qwen3.5:9b-instruct in .env and re-run,
  or contact support@vantax.co.za to request a pre-built image for this model."
        fi
    fi

    warn "Pulling images — this may take several minutes"
    if docker compose "${COMPOSE_FILES[@]}" pull; then
        log "All images pulled"
    else
        error "Image pull failed. For private images, ensure the deployment package embeds a valid GHCR token (MERIDIAN_GHCR_TOKEN)."
    fi
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
    docker compose "${COMPOSE_FILES[@]}" pull \
        || error "Image pull from ${REGISTRY_URL} failed"
    log "All images pulled from ${REGISTRY_URL}"
}

provision_images_local() {
    section "Using local images (no registry pull)"

    if [[ -n "$IMAGE_TARBALL" ]]; then
        [[ -f "$IMAGE_TARBALL" ]] || error "Image tarball not found: $IMAGE_TARBALL"
        log "Loading images from ${IMAGE_TARBALL} (this can take several minutes)"
        docker load -i "$IMAGE_TARBALL" \
            || error "docker load failed for $IMAGE_TARBALL"
        log "Images loaded from tarball"
    else
        warn "No --image-tarball supplied — assuming images are already present on the host"
    fi

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

# =============================================================================
# Start services & run migrations
# =============================================================================
section "Starting database and Redis"
docker compose "${COMPOSE_FILES[@]}" up -d db redis \
    || error "Failed to start db/redis"

echo -n "  Waiting for Postgres"
for i in $(seq 1 30); do
    docker compose "${COMPOSE_FILES[@]}" exec -T db \
        pg_isready -U meridian -q 2>/dev/null && { echo " ✓"; break; }
    [[ $i -eq 30 ]] && { echo ""; error "Postgres failed to start after 60 seconds"; }
    echo -n "."; sleep 2
done

section "Running database migrations"
# FIX: use `exec` against the running api container, not `run --rm` which
# spins up a throwaway container that may have a different env and won't
# share the same Docker network aliases reliably on first boot.
# We bring the api up first (without the full stack) just to run migrations.
docker compose "${COMPOSE_FILES[@]}" up -d api \
    || error "Failed to start api container for migrations"

echo -n "  Waiting for api container to be healthy"
for i in $(seq 1 30); do
    _status=$(docker compose "${COMPOSE_FILES[@]}" \
        ps api --format json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health',''))" 2>/dev/null || echo "")
    if [[ "$_status" == "healthy" || "$_status" == "" ]]; then
        # If no healthcheck defined, just check it's running
        _running=$(docker compose "${COMPOSE_FILES[@]}" \
            ps api --format json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('State',''))" 2>/dev/null || echo "")
        [[ "$_running" == "running" ]] && { echo " ✓"; break; }
    fi
    [[ "$_status" == "healthy" ]] && { echo " ✓"; break; }
    [[ $i -eq 30 ]] && { echo ""; warn "API container slow to start — attempting migrations anyway"; break; }
    echo -n "."; sleep 2
done

docker compose "${COMPOSE_FILES[@]}" exec -T api \
    bash -c "cd /app && alembic upgrade head" \
    || error "Migration failed — check logs: docker compose logs api"
log "Migrations applied"

# Verify tables were actually created
_table_count=$(docker compose "${COMPOSE_FILES[@]}" \
    exec -T db psql -U meridian -d meridian -tAc \
    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo "0")
if [[ "${_table_count:-0}" -lt 1 ]]; then
    error "Migrations reported success but no tables found — check DATABASE_URL_MIGRATE in .env"
fi
log "Database verified: ${_table_count} tables created ✓"

# =============================================================================
# Create the admin user
# =============================================================================
# The API's dev-tenant auto-seed (api/main.py lifespan) runs on container start,
# which happens BEFORE migrations create the users/tenants tables — so it fails
# silently, and since `up -d` never recreates an already-running api container,
# it's never retried. Without this step no admin account is ever created —
# ADMIN_EMAIL/ADMIN_PASSWORD would sit unused in .env and nothing could log in.
section "Creating admin user"
if docker compose "${COMPOSE_FILES[@]}" exec -T api \
    python scripts/manage_users.py create \
    --email "$ADMIN_EMAIL" --name "$ADMIN_NAME" --password "$ADMIN_PASSWORD" --role admin; then
    log "Admin user created: ${ADMIN_EMAIL}"
else
    warn "Admin user creation failed (already exists, or a DB error — see output above)."
    warn "Create it manually with:"
    warn "  docker compose -f ${REPO_ROOT}/docker/docker-compose.customer.yml exec api \\"
    warn "    python scripts/manage_users.py create --email <email> --password <password> --role admin"
fi

# Start the full stack
section "Starting full stack"
docker compose "${COMPOSE_FILES[@]}" up -d \
    || error "Failed to bring up full stack"
log "All containers started"

# =============================================================================
# Tier 2: ensure the Ollama model is present
# =============================================================================
# The per-model image (ghcr.io/vantax-org/meridian-ollama:<tag>) bakes the
# model in at build time (see docker/Dockerfile.ollama) — but the ollama_data
# volume mounts over that same path (/root/.ollama), and Docker only seeds a
# brand-new volume from the image once. A volume left over from an earlier
# install or a different model choice shadows the freshly-pulled image, so
# the expected model can be silently missing even though the right image
# was pulled. `ollama pull` here is a no-op if the model is already present,
# and a real fix otherwise — this previously only waited for the server to
# respond and never checked the model was actually there at all.
if [[ "${TIER:-}" == "2" && -n "${OLLAMA_MODEL:-}" ]]; then
    section "Verifying Ollama model"
    echo -n "  Waiting for Ollama"
    _OLLAMA_READY=false
    for i in $(seq 1 30); do
        if docker compose "${COMPOSE_FILES[@]}" \
            exec -T ollama curl -sf http://localhost:11434/api/version >/dev/null 2>&1; then
            echo " ✓"
            _OLLAMA_READY=true
            break
        fi
        [[ $i -eq 30 ]] && { echo ""; warn "Ollama slow to start — model check may fail"; }
        echo -n "."; sleep 2
    done

    if [[ "$_OLLAMA_READY" == "true" ]]; then
        echo "  Pulling ${OLLAMA_MODEL} (no-op if already present)..."
        if docker compose "${COMPOSE_FILES[@]}" exec -T ollama ollama pull "${OLLAMA_MODEL}"; then
            log "Model ready: ${OLLAMA_MODEL}"
        else
            warn "Could not pull ${OLLAMA_MODEL} — check manually: docker compose exec ollama ollama list"
        fi
    fi
fi

# =============================================================================
# Write helper scripts
# =============================================================================
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

# =============================================================================
# Final output
# =============================================================================
PROTO="http"
[[ "$SSL_MODE" != "1" ]] && PROTO="https"

echo ""
echo -e "${GREEN}${BOLD}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║        Meridian v3.0 is installed and running         ║${NC}"
echo -e "${GREEN}${BOLD}╚════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Dashboard   :  ${BOLD}${PROTO}://${SERVER_DOMAIN:-localhost}${NC}"
echo -e "  API health  :  ${BOLD}${PROTO}://${SERVER_DOMAIN:-localhost}/health${NC}"
echo -e "  API docs    :  ${BOLD}${PROTO}://${SERVER_DOMAIN:-localhost}/docs${NC}"
echo ""
echo "  Install dir  : ${INSTALL_DIR}"
echo "  Worker lane  : ${WORKER_LANE:-all}"
echo "  Update       : sudo bash ${INSTALL_DIR}/update.sh"
echo "  Health check : sudo bash ${INSTALL_DIR}/healthcheck.sh"
echo ""
warn "Back up ${REPO_ROOT}/.env — it contains all secrets."
warn "SAP connector is 'mock'. Configure in Settings → SAP Connection."