#!/usr/bin/env bash
# Kept for installs and runbooks that call /opt/meridian/update.sh: the update
# procedure (rollback snapshot, DB backup, MinIO → Garage move, migrations) is
# scripts/update.sh. Same flags.
cd "$(dirname "$0")" && exec bash scripts/update.sh "$@"
