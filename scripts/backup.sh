#!/usr/bin/env bash
# =========================================================
# Meridian Platform — Backup script
# scripts/backup.sh
#
# Produces a timestamped bundle with:
#   - Postgres dump (pg_dump --format=custom — small, restorable with --clean)
#   - MinIO buckets (uploads + reports) as tar.gz
#   - .env file (encrypted with GPG if --encrypt is passed)
#   - A manifest.json pinning image tags + migration head
#
# Usage:
#   sudo bash scripts/backup.sh                      # defaults: ./backups/<ts>
#   sudo bash scripts/backup.sh --output /data/bak   # custom dir
#   sudo bash scripts/backup.sh --encrypt            # GPG-encrypt .env
#   sudo bash scripts/backup.sh --database-only      # skip MinIO (useful in CI drills)
#
# Exit codes:
#   0  success
#   1  unrecoverable error (no partial bundle retained)
#   2  invalid arguments
# =========================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

OUTPUT_DIR="${REPO_ROOT}/backups"
ENCRYPT=false
DATABASE_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --output)         OUTPUT_DIR="$2"; shift 2 ;;
        --encrypt)        ENCRYPT=true; shift ;;
        --database-only)  DATABASE_ONLY=true; shift ;;
        -h|--help)
            grep '^# ' "$0" | sed 's/^# //'
            exit 0
            ;;
        *)                echo "Unknown flag: $1 (try --help)" >&2; exit 2 ;;
    esac
done

TIMESTAMP=$(date -u +%Y%m%d_%H%M%S)
BACKUP_DIR="${OUTPUT_DIR}/${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

# Compose file detection — prefer customer deploy, fall back to dev.
COMPOSE_ARGS=()
if [[ -f "${REPO_ROOT}/docker/docker-compose.customer.yml" ]]; then
    COMPOSE_ARGS+=(-f "${REPO_ROOT}/docker/docker-compose.customer.yml")
elif [[ -f "${REPO_ROOT}/docker-compose.yml" ]]; then
    COMPOSE_ARGS+=(-f "${REPO_ROOT}/docker-compose.yml")
else
    fail "No docker-compose file found"
fi

DC="docker compose ${COMPOSE_ARGS[*]}"

# ─── 1. Postgres dump (pg_dump custom format) ───────────────────────────────
info "Dumping Postgres database..."
DB_FILE="${BACKUP_DIR}/meridian.dump"
if ! $DC exec -T db pg_dump -U meridian --format=custom --no-owner --no-privileges meridian > "$DB_FILE"; then
    fail "pg_dump failed"
fi
DB_SIZE=$(du -h "$DB_FILE" | cut -f1)
info "Postgres dump: $DB_FILE ($DB_SIZE)"

# Also capture the Alembic head so `restore.sh` can verify version match.
MIGRATION_HEAD=$($DC exec -T db psql -U meridian -d meridian -tAc \
    "SELECT version_num FROM alembic_version LIMIT 1" 2>/dev/null | tr -d '\r' || echo "unknown")
info "Migration head: $MIGRATION_HEAD"

# ─── 2. MinIO buckets ───────────────────────────────────────────────────────
if [[ "$DATABASE_ONLY" != "true" ]]; then
    for bucket in meridian-uploads meridian-reports; do
        info "Backing up MinIO bucket: $bucket"
        if $DC exec -T minio sh -c "[ -d /data/$bucket ]" 2>/dev/null; then
            $DC exec -T minio sh -c \
                "cd /data && tar -czf /tmp/${bucket}.tar.gz ${bucket} 2>/dev/null" 2>/dev/null || \
                warn "tar failed for $bucket (may be empty)"
            $DC cp "minio:/tmp/${bucket}.tar.gz" "${BACKUP_DIR}/${bucket}.tar.gz" 2>/dev/null || \
                warn "copy from MinIO failed for $bucket"
            if [[ -f "${BACKUP_DIR}/${bucket}.tar.gz" ]]; then
                info "  ${bucket}: $(du -h "${BACKUP_DIR}/${bucket}.tar.gz" | cut -f1)"
            fi
        else
            warn "Bucket $bucket does not exist — skipping"
        fi
    done
fi

# ─── 3. .env file ───────────────────────────────────────────────────────────
if [[ -f "${REPO_ROOT}/.env" ]]; then
    if [[ "$ENCRYPT" == "true" ]]; then
        command -v gpg >/dev/null || fail "--encrypt requested but gpg not installed"
        info "Encrypting .env with GPG (symmetric, prompts for passphrase)"
        gpg --symmetric --cipher-algo AES256 --output "${BACKUP_DIR}/env.gpg" "${REPO_ROOT}/.env"
    else
        # Stash a copy but chmod 600 so root-only reads — never world-readable.
        cp "${REPO_ROOT}/.env" "${BACKUP_DIR}/env.txt"
        chmod 600 "${BACKUP_DIR}/env.txt"
        warn ".env copied unencrypted — rerun with --encrypt for sensitive backups"
    fi
fi

# ─── 4. Manifest ────────────────────────────────────────────────────────────
cat > "${BACKUP_DIR}/manifest.json" <<MANIFEST
{
  "backup_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "hostname": "$(hostname)",
  "migration_head": "${MIGRATION_HEAD}",
  "database_only": ${DATABASE_ONLY},
  "encrypted_env": ${ENCRYPT},
  "files": {
    "database": "meridian.dump",
    "uploads": "meridian-uploads.tar.gz",
    "reports": "meridian-reports.tar.gz",
    "env": "$(if [[ "$ENCRYPT" == "true" ]]; then echo 'env.gpg'; else echo 'env.txt'; fi)"
  }
}
MANIFEST

# ─── 5. Summary ─────────────────────────────────────────────────────────────
echo ""
info "Backup complete: $BACKUP_DIR"
info "  Bundle size: $(du -sh "$BACKUP_DIR" | cut -f1)"
info "  Contents:"
ls -lh "$BACKUP_DIR/" | tail -n +2 | sed 's/^/    /'
