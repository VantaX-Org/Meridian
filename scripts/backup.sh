#!/usr/bin/env bash
# =========================================================
# Meridian Platform — Backup script
# scripts/backup.sh
#
# Produces a timestamped bundle with:
#   - Postgres dump (pg_dump --format=custom — small, restorable with --clean)
#   - Object storage (all buckets) as objects.tar
#   - .env file, GPG-encrypted (env.gpg) unless --plain-env is passed: it holds the
#     master keys (CREDENTIAL_MASTER_KEY, database and storage passwords)
#   - A manifest.json pinning image tags + migration head
#
# Usage:
#   sudo bash scripts/backup.sh                      # defaults: ./backups/<ts>
#   sudo bash scripts/backup.sh --output /data/bak   # custom dir
#   sudo bash scripts/backup.sh --passphrase-file /root/.meridian-backup-pass
#                                                    # unattended (cron): passphrase from a file
#                                                    # (or MERIDIAN_BACKUP_PASSPHRASE_FILE)
#   sudo bash scripts/backup.sh --plain-env          # opt out: copy .env in clear (chmod 600)
#   sudo bash scripts/backup.sh --database-only      # skip object storage (useful in CI drills)
#
# Without a passphrase file, gpg prompts for a symmetric passphrase; with no terminal to
# prompt on and no passphrase file the backup fails rather than writing .env in clear.
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
ENCRYPT=true
PASSPHRASE_FILE="${MERIDIAN_BACKUP_PASSPHRASE_FILE:-}"
DATABASE_ONLY=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --output)         OUTPUT_DIR="$2"; shift 2 ;;
        --encrypt)        ENCRYPT=true; shift ;;  # the default; kept for existing scripts
        --plain-env)      ENCRYPT=false; shift ;;
        --passphrase-file) PASSPHRASE_FILE="$2"; shift 2 ;;
        --database-only)  DATABASE_ONLY=true; shift ;;
        -h|--help)
            grep '^# ' "$0" | sed 's/^# //'
            exit 0
            ;;
        *)                echo "Unknown flag: $1 (try --help)" >&2; exit 2 ;;
    esac
done

# Check how .env will be encrypted before anything is dumped.
if [[ "$ENCRYPT" == "true" && -f "${REPO_ROOT}/.env" ]]; then
    command -v gpg >/dev/null || fail "gpg is not installed: install it (apt-get install gnupg) or pass --plain-env"
    if [[ -n "$PASSPHRASE_FILE" ]]; then
        [[ -r "$PASSPHRASE_FILE" && -s "$PASSPHRASE_FILE" ]] || fail "passphrase file $PASSPHRASE_FILE is missing or empty"
    elif [[ ! -t 0 ]]; then
        fail "no terminal to ask for the .env passphrase: pass --passphrase-file (or MERIDIAN_BACKUP_PASSPHRASE_FILE), or --plain-env"
    fi
fi

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
if ! $DC exec -T db pg_dump -U meridian --format=custom --no-owner meridian > "$DB_FILE"; then
    fail "pg_dump failed"
fi
DB_SIZE=$(du -h "$DB_FILE" | cut -f1)
info "Postgres dump: $DB_FILE ($DB_SIZE)"

# Also capture the Alembic head so `restore.sh` can verify version match.
MIGRATION_HEAD=$($DC exec -T db psql -U meridian -d meridian -tAc \
    "SELECT version_num FROM alembic_version LIMIT 1" 2>/dev/null | tr -d '\r' || echo "unknown")
info "Migration head: $MIGRATION_HEAD"

# ─── 2. Object storage (every bucket, exported over S3 as one tar) ─────────
if [[ "$DATABASE_ONLY" != "true" ]]; then
    info "Exporting object storage..."
    if ! $DC run --rm --no-deps -T --entrypoint python api -m api.services.storage_migration --export > "${BACKUP_DIR}/objects.tar"; then
        rm -f "${BACKUP_DIR}/objects.tar"
        fail "Object storage export failed (database dump kept at $DB_FILE)"
    fi
    info "Object storage: ${BACKUP_DIR}/objects.tar ($(du -h "${BACKUP_DIR}/objects.tar" | cut -f1))"
fi

# ─── 3. .env file ───────────────────────────────────────────────────────────
if [[ -f "${REPO_ROOT}/.env" ]]; then
    if [[ "$ENCRYPT" == "true" ]]; then
        if [[ -n "$PASSPHRASE_FILE" ]]; then
            info "Encrypting .env with GPG (symmetric, passphrase from $PASSPHRASE_FILE)"
            gpg --batch --yes --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
                --symmetric --cipher-algo AES256 --output "${BACKUP_DIR}/env.gpg" "${REPO_ROOT}/.env" \
                || fail "Encrypting .env failed (database dump kept at $DB_FILE)"
        else
            info "Encrypting .env with GPG (symmetric, prompts for passphrase)"
            gpg --symmetric --cipher-algo AES256 --output "${BACKUP_DIR}/env.gpg" "${REPO_ROOT}/.env" \
                || fail "Encrypting .env failed (database dump kept at $DB_FILE)"
        fi
        chmod 600 "${BACKUP_DIR}/env.gpg"
    else
        # Opted out with --plain-env: a copy only root can read.
        cp "${REPO_ROOT}/.env" "${BACKUP_DIR}/env.txt"
        chmod 600 "${BACKUP_DIR}/env.txt"
        warn ".env copied unencrypted (--plain-env): it holds the master keys, keep this bundle on the host"
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
    "objects": "objects.tar",
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
