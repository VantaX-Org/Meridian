#!/usr/bin/env bash
set -euo pipefail

RESPONSE=$(curl -sf ${MERIDIAN_HEALTH_URL:-http://127.0.0.1/health} 2>/dev/null || echo "")

if echo "$RESPONSE" | grep -Eq '"status": ?"ok"'; then
    echo "Meridian API: OK"
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
    exit 0
else
    echo "Meridian API: UNHEALTHY"
    echo "Response: $RESPONSE"
    exit 1
fi
