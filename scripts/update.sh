#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

info "Updating Vantax to latest version..."

# ─── 1. Pull latest images ──────────────────────────────────────────────────

info "Pulling latest images..."
docker compose pull || error "Failed to pull images"

# ─── 2. Run database migrations ─────────────────────────────────────────────

info "Running database migrations..."
docker compose run --rm api alembic upgrade head || error "Migration failed"

# ─── 3. Recreate services ───────────────────────────────────────────────────

info "Restarting services..."
docker compose up -d --force-recreate api worker frontend

# ─── 4. Wait for healthchecks ───────────────────────────────────────────────

info "Waiting for services to become healthy..."
TIMEOUT=120
INTERVAL=5
ELAPSED=0

while [ $ELAPSED -lt $TIMEOUT ]; do
    HEALTHY=$(curl -sf http://localhost:8000/health 2>/dev/null | grep -c '"status":"ok"' || echo "0")
    if [ "$HEALTHY" = "1" ]; then
        info "API healthy ✓"
        break
    fi
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
    printf "."
done
echo ""

if [ $ELAPSED -ge $TIMEOUT ]; then
    warn "Timeout waiting for API — check logs: docker compose logs api"
fi

# ─── 5. Report version ──────────────────────────────────────────────────────

VERSION=$(curl -s http://localhost:8000/health 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('version', 'unknown'))
except:
    print('unknown')
" 2>/dev/null || echo "unknown")

echo ""
info "Update complete. Version: $VERSION"
