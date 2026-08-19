#!/usr/bin/env bash
# =========================================================
# Meridian Platform — Retrofit the self-update sidecar
# scripts/enable-auto-update.sh
#
# For deployments installed BEFORE the self-update feature shipped. New
# installs (scripts/install.sh + meridian-deploy.sh) already set this up
# automatically — this script is only for onboarding an EXISTING stack
# onto it, as a one-time, idempotent step:
#   1. fetch docker/docker-compose.updater.yml if it isn't already present
#   2. generate UPDATER_SHARED_SECRET into .env (skipped if already set)
#   3. start the updater sidecar
#   4. recreate the api container so it picks up the new env var
#
# Usage:
#   cd /opt/meridian && sudo bash scripts/enable-auto-update.sh
#
# Requires GH_TOKEN + GH_USER (same PAT scopes as install.sh: repo +
# read:packages) ONLY if docker/docker-compose.updater.yml isn't already on
# disk — e.g. from a prior `git pull` of a source-based install.
# =========================================================
set -euo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

REPO="${MERIDIAN_REPO:-VantaX-Org/Meridian}"
REF="${MERIDIAN_REF:-main}"
API="https://api.github.com/repos/${REPO}/contents"

if [[ -f "docker/docker-compose.customer.yml" ]]; then
    COMPOSE_FILE="docker/docker-compose.customer.yml"
elif [[ -f "docker-compose.yml" ]]; then
    COMPOSE_FILE="docker-compose.yml"
else
    error "No docker-compose file found — run this from your Meridian install directory"
fi

UPDATER_OVERLAY="docker/docker-compose.updater.yml"

if [[ ! -f "$UPDATER_OVERLAY" ]]; then
    info "Fetching ${UPDATER_OVERLAY}..."
    : "${GH_TOKEN:?docker-compose.updater.yml not found locally — set GH_TOKEN (PAT with 'repo' scope) to fetch it, or copy it in manually}"
    : "${GH_USER:?Set GH_USER to your GitHub username}"
    mkdir -p "$(dirname "$UPDATER_OVERLAY")"
    curl -fsSL \
        -H "Authorization: token ${GH_TOKEN}" \
        -H "Accept: application/vnd.github.raw" \
        "${API}/${UPDATER_OVERLAY}?ref=${REF}" -o "$UPDATER_OVERLAY" \
        || error "Failed to download ${UPDATER_OVERLAY} — check GH_TOKEN has 'repo' scope and access to ${REPO}"
    info "fetched ${UPDATER_OVERLAY}"
else
    info "${UPDATER_OVERLAY} already present — skipping download"
fi

if [[ ! -f ".env" ]]; then
    error ".env not found — this doesn't look like a Meridian install directory"
fi

if grep -q "^UPDATER_SHARED_SECRET=" .env 2>/dev/null; then
    info "UPDATER_SHARED_SECRET already set in .env — leaving it as-is"
else
    info "Generating UPDATER_SHARED_SECRET..."
    _SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)
    {
        printf '\n# Updater sidecar (self-update — internal network only)\n'
        printf 'UPDATER_SHARED_SECRET=%s\n' "$_SECRET"
    } >> .env
    info "UPDATER_SHARED_SECRET written to .env"
fi

dc() { docker compose -f "$COMPOSE_FILE" -f "$UPDATER_OVERLAY" "$@"; }

info "Starting the updater sidecar..."
dc pull updater
dc up -d updater

info "Recreating api to pick up UPDATER_SHARED_SECRET..."
dc up -d --force-recreate api

info "Done. The 'Update Now' button will appear for admins next time a newer version is published."
