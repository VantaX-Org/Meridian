#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="backups/${TIMESTAMP}"

mkdir -p "$BACKUP_DIR"

# ─── 1. Postgres dump ───────────────────────────────────────────────────────

info "Dumping Postgres database..."
docker compose exec -T db pg_dump -U vantax vantax > "${BACKUP_DIR}/vantax_${TIMESTAMP}.sql"

if [ -f "${BACKUP_DIR}/vantax_${TIMESTAMP}.sql" ]; then
    SQL_SIZE=$(du -h "${BACKUP_DIR}/vantax_${TIMESTAMP}.sql" | cut -f1)
    info "Postgres dump: ${BACKUP_DIR}/vantax_${TIMESTAMP}.sql ($SQL_SIZE)"
else
    warn "Postgres dump failed"
fi

# ─── 2. MinIO reports backup ────────────────────────────────────────────────

info "Backing up MinIO reports bucket..."
MINIO_CONTAINER=$(docker compose ps -q minio 2>/dev/null || echo "")
if [ -n "$MINIO_CONTAINER" ]; then
    docker compose exec -T minio sh -c "
        mkdir -p /tmp/backup-reports &&
        cp -r /data/vantax-reports/ /tmp/backup-reports/ 2>/dev/null || true
        tar -czf /tmp/reports-backup.tar.gz -C /tmp/backup-reports . 2>/dev/null || true
    " 2>/dev/null || true

    docker compose cp minio:/tmp/reports-backup.tar.gz "${BACKUP_DIR}/reports_${TIMESTAMP}.tar.gz" 2>/dev/null || \
        warn "MinIO reports backup failed — bucket may be empty"

    if [ -f "${BACKUP_DIR}/reports_${TIMESTAMP}.tar.gz" ]; then
        REPORTS_SIZE=$(du -h "${BACKUP_DIR}/reports_${TIMESTAMP}.tar.gz" | cut -f1)
        info "MinIO reports: ${BACKUP_DIR}/reports_${TIMESTAMP}.tar.gz ($REPORTS_SIZE)"
    fi
else
    warn "MinIO container not running — skipping reports backup"
fi

# ─── 3. Summary ─────────────────────────────────────────────────────────────

echo ""
info "Backup complete: ${BACKUP_DIR}/"
ls -lh "${BACKUP_DIR}/" 2>/dev/null || true
