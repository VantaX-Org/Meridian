# Backup & Restore Runbook

This is the operator-facing runbook for Meridian backups. Read it **before** you need it.

## What's in a backup

A backup bundle produced by `scripts/backup.sh` is a directory:

```
backups/20260424_031500/
├── manifest.json            # timestamp, migration_head, inventory
├── meridian.dump            # pg_dump --format=custom (restorable with pg_restore)
├── meridian-uploads.tar.gz  # MinIO uploads bucket
├── meridian-reports.tar.gz  # MinIO reports bucket
└── env.txt | env.gpg        # .env file (optionally GPG-encrypted)
```

Total bundle size for a typical customer: ~100 MB to a few GB, depending on how much raw SAP extract has been uploaded.

## Taking a backup

### Ad-hoc

```bash
sudo bash scripts/backup.sh
```

Produces `backups/<utc-timestamp>/` under the repo root. Each run is independent — clean up old ones with a cron or manually.

### With GPG-encrypted .env

```bash
sudo bash scripts/backup.sh --encrypt
```

Prompts for a symmetric passphrase. Writes `env.gpg` instead of `env.txt`. Recommended for anything leaving the customer's machine.

### Custom output location

```bash
sudo bash scripts/backup.sh --output /mnt/backups
```

### Automated (recommended)

Add a daily cron on the Meridian host:

```cron
# Daily backup at 03:00, rotates at 14 days
0 3 * * * /opt/meridian/scripts/backup.sh --output /var/backups/meridian && \
          find /var/backups/meridian -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
```

## Restoring a backup

### The restore is destructive

`scripts/restore.sh` **drops the `meridian` database** before restoring. All data currently in the DB will be lost unless it's in the backup you're restoring. You'll be prompted to type `YES` before it proceeds.

### Full restore (production incident response)

```bash
sudo bash scripts/restore.sh /path/to/backups/20260424_031500
```

Steps it performs:
1. Parses `manifest.json` for expected migration head.
2. Drops `meridian` database and recreates it empty.
3. `pg_restore` the dump.
4. Verifies the `alembic_version` row matches the manifest — if not, exits with code 3 and a warning telling you to `alembic upgrade head`.
5. Restores MinIO buckets.
6. Restores (or decrypts) the `.env` file.

After restore completes successfully, restart the stack:

```bash
docker compose -f docker/docker-compose.customer.yml restart api worker frontend
```

### Verifying a backup without touching production (the drill)

`scripts/restore.sh --drill` creates a *temporary* database (`meridian_drill_<timestamp>`), restores into that, verifies the migration head, and drops it. The live `meridian` database is never touched.

```bash
sudo bash scripts/restore.sh --drill /path/to/backups/20260424_031500
```

Use this before trusting a backup — e.g. once a week, or before a major upgrade.

### Fully automated weekly drill

`scripts/backup-restore-drill.sh` is an end-to-end script that:
1. Snapshots row counts from the live DB.
2. Takes a fresh backup.
3. Runs `restore.sh --drill` against it.
4. Exits non-zero if anything broke.

Wire into cron:

```cron
# Weekly drill at Sunday 03:00
0 3 * * 0 /opt/meridian/scripts/backup-restore-drill.sh >> /var/log/meridian-drill.log 2>&1
```

Hook the exit code into your monitoring so a failed drill pages someone.

## Disaster recovery runbook

Things have broken badly — the DB is gone, the volume is corrupt, the host died. You have a backup off-box.

1. **Provision a fresh host** with Meridian installed (`scripts/meridian-deploy.sh`). Don't configure connectivity yet — we'll restore it from backup.
2. **Stop the services** so no writes happen during restore:
   ```bash
   docker compose -f docker/docker-compose.customer.yml stop api worker frontend beat
   ```
   Leave `db`, `redis`, `minio` running — the restore targets them.
3. **Copy the backup** to the host (e.g. `/tmp/restore-bundle`).
4. **Run restore**:
   ```bash
   sudo bash scripts/restore.sh /tmp/restore-bundle
   ```
5. **Run migrations** if restore reports an exit code of 3 (migration head mismatch):
   ```bash
   docker compose -f docker/docker-compose.customer.yml run --rm api alembic upgrade head
   ```
6. **Restart** services:
   ```bash
   docker compose -f docker/docker-compose.customer.yml up -d
   ```
7. **Smoke-check**:
   ```bash
   bash scripts/healthcheck.sh
   curl -f http://localhost/health
   ```
8. **Log in to the dashboard** and verify the tenant, users, and at least one recent analysis are present.

Expected recovery time on a warm host: ~10 minutes for a typical customer (<1 GB DB).

## What the backup does NOT cover

- **Redis** — contains ephemeral data only (task queue, response cache). A restored system will rebuild it as jobs run.
- **Celery beat state** — rescheduled automatically from `workers/scheduler.py` on first beat start.
- **Docker volumes other than `postgres_data` and `minio_data`** — intentional; logs are not backed up.

## Testing the runbook

Do this before production. It takes 15 minutes.

1. Take a backup on a dev machine.
2. Write some recognisable data (a new tenant, a rule change).
3. Take a *second* backup.
4. Run `scripts/restore.sh --drill <first-backup>` — verify the drill DB has the pre-scribble state.
5. Run `scripts/restore.sh <first-backup>` for real.
6. Log into the UI and verify the scribble is gone and the first-backup state is back.

If step 6 matches expectations, your runbook works. File any divergence as a bug against this doc.
