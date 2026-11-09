# Backup and disaster recovery

The detailed procedure is in [docs/ops/backup-restore.md](../ops/backup-restore.md) and Module 9 of the [administrator training](../admin-training/meridian-administrator-training.md). This document says what the support team must have in place, who owns each part, and what the recovery objectives are. Task steps are in [runbooks.md](runbooks.md), runbook 4.

## What to protect

SAP stays the system of record. Findings can be rebuilt by extracting again. Human decisions (approvals, fixes, assignments, rule changes) and configuration cannot, so they are the data to protect. They live in PostgreSQL and object storage.

## What a backup contains

`scripts/backup.sh` writes one directory per run, `backups/<timestamp>/`, or the directory given with `--output`. It contains:

| File | Content |
|---|---|
| `manifest.json` | Time, migration head and inventory |
| `meridian.dump` | The whole database, in PostgreSQL custom format |
| `objects.tar` | Every object storage bucket, exported over S3 |
| `env.gpg` | `docker/.env`, encrypted with GPG. With `--plain-env` it is `env.txt` (mode 600) instead. |

## What a backup does not contain

| Item | Why it is not needed, or what to do |
|---|---|
| Redis | Task queue and cache only. It rebuilds as jobs run. |
| Celery beat state | Rebuilt from the schedule in the code when beat starts. |
| Docker volumes | Not copied as volumes. The database and objects are exported logically, so a backup restores onto any host. |
| Container logs | Not backed up. Logs rotate at 5 files of 50 MB per container. |
| The host itself (operating system, TLS certificates, Docker) | Not covered by `backup.sh`. Host backup and certificate copies: To confirm (owner: customer infrastructure or hosting team). |

## Two kinds of backup

| Kind | Made by | When | Kept |
|---|---|---|---|
| Scheduled backup | `scripts/backup.sh` from cron | Daily, as proposed by the backup doc (03:00, 14-day rotation) | As the cron rotation sets |
| Pre-update dump | `scripts/update.sh`, before migrations | Every update | The newest five `backups/pre-update-*.dump` files. `BACKUP_KEEP` changes the number. |

A pre-update dump holds the database only, not objects or `docker/.env`. It is for rolling back an update, not for disaster recovery. Copy a pre-update dump off the host if it must be kept longer than five updates.

## Encryption and the passphrase

`docker/.env` holds the master keys, so `backup.sh` encrypts it. A scheduled backup reads the passphrase from a root-only file given with `--passphrase-file` or `MERIDIAN_BACKUP_PASSPHRASE_FILE`. With no terminal and no passphrase file, the backup stops rather than writing `docker/.env` in clear. Do not use `--plain-env` for scheduled backups.

The passphrase is needed to restore. Store a copy away from the host, in the customer's secrets store, so that loss of the host does not also lose the passphrase. Where it is kept: To confirm (owner: customer security team).

## Required set-up on the customer deployment

These items must be in place before hand-over (exit criterion 4 in [README.md](README.md)).

1. The daily backup cron from [docs/ops/backup-restore.md](../ops/backup-restore.md) is installed, with a passphrase file. Status: To confirm (owner: customer infrastructure or hosting team).
2. Backup directories are copied off the host after each run. A backup that stays on the host does not survive loss of the host. The off-host destination: To confirm (owner: customer infrastructure or hosting team).
3. The weekly drill `scripts/backup-restore-drill.sh` is scheduled, and its exit code reaches monitoring, so that a failed drill is seen. Status: To confirm (owner: customer infrastructure or hosting team).
4. One restore drill has passed on the customer deployment and its duration is recorded.

## Drills

- `sudo bash scripts/restore.sh --drill <backup-dir>` restores into a temporary database named `meridian_drill_<timestamp>`, checks the migration head and drops the temporary database. The live database is not touched.
- `scripts/backup-restore-drill.sh` takes a fresh backup, runs the drill on it and exits non-zero if anything fails.
- The administrator training says to run `--drill` monthly. The backup doc suggests the automated drill weekly. Proposed: weekly automated drill and a monthly check of its log by the Meridian administrator (to agree).
- Before the first production use, run the 15-minute test in "Testing the runbook" in [docs/ops/backup-restore.md](../ops/backup-restore.md) on a non-production machine.

## Restore

`scripts/restore.sh` is destructive. It drops the `meridian` database and asks you to type `YES`. Use it only for a real recovery, with approval from the customer service owner.

- Exit code 3 means the restored migration head does not match the manifest. Run the migrations as the backup doc shows.
- After a restore, restart api, worker and frontend.
- Any work done after the backup was taken is lost. Tell users what period to re-check.

Full steps: "Full restore" in [docs/ops/backup-restore.md](../ops/backup-restore.md) and runbook 4.

## Disaster recovery

Use the "Disaster recovery runbook" in [docs/ops/backup-restore.md](../ops/backup-restore.md) when the host, database or volumes are lost. In outline: install Meridian on a fresh host with `scripts/meridian-deploy.sh`, stop api, worker, frontend and beat, copy the off-host backup in, run `restore.sh`, run migrations if it exits with 3, start the stack, check health, then sign in and check the tenant, users and a recent analysis.

Points to note:

- The fresh host must run the same Meridian release as the backup, or a newer one followed by migrations. Check `MERIDIAN_VERSION` in the restored `docker/.env`.
- The fresh host needs the same network access as the old one: SAP connections, Meridian HQ for the licence, and any identity provider. Check SAP connections after the restore (runbook 9).
- The Meridian and Aletheia licences may be bound to the deployment. Whether a new host needs a new licence: To confirm (owner: vendor delivery lead).
- The healthcheck port in `scripts/healthcheck.sh` may not match the customer deployment (see [known-issues.md](known-issues.md)). Use `curl -f http://localhost/health` as the check.

## Backups from before Garage

Object storage moved from MinIO to Garage. Backups taken before that release hold MinIO raw data files that Garage cannot load. `restore.sh` restores their database and reports the objects. To recover the objects, follow the steps in "What the backup does NOT cover" in [docs/ops/backup-restore.md](../ops/backup-restore.md), which use `python -m api.services.storage_migration`. Involve vendor engineering.

## Recovery objectives

The repository states no recovery point objective (RPO) or recovery time objective (RTO). The values below are proposed targets, to agree (owner: customer service owner).

| Objective | Proposed target | Basis |
|---|---|---|
| RPO | Up to 24 hours | The daily backup cron. The product has no continuous archiving or point-in-time recovery, so data written since the last backup can be lost. A shorter RPO needs more frequent backups. |
| RTO, database or data loss on a working host | About 10 minutes plus restart and checks | The backup doc's estimate for a warm host and a database under 1 GB |
| RTO, loss of the host | To confirm (owner: customer infrastructure or hosting team) | Depends on the time to provide a new host, install Docker and Meridian, and copy the backup in |

The measured RTO from the drill on the customer deployment: To confirm (owner: customer infrastructure or hosting team). Record it at hand-over and replace the proposed figures with agreed ones.

## Ownership

| Task | Owner |
|---|---|
| Install and monitor the backup cron and off-host copy | Customer infrastructure or hosting team |
| Keep the passphrase safe | Customer security team |
| Check drill results | Meridian administrator |
| Approve a destructive restore | Customer service owner |
| Run a restore or DR | Meridian administrator with the customer infrastructure or hosting team; vendor engineering consulted |
