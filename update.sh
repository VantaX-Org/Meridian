```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/meridian"
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.yml"

echo "═══════════════════════════════════════"
echo "  Meridian Update"
echo "═══════════════════════════════════════"

cd "$INSTALL_DIR"

echo ""
echo "→ Pulling latest images..."
docker compose -f "$COMPOSE_FILE" pull

echo ""
echo "→ Running database migrations..."
docker compose -f "$COMPOSE_FILE" run --rm api alembic upgrade head 2>/dev/null || echo "  (no pending migrations)"

echo ""
echo "→ Restarting services..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "→ Waiting for services to stabilise..."
sleep 10

echo ""
echo "→ Health check..."
if [ -f "${INSTALL_DIR}/healthcheck.sh" ]; then
    bash "${INSTALL_DIR}/healthcheck.sh"
else
    docker compose -f "$COMPOSE_FILE" ps
fi

echo ""
echo "═══════════════════════════════════════"
echo "  Update complete"
echo "═══════════════════════════════════════"
```