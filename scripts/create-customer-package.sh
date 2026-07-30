#!/usr/bin/env bash
# =========================================================
# Meridian — Create Customer Deployment Package
#
# Generates a ready-to-ship tarball with pre-configured .env,
# compose files, installer script, and documentation.
#
# Output: meridian-deployment-<customer>-<version>.tar.gz
#
# Requires: GHCR_READ_TOKEN env var (read:packages PAT)
#
# Usage:
#   GHCR_READ_TOKEN=ghp_xxx ./scripts/create-customer-package.sh \
#     --customer acme-corp \
#     --licence-key MRDX-XXXX-XXXX-XXXX \
#     --version v1.2.0 \
#     --tier 2
#
# Full options:
#   --tier <0|1|1.5|2|3>      LLM tier (default: 1)
#                             0   = LLM-less (fully deterministic)
#                             1   = Cloud API (Anthropic / Azure OpenAI)
#                             1.5 = Ollama Cloud (sanitised prompts leave)
#                             2   = Bundled Ollama (full residency)
#                             3   = BYOLLM (OpenAI-compatible endpoint)
#   --customer <name>         Customer slug (required)
#   --licence-key <key>       Meridian licence key (required unless --offline)
#   --version <tag>           Image version tag (default: latest)
#   --model <ollama-model>    Local Ollama model for Tier 2 (default: qwen3.5:9b-instruct)
#   --cloud-model <name>      Ollama Cloud model for Tier 1.5 (default: deepseek-v3.1:671b-cloud)
#   --domain <domain>         Customer server domain/IP
#   --offline                 Use offline JWT licence mode
#   --offline-token <jwt>     Offline licence JWT (required with --offline)
#   --gpu                     Enable NVIDIA GPU for Ollama (Tier 2)
#   --air-gapped              Export Docker images for offline transfer
# =========================================================
set -euo pipefail

# ── Defaults ─────────────────────────────────────────────────────────────────
TIER=1
CUSTOMER=""
LICENCE_KEY=""
VERSION="latest"
# --model is the local Ollama model used by Tier 2. Tier 1.5 (Ollama Cloud)
# uses a different catalogue (cloud-hosted models only), so it has its own
# --cloud-model knob with a cloud-appropriate default.
MODEL="qwen3.5:9b-instruct"
MODEL_TAG="qwen3-5-9b-instruct"
CLOUD_MODEL="deepseek-v3.1:671b-cloud"
DOMAIN=""
OFFLINE=false
OFFLINE_TOKEN=""
GPU=false
AIR_GAPPED=false
REGISTRY="ghcr.io/vantax-org"

# ── Argument parsing ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --tier)          TIER="$2";          shift 2 ;;
    --customer)      CUSTOMER="$2";      shift 2 ;;
    --licence-key)   LICENCE_KEY="$2";   shift 2 ;;
    --version)       VERSION="$2";       shift 2 ;;
    --model)         MODEL="$2";         MODEL_TAG=$(echo "$2" | tr ':' '-' | tr '.' '-'); shift 2 ;;
    --cloud-model)   CLOUD_MODEL="$2";   shift 2 ;;
    --domain)        DOMAIN="$2";        shift 2 ;;
    --offline)       OFFLINE=true;       shift ;;
    --offline-token) OFFLINE_TOKEN="$2"; shift 2 ;;
    --gpu)           GPU=true;           shift ;;
    --air-gapped)    AIR_GAPPED=true;    shift ;;
    *)               echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ── Validation ───────────────────────────────────────────────────────────────
if [[ -z "$CUSTOMER" ]]; then
  echo "Error: --customer is required" >&2; exit 1
fi
if [[ -z "$LICENCE_KEY" && "$OFFLINE" == "false" ]]; then
  echo "Error: --licence-key is required (or use --offline + --offline-token)" >&2; exit 1
fi
if [[ "$OFFLINE" == "true" && -z "$OFFLINE_TOKEN" ]]; then
  echo "Error: --offline-token is required with --offline" >&2; exit 1
fi
if [[ -z "${GHCR_READ_TOKEN:-}" ]]; then
  echo "Error: GHCR_READ_TOKEN env var is required." >&2
  echo "  Export a GitHub PAT (read:packages scope) before running:" >&2
  echo "  export GHCR_READ_TOKEN=ghp_xxxx" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PKG_DIR="${ROOT_DIR}/build/customer-package"
OUTPUT_FILE="${ROOT_DIR}/meridian-deployment-${CUSTOMER}-${VERSION}.tar.gz"

echo ""
echo "================================================"
echo "  Creating Meridian Deployment Package"
echo "  Customer: ${CUSTOMER}"
echo "  Version:  ${VERSION}"
echo "  Tier:     ${TIER} | Offline: ${OFFLINE} | Air-gapped: ${AIR_GAPPED}"
echo "================================================"
echo ""

# ── Clean and create package directory ───────────────────────────────────────
rm -rf "${PKG_DIR}"
mkdir -p "${PKG_DIR}/scripts" "${PKG_DIR}/docker/nginx"

# ── Generate docker-compose.yml from template ────────────────────────────────
echo "→ Generating docker-compose.yml..."
sed -e "s|{{VERSION}}|${VERSION}|g" \
    -e "s|{{CUSTOMER_NAME}}|${CUSTOMER}|g" \
    -e "s|{{TIER}}|Tier ${TIER}|g" \
    "${ROOT_DIR}/docker/docker-compose.customer.yml" \
    > "${PKG_DIR}/docker-compose.yml"

# ── Generate Tier 2 Ollama overlay ───────────────────────────────────────────
if [[ "$TIER" == "2" ]]; then
  echo "→ Generating docker-compose.ollama.yml (model: ${MODEL})..."
  sed -e "s|{{MODEL_TAG}}|${MODEL_TAG}|g" \
      "${ROOT_DIR}/docker/docker-compose.customer.ollama.yml" \
      > "${PKG_DIR}/docker-compose.ollama.yml"

  if [[ "$GPU" == "true" ]]; then
    sed -i 's|    # deploy:|    deploy:|g;
            s|    #   resources:|      resources:|g;
            s|    #     reservations:|        reservations:|g;
            s|    #       devices:|          devices:|g;
            s|    #         - driver: nvidia|            - driver: nvidia|g;
            s|    #           count: all|              count: all|g;
            s|    #           capabilities: \[gpu\]|              capabilities: [gpu]|g' \
      "${PKG_DIR}/docker-compose.ollama.yml"
    echo "  GPU acceleration enabled"
  fi
fi

# ── Generate pre-configured .env ─────────────────────────────────────────────
echo "→ Generating .env..."

DB_PASS=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-z0-9' | head -c 16)
MINIO_PASS=$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-z0-9' | head -c 16)
CRED_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)

if [[ "$OFFLINE" == "true" ]]; then
  LICENCE_MODE="offline"
  LICENCE_KEY_LINE=""
  LICENCE_TOKEN_LINE="MERIDIAN_LICENCE_TOKEN=${OFFLINE_TOKEN}"
else
  LICENCE_MODE="online"
  LICENCE_KEY_LINE="MERIDIAN_LICENCE_KEY=${LICENCE_KEY}"
  LICENCE_TOKEN_LINE=""
fi

case "$TIER" in
  0)
    LLM_SECTION="# Tier 0 — LLM-less (fully deterministic, no cloud LLM, no Ollama container).
# safe_invoke short-circuits to None and every AI service falls back to its
# deterministic path. Ideal for 400k bulk loads, air-gapped sites without GPU,
# and PoC deployments with no LLM budget.
LLM_PROVIDER=none"
    ;;
  1)
    LLM_SECTION="LLM_PROVIDER=anthropic
# Set your Anthropic API key:
ANTHROPIC_API_KEY=
# Or use Azure OpenAI:
# LLM_PROVIDER=azure_openai
# AZURE_OPENAI_ENDPOINT=
# AZURE_OPENAI_API_KEY=
# AZURE_OPENAI_DEPLOYMENT=gpt-4o"
    ;;
  1.5)
    # Ollama Cloud uses its own model catalogue; ${MODEL} is the local Tier 2
    # default and would 404 against the cloud service. Use ${CLOUD_MODEL}.
    LLM_SECTION="# Tier 1.5 — Ollama Cloud. Sanitised prompts only leave the cluster; all SAP
# data, findings and reports stay on-prem. Get an API key at https://ollama.com/settings.
LLM_PROVIDER=ollama_cloud
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_API_KEY=
OLLAMA_MODEL=${CLOUD_MODEL}"
    ;;
  2)
    LLM_SECTION="LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=${MODEL}"
    ;;
  3)
    LLM_SECTION="LLM_PROVIDER=custom
# Set your BYOLLM endpoint:
CUSTOM_LLM_BASE_URL=
CUSTOM_LLM_API_KEY=
CUSTOM_LLM_MODEL="
    ;;
  *)
    echo "Error: --tier must be one of 0, 1, 1.5, 2, 3 (got: ${TIER})" >&2
    exit 1
    ;;
esac

CORS_ORIGINS=""
if [[ -n "$DOMAIN" ]]; then
  CORS_ORIGINS="http://${DOMAIN},https://${DOMAIN}"
fi

cat > "${PKG_DIR}/.env" <<ENV
# =========================================================
# Meridian Platform — ${CUSTOMER} Configuration
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Version:   ${VERSION}
# Tier:      Tier ${TIER}
# =========================================================

# ── Licence ───────────────────────────────────────────────
MERIDIAN_LICENCE_MODE=${LICENCE_MODE}
${LICENCE_KEY_LINE}
${LICENCE_TOKEN_LINE}
MERIDIAN_LICENCE_SERVER_URL=https://licence.meridian.vantax.co.za/api/licence/validate

# ── Image registry (baked deploy credentials) ─────────────
# read:packages-only token so the customer never supplies a GH token or user.
# Treat this file as a secret: anyone with the tarball can read this token.
# Use a narrowly-scoped, revocable machine PAT.
MERIDIAN_GHCR_USER=vantax-org
MERIDIAN_GHCR_TOKEN=${GHCR_READ_TOKEN}

# ── Internal API proxy (used by Next.js rewrites — do not change) ──
INTERNAL_API_URL=http://api:8000

# ── LLM (Tier ${TIER}) ────────────────────────────────────
${LLM_SECTION}

# ── Database ──────────────────────────────────────────────
DB_PASSWORD=${DB_PASS}
DATABASE_URL=postgresql+asyncpg://meridian:${DB_PASS}@db:5432/meridian
DATABASE_URL_SYNC=postgresql://meridian:${DB_PASS}@db:5432/meridian

# ── Redis ─────────────────────────────────────────────────
REDIS_URL=redis://redis:6379/0

# ── MinIO (object storage) ────────────────────────────────
MINIO_ACCESS_KEY=meridian
MINIO_PASSWORD=${MINIO_PASS}
MINIO_SECRET_KEY=${MINIO_PASS}
MINIO_BUCKET_UPLOADS=meridian-uploads
MINIO_BUCKET_REPORTS=meridian-reports

# ── Auth ──────────────────────────────────────────────────
AUTH_MODE=local
NEXT_PUBLIC_AUTH_MODE=local

# ── SAP Connection ────────────────────────────────────────
SAP_CONNECTOR=mock
CREDENTIAL_MASTER_KEY=${CRED_KEY}

# ── Network ──────────────────────────────────────────────
MERIDIAN_CORS_ORIGINS=${CORS_ORIGINS}

# ── Notifications (optional) ─────────────────────────────
RESEND_API_KEY=
TEAMS_WEBHOOK_URL=

# ── Observability (optional) ─────────────────────────────
SENTRY_DSN=
ENV

# Clean up empty optional lines
sed -i '/^MERIDIAN_LICENCE_KEY=$/ { /^$/d }' "${PKG_DIR}/.env" 2>/dev/null || true
sed -i '/^MERIDIAN_LICENCE_TOKEN=$/ { /^$/d }' "${PKG_DIR}/.env" 2>/dev/null || true

# ── Copy installer script with GHCR token injection ─────────────────────────
echo "→ Adding installer (meridian-deploy.sh)..."
sed "s|__GHCR_TOKEN__|${GHCR_READ_TOKEN}|g" \
  "${ROOT_DIR}/scripts/meridian-deploy.sh" > "${PKG_DIR}/scripts/meridian-deploy.sh"
chmod +x "${PKG_DIR}/scripts/meridian-deploy.sh"

# ── Copy docker config files (needed by meridian-deploy.sh) ─────────────────
echo "→ Adding docker configuration files..."
cp "${ROOT_DIR}/docker/docker-compose.customer.yml" "${PKG_DIR}/docker/docker-compose.customer.yml"
cp "${ROOT_DIR}/docker/docker-compose.customer.ollama.yml" "${PKG_DIR}/docker/docker-compose.customer.ollama.yml"
cp "${ROOT_DIR}/docker/nginx/meridian.conf" "${PKG_DIR}/docker/nginx/meridian.conf"

# ── Generate README ──────────────────────────────────────────────────────────
echo "→ Generating README..."

if [[ "$TIER" == "2" ]]; then
  START_CMD="docker compose -f docker-compose.yml -f docker-compose.ollama.yml up -d"
  UPDATE_CMD="docker compose -f docker-compose.yml -f docker-compose.ollama.yml pull && ${START_CMD}"
else
  START_CMD="docker compose up -d"
  UPDATE_CMD="docker compose pull && docker compose up -d"
fi

if [[ "$AIR_GAPPED" == "true" ]]; then
  LOAD_NOTE="
## 2. Load Docker Images (Air-gapped)

Transfer \`meridian-${VERSION}.tar.gz\` to the server and load it:
\`\`\`bash
docker load < meridian-${VERSION}.tar.gz
\`\`\`
"
else
  LOAD_NOTE="
## 2. Pull Docker Images

Images are pulled automatically by the installer.
"
fi

cat > "${PKG_DIR}/README.md" <<README
# Meridian Platform — Deployment Guide

**Customer**: ${CUSTOMER}
**Version**: ${VERSION}
**Tier**: Tier ${TIER}$([ "$TIER" == "2" ] && echo " — Bundled Ollama (${MODEL})" || echo "")
**Generated**: $(date -u +"%Y-%m-%d")

---

## Quick Start

\`\`\`bash
sudo bash scripts/meridian-deploy.sh
\`\`\`

The installer will:
- Install Docker (if not present)
- Validate your licence
- Configure SSL
- Pull and start all services
- Run database migrations
- Create your admin account

---

## Prerequisites

$(case "$TIER" in
  1|3) echo "- 4 vCPUs, 8 GB RAM, 50 GB disk" ;;
  2)   echo "- 4 vCPUs, 16 GB RAM, 80 GB disk"
       [[ "$GPU" == "true" ]] && echo "- NVIDIA GPU with 12 GB+ VRAM (CUDA drivers installed)" ;;
esac)
- Docker Engine 24+ and Docker Compose 2.20+
- Outbound HTTPS access (for licence validation and image pull)$([ "$OFFLINE" == "true" ] && echo " — **not required** (offline mode)" || echo "")

Install Docker:
\`\`\`bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker \$USER && newgrp docker
\`\`\`
${LOAD_NOTE}
## Manual Setup (Alternative)

If you prefer not to use the installer:

### 3. Configure .env

Open \`.env\` and fill in any required values marked with a comment.
$([ "$TIER" == "1" ] && echo "**Required**: set \`ANTHROPIC_API_KEY\` (or Azure OpenAI variables)." || echo "")
SAP connection details must be entered before running a sync.

### 4. Start Meridian

\`\`\`bash
${START_CMD}
\`\`\`

### 5. Run Database Migrations

\`\`\`bash
docker compose exec api alembic upgrade head
\`\`\`

### 6. Create Admin User

\`\`\`bash
docker compose exec api python scripts/manage_users.py create \\
    --email admin@company.com \\
    --name "Admin User" \\
    --password "YourSecurePassword" \\
    --role admin
\`\`\`

### 7. Verify Health

\`\`\`bash
curl http://localhost:8000/health
\`\`\`

Open the dashboard: **http://localhost:3000**

## Updating

\`\`\`bash
${UPDATE_CMD}
docker compose exec api alembic upgrade head
\`\`\`

## Support

Contact Meridian support: support@vantax.co.za
README

# ── Generate QUICKSTART.txt ──────────────────────────────────────────────────
cat > "${PKG_DIR}/QUICKSTART.txt" << 'QSEOF'
╔══════════════════════════════════════════════╗
║  MERIDIAN PLATFORM — QUICK START             ║
╚══════════════════════════════════════════════╝

1. Prerequisites:
   • Docker Engine 24.0+
   • 8GB RAM minimum (16GB+ recommended)
   • 20GB free disk space

2. Run the installer:
   sudo bash scripts/meridian-deploy.sh

3. The installer will prompt for:
   • Server domain/IP
   • SSL mode
   • Admin account details
   (Licence and config are pre-configured)

4. Access Meridian:
   • Dashboard: http://your-server
   • API Docs:  http://your-server/docs

5. Need help?
   • Read: README.md
   • Email: support@vantax.co.za

QSEOF

# ── Air-gapped: export images ────────────────────────────────────────────────
if [[ "$AIR_GAPPED" == "true" ]]; then
  echo "→ Exporting Docker images (this may take a while)..."
  bash "${SCRIPT_DIR}/export-images.sh" "${VERSION}" \
    $([ "$TIER" == "2" ] && echo "--tier 2 --model ${MODEL_TAG}" || echo "")
  if [[ -f "meridian-${VERSION}.tar.gz" ]]; then
    mv "meridian-${VERSION}.tar.gz" "${PKG_DIR}/"
  fi
fi

# ── Checksums ────────────────────────────────────────────────────────────────
echo "→ Generating checksums..."
(cd "${PKG_DIR}" && find . -type f -exec sha256sum {} \; > checksums.txt)

# ── Create tarball ───────────────────────────────────────────────────────────
echo "→ Creating tarball..."
(cd "${ROOT_DIR}/build" && tar czf "${OUTPUT_FILE}" customer-package/)

SIZE=$(du -h "${OUTPUT_FILE}" | cut -f1)

echo ""
echo "================================================"
echo "  ✓ Package created successfully!"
echo ""
echo "  Customer: ${CUSTOMER}"
echo "  File:     $(basename ${OUTPUT_FILE})"
echo "  Size:     ${SIZE}"
echo "  Path:     ${OUTPUT_FILE}"
echo ""
echo "  Pre-configured:"
echo "    Tier:      ${TIER}"
echo "    Licence:   ${LICENCE_MODE} (${LICENCE_KEY:+${LICENCE_KEY:0:9}****}${LICENCE_KEY:-JWT token})"
echo "    LLM:       $(echo "${LLM_SECTION}" | head -1)"
echo "    Passwords: auto-generated"
echo "================================================"
echo ""
echo "To distribute to customer:"
echo "  scp ${OUTPUT_FILE} customer@server:/tmp/"
echo ""
echo "Customer installation:"
echo "  tar -xzf $(basename ${OUTPUT_FILE})"
echo "  cd customer-package"
echo "  sudo bash scripts/meridian-deploy.sh"
echo ""
