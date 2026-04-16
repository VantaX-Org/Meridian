#!/usr/bin/env bash
# =========================================================
# Meridian — Docker Image Export (Air-gapped Deployments)
#
# Pulls all Meridian production images and saves them to a
# single .tar.gz for transfer to air-gapped environments.
#
# Usage:
#   ./scripts/export-images.sh [version] [--tier 2] [--model <tag>]
#
# Examples:
#   ./scripts/export-images.sh latest
#   ./scripts/export-images.sh v1.2.0 --tier 2 --model qwen2-5-14b-q4-K-M
#
# On the air-gapped server:
#   docker load < meridian-v1.2.0.tar.gz
# =========================================================
set -euo pipefail

VERSION="${1:-latest}"
TIER=1
MODEL_TAG="qwen2-5-14b-q4-K-M"
REGISTRY="ghcr.io/agentum-au"

shift || true  # consume version arg

while [[ $# -gt 0 ]]; do
  case $1 in
    --tier)  TIER="$2";      shift 2 ;;
    --model) MODEL_TAG="$2"; shift 2 ;;
    *)       echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

OUTPUT_FILE="meridian-${VERSION}.tar.gz"

IMAGES=(
  "${REGISTRY}/meridian-api:${VERSION}"
  "${REGISTRY}/meridian-frontend:${VERSION}"
  "${REGISTRY}/meridian-worker:${VERSION}"
)

if [[ "$TIER" == "2" ]]; then
  IMAGES+=("${REGISTRY}/meridian-ollama:${MODEL_TAG}")
fi

echo ""
echo "  Exporting Meridian ${VERSION} images..."
echo "  Images: ${IMAGES[*]}"
echo ""

echo "  Pulling images from GHCR..."
for img in "${IMAGES[@]}"; do
  echo "    docker pull ${img}"
  docker pull "${img}"
done

echo ""
echo "  Saving to ${OUTPUT_FILE}..."
docker save "${IMAGES[@]}" | gzip > "${OUTPUT_FILE}"

SIZE=$(du -sh "${OUTPUT_FILE}" | cut -f1)
echo ""
echo "  Export complete: ${OUTPUT_FILE} (${SIZE})"
echo ""
echo "  Transfer to air-gapped server and load with:"
echo "    docker load < ${OUTPUT_FILE}"
echo ""
