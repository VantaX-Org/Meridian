# Runbooks

These runbooks are for L2 support: the Meridian administrator working with the customer infrastructure or hosting team and the Basis team. Each one names the source document that holds the full detail.

## Conventions

- Run host commands from the install directory, `/opt/meridian` by default.
- `docker/docker-compose.customer.yml` is the main compose file. When an overlay is in use (updater, ollama, monitoring), add its `-f` file to the command as well.
- Commands that start with `sudo bash scripts/` need root on the host.
- Never paste secrets, licence contents or keys into tickets, chat or this pack.
- The freeze rule applies to every runbook that restarts services: do not restart or update while an extraction, sync or analysis is running unless the runbook says so. Check Runs, Jobs first.

## Contents

1. [Health check](#1-health-check)
2. [Start, stop and restart](#2-start-stop-and-restart)
3. [Update with update.sh and roll back](#3-update-with-updatesh-and-roll-back)
4. [Back up and restore](#4-back-up-and-restore)
5. [Rotate credentials](#5-rotate-credentials)
6. [Check or renew the Meridian licence](#6-check-or-renew-the-meridian-licence)
7. [Check or renew the Aletheia licence](#7-check-or-renew-the-aletheia-licence)
8. [Add or disable a user](#8-add-or-disable-a-user)
9. [Reconnect SAP](#9-reconnect-sap)
10. [Re-run a failed extraction or analysis](#10-re-run-a-failed-extraction-or-analysis)
11. [Clear disk and manage retention](#11-clear-disk-and-manage-retention)
12. [Read logs](#12-read-logs)

---

## 1. Health check

Use this at the start of a shift, after any change, and as the first step of any incident.

1. Check the containers:
   ```bash
   docker compose -f docker/docker-compose.customer.yml ps
   ```
   Every core service (nginx, api, worker, beat, frontend, db, redis, storage) should be running. Services with a health check should show healthy.
2. Check the API through the front door:
   ```bash
   curl -s http://127.0.0.1/health
   ```
   The response should contain `"status":"ok"` and the running version. A 503 with `degraded` means PostgreSQL or Redis is not answering; go to step 5.
3. Check the pinned release:
   ```bash
   grep MERIDIAN_VERSION /opt/meridian/docker/.env
   ```
4. In the application, open Administration and run the doctor (`GET /api/v1/admin/doctor`, needs the manage_system permission). It checks PostgreSQL, Redis, storage, the language model, the licence and migrations. Open the `/status` screen for recent health samples.
5. If a dependency is down, read its logs ([runbook 12](#12-read-logs)) and restart only that service ([runbook 2](#2-start-stop-and-restart)).

Note: `scripts/healthcheck.sh` calls `localhost:8000/health`. The customer compose file publishes no api port on the host, so this script will probably fail on the customer deployment. Use the `curl` command in step 2 instead. Whether `healthcheck.sh` is meant for the customer deployment is To confirm (owner: vendor engineering).

Source: [docs/meridian-update-guide.md](../meridian-update-guide.md), [docs/ops/monitoring.md](../ops/monitoring.md).

## 2. Start, stop and restart

Check Runs, Jobs before you stop or restart worker or beat. A restart stops running jobs.

Start the stack (include the overlays the deployment uses):
```bash
docker compose -f docker/docker-compose.customer.yml up -d
```

To start with the Aletheia sidecar, include its profile:
```bash
docker compose -f docker/docker-compose.customer.yml --profile aletheia up -d
```

Restart one service:
```bash
docker compose -f docker/docker-compose.customer.yml restart worker
```

Stop the stack without removing data:
```bash
docker compose -f docker/docker-compose.customer.yml stop
```

Do not run `down -v`. It removes the named volumes (`postgres_data`, `redis_data`, `storage_data`, `aletheia_data`) and with them all data.

Restart order, if services are restarted one by one: db, redis and storage first; then api; then worker, beat and frontend; nginx last. nginx waits for frontend, api and storage to be healthy.

A job that stays in "running":
1. `docker compose -f docker/docker-compose.customer.yml ps worker`
2. `docker compose -f docker/docker-compose.customer.yml logs worker --tail 100`
3. `docker compose -f docker/docker-compose.customer.yml exec redis redis-cli ping` (expect `PONG`)
4. `docker compose -f docker/docker-compose.customer.yml restart worker`
5. Re-run the job ([runbook 10](#10-re-run-a-failed-extraction-or-analysis)).

Source: [docs/troubleshooting.md](../troubleshooting.md).

## 3. Update with update.sh and roll back

Read [change-and-release-management.md](change-and-release-management.md) first. Full detail is in [docs/meridian-update-guide.md](../meridian-update-guide.md).

Before you start:
1. Confirm no extraction, sync or analysis is running (Runs, Jobs). `update.sh` refuses to start while a `run_extraction` or `run_checks` task is active. `MERIDIAN_UPDATE_FORCE=1` overrides this; do not use it in production without approval.
2. Confirm at least 10 GB of free disk. If short, run `docker image prune -f` and `docker builder prune -f`.
3. Take a full backup ([runbook 4](#4-back-up-and-restore)). `update.sh` dumps the database itself, but not object storage or `.env`.

Update from the user interface: Administration, Platform and updates, **Update now**. This needs the updater overlay.

Update from the host:
```bash
cd /opt/meridian
sudo bash scripts/update.sh                  # the release Meridian HQ names as latest
sudo bash scripts/update.sh --version X.Y.Z  # a named release; required offline
```

What the script does, in order: snapshots running images as `:rollback`; pulls the new release; syncs deployment files from the api image; re-applies HTTPS and the DNS overlay; dumps the database to `backups/pre-update-<UTC>.dump` and keeps the 5 newest (`BACKUP_KEEP`); pins the release in `.env`; migrates object storage once if needed; recreates api, worker, beat, frontend and nginx and starts aletheia; runs `alembic upgrade head`; waits up to 300 seconds for `/health` to report `"status":"ok"` and for the front door to answer.

If the migration or health check fails, the script rolls back by itself and prints the restore command for the dump it took.

After the update:
1. Run the health check ([runbook 1](#1-health-check)).
2. Confirm the new version in `/health` and in Administration.

Roll back by hand:
```bash
sudo bash scripts/update.sh --rollback
```
This returns images and `MERIDIAN_VERSION` to `MERIDIAN_PREVIOUS_VERSION`. It does not undo database migrations. The older release usually runs on the newer schema (the "Rollback schema check" workflow tests this), so most rollbacks need nothing more.

If the older release cannot read the newer schema, take the schema back with the down-migrations before `--rollback`, while the newer images still run:
1. Find the head revision of the older release: run `docker compose -f docker/docker-compose.customer.yml run --rm api alembic heads` on the `:rollback` image, or read it from that release's notes.
2. Downgrade from the newer image: `docker compose -f docker/docker-compose.customer.yml run --rm api alembic downgrade <revision>`.
3. Check with `docker compose -f docker/docker-compose.customer.yml run --rm api alembic current`.
4. Then run `sudo bash scripts/update.sh --rollback`.

Down-migrations take the schema back. They do not bring back data. Some of them delete rows the newer release added (seeded rules, packs, settings or rows of a new type): revisions 059, 067, 072, 075, 109, 117, 121, 125, 126, 128, 131, 141, 142 and 145. Revisions 088 and 094 only fix data, and keep it on downgrade. Revision 030 refuses to go lower while any connected system has no host, client or system number (cloud connections), because the older schema cannot hold them; it stops with a `NotImplementedError` that says so. Revisions 061, 084, 103, 135 and 139 commit their own steps, so a downgrade that fails can stop part way. Run `alembic current` to see where it stopped, and `alembic upgrade head` to return.

When a downgrade is refused or would lose data you need, restore the pre-update dump instead:
```bash
docker compose -f docker/docker-compose.customer.yml exec -T db pg_restore -U meridian -d meridian --clean --if-exists < backups/pre-update-<UTC>.dump
```
Use the exact dump file name the script printed.

Updating the updater sidecar itself is a separate, rare step: `sudo bash scripts/update.sh --include-updater`.

## 4. Back up and restore

Full detail: [docs/ops/backup-restore.md](../ops/backup-restore.md) and [backup-and-dr.md](backup-and-dr.md).

Take a backup:
```bash
sudo bash scripts/backup.sh --passphrase-file /root/.meridian-backup-pass --output /var/backups/meridian
```
Options: `--output DIR`, `--passphrase-file F` (or `MERIDIAN_BACKUP_PASSPHRASE_FILE`), `--plain-env`, `--database-only`, `--encrypt`. A backup directory holds `manifest.json`, `meridian.dump`, `objects.tar` and `env.gpg` (or `env.txt` with `--plain-env`). Store the passphrase separately from the backups.

Test a backup without touching production:
```bash
sudo bash scripts/restore.sh --drill /path/to/backup-dir
```

Restore (destructive: it drops the `meridian` database; you must type `YES`):
1. Stop users from working and confirm no job is running.
2. Run:
   ```bash
   sudo bash scripts/restore.sh /path/to/backup-dir
   ```
3. Read the exit code: 0 success; 1 error; 2 bad arguments; 3 migration head does not match. For exit code 3, run:
   ```bash
   docker compose -f docker/docker-compose.customer.yml run --rm api alembic upgrade head
   ```
4. Restart:
   ```bash
   docker compose -f docker/docker-compose.customer.yml restart api worker frontend
   ```
5. Run the health check ([runbook 1](#1-health-check)).

## 5. Rotate credentials

Plan rotations outside working hours and outside running jobs. Record what was rotated, not the values.

### Credential master key (encrypts stored SAP and connector credentials)

1. Generate the new key by the method the customer security team approves. The repository does not state the key format here; To confirm (owner: vendor engineering).
2. Dry run:
   ```bash
   OLD_MASTER_KEY=... NEW_MASTER_KEY=... python scripts/rotate-credential-key.py --dry-run
   ```
   Where to run the script (host or api container) is To confirm (owner: vendor engineering).
3. Run the same command without `--dry-run`.
4. In `docker/.env`, set `CREDENTIAL_MASTER_KEY` to the new key and `CREDENTIAL_MASTER_KEY_PREV` to the old key. Restart api and worker.
5. Once all is well, remove `CREDENTIAL_MASTER_KEY_PREV` and restart api and worker again.
6. Rollback: run the script again with OLD and NEW swapped.

### Other secrets

| Secret | Env var | Procedure |
|---|---|---|
| Database password | `DB_PASSWORD` | To confirm (owner: vendor engineering). The database user must be changed in PostgreSQL and in `.env` together. |
| Object storage keys | `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_PASSWORD` | To confirm (owner: vendor engineering) |
| HQ session signing secret | `JWT_SECRET` (licence worker) | Vendor only. Built-in overlap with `JWT_SECRET_PREVIOUS`, see [HQ signing keys](#hq-signing-keys) below. |
| Licence signing key | `LICENCE_SIGNING_KEY_ED25519` (licence worker) | Vendor only. Overlap through the public key list in the image, see [HQ signing keys](#hq-signing-keys) below. `OFFLINE_JWT_PRIVATE_KEY` is the legacy RSA key and is not rotated; it is removed when the legacy window closes. |
| Updater secret | `UPDATER_SHARED_SECRET` | Change in `.env`, then recreate api and updater. Exact steps to confirm (owner: vendor engineering). |
| Aletheia access token | `ALETHEIA_TOKEN` | Generate with `openssl rand -hex 32`, set in `.env`, then run `sudo bash scripts/update.sh --version <the running version>` |
| SCIM token | n/a | Administration, Users: rotate or revoke |
| API keys | n/a | Administration, Users: API keys |
| SAP RFC user password | n/a | Basis team changes it in SAP; the Meridian administrator updates the system connection ([runbook 9](#9-reconnect-sap)) |

### HQ signing keys

These two keys live only in the Meridian HQ licence worker in Cloudflare, never on a customer server. Vendor engineering rotates them; a customer site does nothing for the first and takes a normal update for the second.

**HQ session signing secret (`JWT_SECRET`).** The worker signs HQ portal admin and tenant-user sessions with this secret and accepts a second, optional secret, `JWT_SECRET_PREVIOUS`, during a rotation. New sessions are always signed with `JWT_SECRET`, and a session signed with either secret is accepted, so nobody is signed out. To rotate, copy the current value into `JWT_SECRET_PREVIOUS` with `npx wrangler secret put JWT_SECRET_PREVIOUS`, then set a new value with `npx wrangler secret put JWT_SECRET` (for example from `openssl rand -hex 32`). Sessions last 8 hours, so after 8 hours remove the old one with `npx wrangler secret delete JWT_SECRET_PREVIOUS`. To roll back inside the window, put the old value back into `JWT_SECRET`. Revocation through `admin_sessions` keeps working throughout. Never paste either value into a ticket, log or chat.

**Licence signing key (`LICENCE_SIGNING_KEY_ED25519`).** The worker signs licence responses, offline licence tokens and offline licence files with one Ed25519 private key. The API verifies against every public key listed in `VENDOR_LICENCE_PUBLIC_KEYS` in `api/middleware/licence_keys.py`, so the overlap comes from that list. To rotate, generate the new key pair as in `cloudflare/licence-worker/DEPLOY_RUNBOOK.md` Step 1, add the new public key first in the list while keeping the old one, and ship and roll out that release to every site. Then set the new private key with `npx wrangler secret put LICENCE_SIGNING_KEY_ED25519`. Offline tokens already issued with the old key keep verifying while the old public key is listed. Re-issue those tokens before the next release, which drops the old public key. A site that has not taken the release with the new public key rejects licences signed with the new private key, so check every site's version before switching the secret.

See [access-and-security-operations.md](access-and-security-operations.md).

## 6. Check or renew the Meridian licence

1. Open Administration, Licence. Check status, expiry and licensed modules.
2. Click **Check with Meridian HQ now** (online mode).
3. Read the status:
   - Valid: no action.
   - `offline_grace`: the licence server could not be reached. Responses carry `X-Licence-Warning: offline_grace`. The grace lasts `MERIDIAN_LICENCE_OFFLINE_GRACE_DAYS` (default 14, at most 30). Restore network access to the licence server before it ends.
   - 403 `licence_server_cutoff` on gated screens: the grace has ended. S1.
   - 402 on a screen: that module is not licensed. Not a fault; route to the customer service owner.
4. To renew or replace: obtain the new key or offline token from vendor engineering through the agreed channel. Set `MERIDIAN_LICENCE_KEY` (online) or `MERIDIAN_LICENCE_TOKEN` (offline) in `docker/.env`, then recreate the api. The exact recreate command is To confirm (owner: vendor engineering); `sudo bash scripts/update.sh --version <the running version>` recreates the application services.
5. Re-check the Licence screen.

The commercial renewal process and lead time are To confirm (owner: vendor delivery lead).

The `meridianctl licence status` command also reports licence status. It is documented for air-gapped deployments.

## 7. Check or renew the Aletheia licence

1. Open Administration, Aletheia engine. The verdict is one of, in order of checking: Not configured, Not answering, No access token, Unlicensed, Licence not valid. A healthy engine shows none of these.
2. For each verdict:
   - Not configured: `ALETHEIA_URL` is not set, or the profile is not started.
   - Not answering: the `aletheia` container is down. Check `docker compose -f docker/docker-compose.customer.yml --profile aletheia ps` and its logs.
   - No access token: set `ALETHEIA_TOKEN`.
   - Unlicensed: `ALETHEIA_LICENSE_KEY` is empty.
   - Licence not valid: the key is wrong, expired, or does not match `ALETHEIA_DEPLOYMENT_ID` (default `meridian`).
3. After any change to these settings in `docker/.env`, run:
   ```bash
   sudo bash scripts/update.sh --version <the running version>
   ```
4. Re-check the Aletheia engine screen.

The Aletheia licence renewal process is To confirm (owner: vendor delivery lead).

## 8. Add or disable a user

Use the user interface. Full detail is in [frontend/docs/guide/administration.md](../../frontend/docs/guide/administration.md) and [docs/admin-training/](../admin-training/).

Add a user:
1. Administration, Users, invite the user by email. The invitation expires after 7 days.
2. Grant roles. Roles can be scoped to a system or an object.
3. Check the seat meter.

For many users, use CSV import on the same screen. With SSO, users can be provisioned by SCIM at `/scim/v2`.

Disable a user: Administration, Users, deactivate the user. With SCIM, deactivate the user in the identity provider instead.

Locked account: 10 failed sign-ins lock the account for 15 minutes. Wait, or reset the password from Administration, Users. Sign-in events are in the audit log (`auth.login`, `auth.login_failed`, `auth.lockout`, `auth.logout`, `auth.password_change`, `auth.sso_*`).

A command-line tool exists (`docker compose exec api python scripts/manage_users.py create|list|reset-password|deactivate --email ...`) but it uses a hard-coded development tenant id. Do not use it on the customer deployment until vendor engineering confirms it acts on `MERIDIAN_TENANT_ID`. To confirm (owner: vendor engineering).

## 9. Reconnect SAP

Use this when the connection test fails, the SAP password changed, or the SAP host moved. Detail: [docs/sap-connector.md](../sap-connector.md) and [docs/journeys/basis-operations.md](../journeys/basis-operations.md).

1. Open Objects, Connect a system (`/s/new`), or open the existing system's settings.
2. Check or update Host, Client, Instance number and User. The default RFC user is set by `SAP_RFC_USER`.
3. Enter the new password if it changed. Click **Test connection**.
4. If the test fails:
   - HTTP 401 or a refused credential: the Basis team checks the user is not locked and the password is right.
   - "No authorisation to read this table": the Basis team runs SU53 for the RFC user and adjusts the role. Template: [docs/sap/authorisation-role-template.md](../sap/authorisation-role-template.md).
   - Network or DNS failure: the customer infrastructure team checks routing from the host to SAP. The DNS overlay uses `MERIDIAN_DNS_1` and `MERIDIAN_DNS_2`.
5. The table reader function is set by `MERIDIAN_RFC_READ_FUNCTION`. The read path is the per-system extraction path setting. Change these only on advice from vendor engineering.
6. After a successful test, re-run the failed extraction ([runbook 10](#10-re-run-a-failed-extraction-or-analysis)).

Beat tests every SAP connection every 30 minutes (`check_all_systems`), so a recovered connection shows on its own within that time.

## 10. Re-run a failed extraction or analysis

1. Open Runs, Jobs. Open the failed job and read its error.
2. Fix the cause first (SAP connection, authorisation, disk, worker).
3. Click **Retry** on the job. Or start a new run from Administration, Start and schedule.
4. The Basis home lists failed jobs for triage.
5. Delta extractions take a full extraction every `MERIDIAN_DELTA_FULL_DAYS` days (default 7).
6. If the retry also stays in "running", follow the stuck-job steps in [runbook 2](#2-start-stop-and-restart).

Do not start an update while the re-run is in progress.

## 11. Clear disk and manage retention

Check free disk on the host with the customer's normal tools. `update.sh` needs 10 GB free.

Safe cleanup of Docker build data:
```bash
docker image prune -f
docker builder prune -f
```

Do not delete Docker volumes. Do not delete files in `backups/` without checking that newer backups exist and have been copied off the host. `update.sh` keeps only the 5 newest pre-update dumps on its own.

Container logs are capped at 50 MB per file and 5 files per service, so they do not grow without limit.

Application retention ([docs/CUSTOMER_INSTALL_GUIDE.md](../CUSTOMER_INSTALL_GUIDE.md), section "Retention and purge"):
1. Set the policy in Administration, Settings, Retention: days to keep runs, reports and audit rows, newest runs per system to keep, and whether to keep the pinned baseline. Use **Preview what would be purged**.
2. The nightly purge (02:30 UTC) runs as a dry run and writes to the purge log.
3. To enforce, set `MERIDIAN_PURGE_ENABLED=true` in `.env` and restart worker and beat. Deletion starts only when the oldest dry-run entry is at least 7 days old.

Process events are pruned separately at 03:15 UTC.

## 12. Read logs

Logs are JSON by default (`LOG_FORMAT`). Level is set by `LOG_LEVEL`. Each entry carries `SERVICE_NAME`.

```bash
docker compose -f docker/docker-compose.customer.yml logs api --tail 100
docker compose -f docker/docker-compose.customer.yml logs worker --tail 100
docker compose -f docker/docker-compose.customer.yml logs db --tail 100
docker compose -f docker/docker-compose.customer.yml logs storage | grep '^storage:'
```

The last storage setup line should be `storage: ready`.

To find a user's error, search the api log for the 8-character error reference the user saw:
```bash
docker compose -f docker/docker-compose.customer.yml logs api | grep <error reference>
```

For the language model overlay, the service name is `ollama` in `docker/docker-compose.customer.ollama.yml`. [docs/troubleshooting.md](../troubleshooting.md) uses `llm`; use the name in the overlay file.

For vendor support, prefer the diagnostics bundle (Administration, **Download diagnostics bundle**) over raw logs.
