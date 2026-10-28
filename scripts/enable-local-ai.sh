#!/usr/bin/env bash
# Switch an installed Meridian to the bundled local language model (Tier 2,
# Ollama running qwen3.5:9b inside the stack). Nothing leaves the server.
#
#   sudo bash scripts/enable-local-ai.sh            # qwen3.5:9b
#   sudo bash scripts/enable-local-ai.sh qwen3.5:9b
#
# Safe to run again. Clears any model chosen earlier in the app, so the
# installation setting below is the one used.
set -euo pipefail
cd "$(dirname "$0")/.."

MODEL="${1:-qwen3.5:9b}"
TAG=$(echo "$MODEL" | tr ':.' '--')

info()  { echo -e "\033[0;32m[INFO]\033[0m  $*"; }
error() { echo -e "\033[0;31m[ERROR]\033[0m $*"; exit 1; }

if [[ -f docker/docker-compose.customer.yml ]]; then COMPOSE_FILE=docker/docker-compose.customer.yml
else error "docker/docker-compose.customer.yml not found — run from the Meridian install directory"; fi
TEMPLATE=docker/docker-compose.customer.ollama.yml
RESOLVED=docker/docker-compose.customer.ollama.resolved.yml
[[ -f "$TEMPLATE" ]] || error "$TEMPLATE not found — update Meridian first"

# 1. Installation setting, in every .env the stack reads
for f in .env docker/.env; do
    [[ -f "$f" ]] || continue
    for kv in "LLM_PROVIDER=ollama" "OLLAMA_BASE_URL=http://ollama:11434" "OLLAMA_MODEL=$MODEL"; do
        k=${kv%%=*}
        if grep -q "^$k=" "$f"; then sed -i "s|^$k=.*|$kv|" "$f"; else echo "$kv" >> "$f"; fi
    done
done
info "LLM_PROVIDER=ollama, OLLAMA_MODEL=$MODEL"

# 2. The Ollama container with the model baked in
sed "s|{{MODEL_TAG}}|${TAG}|g" "$TEMPLATE" > "$RESOLVED"
dc() { docker compose -f "$COMPOSE_FILE" -f "$RESOLVED" "$@"; }
info "Pulling ghcr.io/vantax-org/meridian-ollama:${TAG} (several GB on first run)..."
dc pull ollama
dc up -d ollama
for _ in $(seq 1 30); do
    dc exec -T ollama ollama list 2>/dev/null | grep -q "^${MODEL}" && break
    sleep 5
done
dc exec -T ollama ollama list | grep -q "^${MODEL}" || error "Ollama is up but $MODEL is not loaded — check: docker logs meridian-ollama"
info "Ollama is serving $MODEL"

# 3. Drop a model chosen earlier in the app (it would override the setting above)
dc exec -T db psql -U meridian -d meridian -q -c "UPDATE tenants SET llm_config = NULL WHERE llm_config IS NOT NULL" >/dev/null
info "Cleared any model set earlier in the app"

# 4. Restart what calls the model so it reads the new setting
dc up -d --force-recreate --no-deps api worker beat
info "Done. Meridian now uses $MODEL locally."
