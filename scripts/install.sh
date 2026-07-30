#!/usr/bin/env bash
# =============================================================================
# Meridian Platform — Bootstrap installer (no git clone required)
# scripts/install.sh
#
# Downloads only the files a host actually needs (compose file, .env.example,
# deploy + update scripts) straight from the private repo via the GitHub
# Contents API, logs in to GHCR, then hands off to meridian-deploy.sh.
#
# The full repo is never cloned — the frontend/node_modules alone dwarf what a
# deployment needs. Everything else (nginx config, app code) ships inside the
# container images.
#
# Requirements on the host: docker 24+, curl, python3, openssl (same as deploy).
#
# One-liner (interactive install). Use process substitution — NOT `curl | bash`
# — so the installer's prompts (licence key, tier, admin password) can still
# read from your terminal:
#   export GH_TOKEN=ghp_xxx        # PAT with scopes: repo + read:packages
#   export GH_USER=your-gh-user
#   sudo -E bash <(curl -fsSL https://<where-you-host-this>/install.sh)
#
# Or save it and run:
#   sudo GH_TOKEN=ghp_xxx GH_USER=your-gh-user bash install.sh
#
# Extra flags pass through to meridian-deploy.sh. Piping `curl | bash` only
# works for a fully non-interactive run (pre-seeded .env), e.g.:
#   curl -fsSL <url> | sudo -E bash -s -- --non-interactive
# =============================================================================
set -euo pipefail

REPO="${MERIDIAN_REPO:-VantaX-Org/Meridian}"
REF="${MERIDIAN_REF:-main}"
INSTALL_DIR="${MERIDIAN_INSTALL_DIR:-/opt/meridian}"
API="https://api.github.com/repos/${REPO}/contents"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
log()   { echo -e "${GREEN}[✓]${NC} $*"; }
die()   { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

: "${GH_TOKEN:?Set GH_TOKEN to a GitHub PAT with 'repo' + 'read:packages' scopes}"
: "${GH_USER:?Set GH_USER to your GitHub username}"

command -v docker >/dev/null 2>&1 || die "docker not found — install Docker 24+ first"
command -v curl   >/dev/null 2>&1 || die "curl not found"

fetch() {  # fetch <repo-path> <dest>
    local path="$1" dest="$2"
    mkdir -p "$(dirname "$dest")"
    curl -fsSL \
        -H "Authorization: token ${GH_TOKEN}" \
        -H "Accept: application/vnd.github.raw" \
        "${API}/${path}?ref=${REF}" -o "$dest" \
        || die "Failed to download ${path} — check GH_TOKEN has 'repo' scope and access to ${REPO}"
    log "fetched ${path}"
}

log "Install dir: ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"

echo "→ Downloading deployment files (no clone) from ${REPO}@${REF}"
fetch "docker/docker-compose.customer.yml" "${INSTALL_DIR}/docker/docker-compose.customer.yml"
fetch ".env.example"                       "${INSTALL_DIR}/.env.example"
fetch "scripts/meridian-deploy.sh"         "${INSTALL_DIR}/scripts/meridian-deploy.sh"
fetch "scripts/update.sh"                  "${INSTALL_DIR}/scripts/update.sh"

echo "→ Authenticating to ghcr.io"
echo "${GH_TOKEN}" | docker login ghcr.io -u "${GH_USER}" --password-stdin \
    || die "docker login ghcr.io failed — token needs 'read:packages'"
log "logged in to ghcr.io"

echo "→ Handing off to the installer"
cd "${INSTALL_DIR}"
exec bash scripts/meridian-deploy.sh "$@"
