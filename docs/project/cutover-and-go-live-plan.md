# Cutover and go-live plan

This plan installs release v0.0.633 on the customer deployment. It is based on [docs/live-deployment-checklist.md](../live-deployment-checklist.md) and [docs/meridian-update-guide.md](../meridian-update-guide.md). Those two documents are the source. If they differ from this plan, they win.

The roles are those of the deployment checklist: the customer administrator, SAP Basis, the SAP team and the vendor engineer. The release manager leads the cutover.

Cutover date and window: To confirm (Release manager).

## 1. Pre-checks (the day before)

| # | Check | Owner |
|---|---|---|
| 1.1 | The release build for v0.0.633 has finished and the six images are published. | Release manager |
| 1.2 | CI is green on the merge commit for PR #639. | Release manager |
| 1.3 | The host has at least 10 GB of free disk. The update needs it. | Customer administrator |
| 1.4 | A recent backup exists and a restore drill has passed (`restore.sh --drill`). See [docs/ops/backup-restore.md](../ops/backup-restore.md). | Customer administrator |
| 1.5 | The host can pull from `ghcr.io`. | Customer administrator |
| 1.6 | The engine settings are ready to append to `docker/.env`, if the engine is to run licensed. The settings are ALETHEIA_DEPLOYMENT_ID, ALETHEIA_LICENSE_KEY, ALETHEIA_TOKEN and MERIDIAN_ALETHEIA_IMAGE. A person with sudo on the server must append them. Values are never written in the repository. | Customer administrator |
| 1.7 | A tester with each role in the acceptance test is booked. Testers use codes such as AT-1. | Test lead |
| 1.8 | The rollback decision maker is named. | Project sponsor |

## 2. Freeze

1. Tell users of the cutover window. Message and channel: To confirm (Project manager).
2. Stop new extractions, syncs and runs. Check Operations, Jobs. The update script refuses to run while an extraction or run is going.
3. Do not use `MERIDIAN_UPDATE_FORCE=1` during the cutover. It overrides the job check.
4. Freeze merges to main until the verification in step 4 passes. A newer push to main cancels a running release build.

## 3. Deploy

Run on the server, from the install folder, as a user with sudo.

```bash
sudo bash scripts/update.sh --version 0.0.633
```

The script does these steps in order:

1. It refuses to run while an extraction or run is going.
2. It snapshots the images of the running release as `:rollback`.
3. It pulls the v0.0.633 images, copies the deployment files out of the api image, and pulls the engine image on a best-effort basis.
4. It writes a database backup to `backups/pre-update-<time>.dump`. From this release it then keeps only the newest five pre-update dumps. `BACKUP_KEEP` changes that number. Other dumps are not touched.
5. It writes `MERIDIAN_VERSION=v0.0.633` to `docker/.env` and keeps the old tag as `MERIDIAN_PREVIOUS_VERSION`.
6. It recreates api, worker, beat, frontend and nginx, runs `alembic upgrade head`, and waits up to 300 seconds for `/health`.
7. It starts the engine with the `aletheia` service. A failure here is a warning only.

If the migration or the health check fails, the script rolls back on its own.

If the engine settings were appended after the update, run the update again for the running version, as the administrator training says:

```bash
sudo bash scripts/update.sh --version 0.0.633
```

## 4. Verification

| # | Check | How | Pass |
|---|---|---|---|
| 4.1 | Version | `grep MERIDIAN_VERSION docker/.env` | Shows v0.0.633 |
| 4.2 | Version in the container | Read `/app/VERSION` inside the API container | Shows the same release |
| 4.3 | Services | `docker compose -f docker/docker-compose.customer.yml ps` | All services are up and healthy |
| 4.4 | Health | `curl -s http://127.0.0.1/health` on the host, or `/health` on the site address | Returns 200 with "status": "ok" |
| 4.5 | Alembic head | `docker compose -f docker/docker-compose.customer.yml exec -T api bash -c "cd /app && alembic current"` | Shows revision 149. This release adds no migrations. |
| 4.6 | No tracebacks | `docker compose -f docker/docker-compose.customer.yml logs api --tail 100` | No `Traceback` since the update |
| 4.7 | API docs closed | Open `/docs` on the site | Returns 404 |
| 4.8 | Key routes | Sign in, then open Runs, an object, Fix, Migration, Monitors, Administration and Help | Each page opens with data and no error |
| 4.9 | Engine | Open Administration, Engine. The new route is `/api/v1/aletheia/engine`. | Shows the engine state. Unlicensed is expected until the licence settings are appended. |
| 4.10 | Acceptance | Run [docs/journeys/go-live-acceptance-test.md](../journeys/go-live-acceptance-test.md) | Sections 1 to 3 pass. A fail stops the release. |

## 5. Rollback

Decide to roll back if a check in 4.1 to 4.6 fails, or if sections 1 to 3 of the acceptance test fail.

```bash
sudo bash scripts/update.sh --rollback
```

- This returns to `MERIDIAN_PREVIOUS_VERSION` and recreates the services on the `:rollback` images.
- A rollback does not undo database changes. This release adds no migrations, so no restore is expected. If a restore is needed, use the pre-update dump that the script named in its output. See [docs/ops/backup-restore.md](../ops/backup-restore.md).
- After a rollback, run checks 4.1, 4.3, 4.4 and 4.6 again.
- Record the reason in the [RAID log](raid-log.md).

## 6. Hyper-care

- Watch the API log for tracebacks and the job queue for failed jobs each day. See [docs/ops/monitoring.md](../ops/monitoring.md).
- Collect a diagnostics bundle for any defect, as in section 11 of the deployment checklist. Send only what section 12 allows. Never send SAP record values.
- Raise defects found in sections 4 to 6 of the acceptance test. The release may stay live for those.
- The first week with users follows [docs/journeys/first-live-week.md](../journeys/first-live-week.md).
- Hyper-care length and exit criteria: To confirm (Project sponsor).
- At the end of hyper-care, hand over to support. See [docs/sustain/README.md](../sustain/README.md).

## 7. Go or no-go

| Role | Decision | Date |
|---|---|---|
| Release manager | To confirm | To confirm |
| Test lead | To confirm | To confirm |
| Customer administrator | To confirm | To confirm |
| Project sponsor | To confirm | To confirm |
