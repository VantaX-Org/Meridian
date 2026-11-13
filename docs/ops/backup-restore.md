# Backup & Restore Runbook

This is the operator-facing runbook for Meridian backups. Read it **before** you need it.

## What's in a backup

A backup bundle produced by `scripts/backup.sh` is a directory:

```
backups/20260424_031500/
├── manifest.json            # timestamp, migration_head, inventory
├── meridian.dump            # pg_dump --format=custom (restorable with pg_restore)
├── objects.tar              # every object-storage bucket, exported over S3
└── env.gpg | env.txt        # .env file, GPG-encrypted unless --plain-env
```

Total bundle size for a typical customer: ~100 MB to a few GB, depending on how much raw SAP extract has been uploaded.

## Taking a backup

### Ad-hoc

```bash
sudo bash scripts/backup.sh
```

Produces `backups/<utc-timestamp>/` under the repo root. After a successful run it removes the oldest bundles so only the newest 14 remain: `--keep N` (or `MERIDIAN_BACKUP_KEEP`) changes the number and `--keep 0` keeps all. Only bundle directories with a `manifest.json` count; `pre-update-*.dump` files belong to `update.sh`, which rotates them itself.

The backup is safe to run while Meridian is in use. `pg_dump` reads one consistent snapshot without blocking the app, and the object export reads over S3. Nothing needs to stop.

### The .env file is encrypted

`.env` holds the master keys (credential key, database and storage passwords), so the backup encrypts it with
GPG by default: it prompts for a symmetric passphrase and writes `env.gpg`. Unattended runs (cron) read the
passphrase from a root-only file:

```bash
sudo bash scripts/backup.sh --passphrase-file /root/.meridian-backup-pass
# or: MERIDIAN_BACKUP_PASSPHRASE_FILE=/root/.meridian-backup-pass sudo -E bash scripts/backup.sh
```

With no terminal and no passphrase file the backup stops instead of writing `.env` in clear. To opt out, pass
`--plain-env`: it writes `env.txt` (mode 600). `restore.sh` reads the same `MERIDIAN_BACKUP_PASSPHRASE_FILE`
when set, and otherwise prompts.

### Custom output location

```bash
sudo bash scripts/backup.sh --output /mnt/backups
```

### Automated (installed by default)

`scripts/install.sh` schedules the nightly backup at the end of an install. On a host installed before this, run once:

```bash
sudo bash /opt/meridian/scripts/backup.sh --install-timer
# options: --output /var/backups/meridian  --keep 30  --passphrase-file /root/.meridian-backup-pass
```

It installs the systemd timer `meridian-backup.timer` (03:00, up to 15 minutes random delay, catches up after the host was off), or, on a host without systemd, `/etc/cron.d/meridian-backup`. Running it again rewrites the same schedule, so it is safe to repeat, for example to change `--keep`. If the passphrase file does not exist, it creates one with a random passphrase and says so: copy that file to the customer's secrets store at once, because `env.gpg` cannot be decrypted without it.

Check it: `systemctl list-timers meridian-backup.timer` and `journalctl -u meridian-backup` (or `/var/log/meridian-backup.log` with cron).

## Restoring a backup

### The restore is destructive

`scripts/restore.sh` **drops the `meridian` database** before restoring. All data currently in the DB will be lost unless it's in the backup you're restoring. You'll be prompted to type `YES` before it proceeds. `--yes` skips the prompt for scripted use; with no terminal and no `--yes` it refuses.

### Full restore (production incident response)

```bash
sudo bash scripts/restore.sh /path/to/backups/20260424_031500
```

Steps it performs:
1. Parses `manifest.json` for expected migration head, and checks the dump: it must start with the pg_dump signature and `pg_restore` must read it end to end. A damaged or truncated dump stops the restore before anything changes.
2. Asks for `YES` (unless `--yes`).
3. Stops `api`, `worker` and `beat`, so nothing writes while the database is replaced.
4. Dumps the current database to `backups/pre-restore-<UTC>.dump`, a way back if the wrong bundle was picked (it only warns if that dump fails, since a broken database is often why you restore).
5. Drops the `meridian` database `WITH (FORCE)`, which ends any session still open, and recreates it empty.
6. `pg_restore` the dump.
7. Verifies the `alembic_version` row matches the manifest — if not, exits with code 3 and a warning telling you to `alembic upgrade head`.
8. Imports `objects.tar` into object storage (objects added after the backup are left in place), and restores (or decrypts) the `.env` file.
9. Starts `api`, `worker` and `beat` again. The api runs migrations as it starts.

If a step fails after step 3, the script leaves `api`, `worker` and `beat` stopped on purpose, because the database may be half-restored, and prints the command to start them. Fix the cause and run `restore.sh` again.

If `.env` changed with the restore, recreate the containers so they read it:

```bash
docker compose -f docker/docker-compose.customer.yml up -d
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
   Leave `db`, `redis`, `storage` running — the restore targets them.
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

- **Redis** — task queue, locks and response cache. It writes an append-only file to its `redis_data` volume, so queued tasks survive a Redis or host restart, but it is not part of a backup. A restored system rebuilds it as jobs run.
- **Celery beat state** — rescheduled automatically from `workers/scheduler.py` on first beat start.
- **Docker volumes themselves** — the database and objects are exported logically (`pg_dump`, S3), so a backup restores onto any host; logs are not backed up.
- **Backups taken before the Garage release** hold MinIO's raw data files (`meridian-*.tar.gz`), which Garage cannot load. `restore.sh` restores their database and says so for the objects; to recover those objects, start the old MinIO on an empty volume, untar into `/data`, and run `python -m api.services.storage_migration --source-endpoint <that-minio>:9000` in the api image.

## Testing the runbook

Do this before production. It takes 15 minutes.

1. Take a backup on a dev machine.
2. Write some recognisable data (a new tenant, a rule change).
3. Take a *second* backup.
4. Run `scripts/restore.sh --drill <first-backup>` — verify the drill DB has the pre-scribble state.
5. Run `scripts/restore.sh <first-backup>` for real.
6. Log into the UI and verify the scribble is gone and the first-backup state is back.

If step 6 matches expectations, your runbook works. File any divergence as a bug against this doc.
