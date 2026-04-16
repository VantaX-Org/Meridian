#!/usr/bin/env bash
set -euo pipefail

RESPONSE=$(curl -sf http://localhost:8000/health 2>/dev/null || echo "")

if echo "$RESPONSE" | grep -q '"status":"ok"'; then
    echo "Vantax API: OK"
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
    exit 0
else
    echo "Vantax API: UNHEALTHY"
    echo "Response: $RESPONSE"
    exit 1
fi
