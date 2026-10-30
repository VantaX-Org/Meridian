# Operations

How the product is installed, upgraded, backed up, monitored and scaled, as the scripts in this
repository implement it. Where a promise is not backed by a script it says so. Measured at commit
`5cf7161c`.

## 1. Deployment

```
customer host (Linux, Docker Engine + Compose v2)
  scripts/install.sh  ->  scripts/meridian-deploy.sh  (interactive: domain, SSL mode, LLM tier, licence)
     writes .env (DB passwords, meridian_app role, JWT and credential keys, licence key)
     docker compose -f docker/docker-compose.customer.yml up -d
        nginx:80/443 -> frontend:3000, api:8000
        api (alembic upgrade head at start, then uvicorn --workers ${API_WORKERS:-3})
        worker (celery --concurrency=4), beat, db (postgres:16-alpine), redis (redis:7-alpine),
        storage (meridian-garage, S3 on :9000), updater (optional), ollama (optional overlay)
```

| Path | What | Reference |
|---|---|---|
| Docker Compose | the supported production path; images from `ghcr.io/vantax-org/meridian-*`, private registry access per `docs/GHCR-PRIVATE-SETUP.md` | `docker/docker-compose.customer.yml`, `docs/customer-deployment.md`, `docs/CUSTOMER_INSTALL_GUIDE.md` |
| Air-gapped | images exported with `scripts/export-images.sh`, offline licence token or file (`LICENCE_MODE=offline|airgap`), bundled Ollama | `docs/air-gapped-deployment.md`, `scripts/issue_offline_licence.py` |
| Kubernetes | Helm chart `helm/meridian`: API, frontend, worker (with an HPA), LLM deployments; Postgres, Redis and storage StatefulSets; Ingress, NetworkPolicy, PodDisruptionBudget | `helm/meridian/` |
| SAP RFC | the customer adds the SAP NW RFC SDK and builds the RFC overlay image | `scripts/build-rfc-overlay.sh`, `docker/Dockerfile.rfc`, `docs/sap-connector.md` |

Preconditions are checked by `scripts/preflight.sh` (ports, Docker, disk, DNS) and documented in
`docs/prerequisites.md`: 4 cores, 16 GB RAM and 100 GB SSD minimum; 8 cores and 32 GB recommended; a 48 GB
GPU only for a fully local model.

TLS: `meridian-deploy.sh` can create a self-signed or Let's Encrypt certificate, but the HTTPS server block
in `docker/nginx/meridian.conf` is shipped commented out and no script enables it (D-11). Until that is
fixed the operator enables the block by hand or terminates TLS in front of nginx.

## 2. Upgrade and migration

```
updater sidecar (POST /update with X-Updater-Secret)  or  sudo bash scripts/update.sh
  0. pg_dump of the database to a pre-update dump (scripts/update.sh line 149)
  1. resolve the release (--version X.Y.Z, else Meridian HQ's latest_version); snapshot the running images as :rollback
  2. pull that release's vX.Y.Z images; copy its compose files and scripts from the API image (/deploy)
  3. pin it: MERIDIAN_VERSION=vX.Y.Z (and MERIDIAN_PREVIOUS_VERSION) in the install's .env
  4. restart: the API container runs `alembic upgrade head` before it serves
  5. canary: probe /health until it answers (skip with --no-verify)
  6. on failure: auto_rollback re-tags :rollback as the running release, restores .env and restarts
sudo bash scripts/update.sh --rollback      manual rollback to the previous release (MERIDIAN_PREVIOUS_VERSION)
```

- Migrations are forward-only Alembic revisions in `db/migrations/versions/` (114 files, head `116`). A
  rollback restores the previous images but does not downgrade the schema; the pre-update dump (step 0)
  is what undoes a migration. Every migration since 030 is additive by convention (new
  tables, columns, indexes), which is why the previous images run against the newer schema in practice;
  no test proves that compatibility for every pair (debt D-22).
- Forced updates: HQ can mark a release mandatory; the beat task `forced_update_check` (every 15 minutes)
  applies it when no Celery job is running and inside `MERIDIAN_UPDATE_WINDOW` (or at once for a security release marked `force_now`), through the updater, which takes a `pg_dump` first (`api/services/forced_update.py`).
- `tests/test_update_script.sh` (run in CI) pins the fixes for the two defects that took a deployment
  down on 2026-10-16; it checks structure, not a live update. `docs/meridian-update-guide.md` and
  `docs/ops/pilot-upgrade-runbook.md` are the runbooks.

## 3. Backup and restore

| Script | What it does |
|---|---|
| `scripts/backup.sh [--output DIR] [--encrypt] [--database-only]` | `pg_dump --format=custom`, every object-storage bucket as `objects.tar`, `.env` (GPG-encrypted with `--encrypt`, else in clear: D-16), and `manifest.json` pinning image tags and the migration head |
| `scripts/restore.sh DIR` | verifies the manifest, drops and recreates the database (asks for `YES`), `pg_restore --clean --if-exists`, restores buckets and `.env`, then checks the migration head matches (exit 3 if not) |
| `scripts/restore.sh --drill DIR` | restores into a temporary database, verifies, drops it; safe on a live system |
| `scripts/backup-restore-drill.sh` | snapshot row counts, back up, drill-restore, compare counts; intended weekly |

Nothing schedules backups automatically: `docs/ops/backup-restore.md` gives the cron line (daily at 03:00,
14-day rotation). The compliance screen shows the last backup it can read from `MERIDIAN_BACKUP_DIR`.

## 4. Disaster recovery, RPO and RTO

What the scripts support, not a contractual figure:

| | With the documented daily cron | Notes |
|---|---|---|
| RPO | up to 24 hours | no WAL archiving or point-in-time recovery is configured; a shorter RPO needs either a more frequent `backup.sh` or Postgres replication, neither of which the repository ships |
| RTO | the time to provision a host, run `meridian-deploy.sh`, pull images and run `restore.sh` | not measured in the repository; the drill script measures restore correctness, not duration |
| Scope | database, object storage, `.env` | images are re-pulled from the registry (or the air-gapped bundle) |

SAP remains the system of record: findings and work items can be rebuilt by re-extracting and re-running
an analysis. What a backup alone preserves are the human decisions (fix decisions, approvals, exceptions,
golden records, rules, audit log).

## 5. Monitoring

| Signal | Where | Notes |
|---|---|---|
| Liveness | `GET /health` (version, LLM provider and connectivity, cached licence state, email backend), `GET /health/llm` | used by the compose health checks and the update canary; it answers `status: ok` without probing Postgres, Redis or storage (D-26), which the status page does |
| Status page | public `GET /api/v1/status/page` and the `/status` screen: component health with queue depths, 24 h server errors by reference, scheduled maintenance, 30-day uptime | uptime from `health_samples`, written every 5 minutes by `workers.tasks.health_samples.sample_health`, kept 35 days |
| SAP connections | `workers.tasks.run_health_check.check_all_systems` every 30 minutes; health per system on the map | |
| Metrics | Prometheus `/metrics` (`api/middleware/metrics.py`, request counts and latency); optional overlay `docker/docker-compose.monitoring.yml` with Prometheus 2.55, Alertmanager 0.27, Grafana 11.3 and a shipped dashboard and alert rules | `docs/ops/monitoring.md` |
| Diagnostics bundle | `GET /api/v1/support/diagnostics` and `.zip` (manage_system): versions, licence, settings, systems, jobs, errors, samples, environment flags, allow-listed field by field; no SAP data, credentials or user emails | `api/routes/diagnostics.py` |
| Logs | JSON to stdout (`LOG_FORMAT=json`), request id per request | Docker's default log driver; the compose file sets no rotation (D-23) |
| CLI | `scripts/meridianctl.py` (status, licence, health, worker lanes), `scripts/healthcheck.sh` | |

## 6. Log and audit retention

| Data | Retention | Mechanism |
|---|---|---|
| `audit_log` | tenant setting `audit_days` (30 to 3,650), unset keeps everything | nightly `purge_expired` at 02:30 UTC |
| Analysis versions and everything keyed to them | `versions_days`, only archived versions, never the pinned baseline, always the newest `keep_latest_per_system` | same task; `api/services/purge.py` deletes children before parents in one transaction and refuses a version with open work |
| Reports and their PDFs | `reports_days` | same task |
| Health samples | 35 days | `sample_health` |
| Process events | pruned daily at 03:15 UTC | `run_process_discovery.prune_events` |
| Container logs | host Docker configuration | none set by Meridian |

Deletion is guarded: it runs as a dry run every night, and deletes for real only when
`MERIDIAN_PURGE_ENABLED` is on and the tenant's oldest nightly dry run under the current policy is at
least 7 days old (`api/services/retention.py:enforcement`). Each run writes `purge_log` and an audit row.

## 7. Scaling

| Lever | Default | Guidance from what was measured |
|---|---|---|
| API processes | `API_WORKERS=3` (uvicorn) | the v2 load test (400,000 work records, 50 users, 120 s, 3 processes on a shared host at load 8 to 12) held p95 under 1.5 s on all six read endpoints at 68 requests/s (commit `9c94b9ea`; method in `scripts/loadtest_v2.py`); add processes per spare core |
| Celery concurrency | 4 per worker container, prefetch 1, one task per child process (`workers/celery_app.py`) | scale by adding worker containers (Helm: the worker HPA); analysis jobs are memory-bound, not CPU-bound |
| Check engine | single process per analysis | 400,000 rows of a realistic rule mix in under 60 s with exact counts (`tests/checks/test_perf_400k.py`, weekly in `perf-400k.yml`) |
| Postgres | `postgres:16-alpine`, no tuning shipped | work counts are pre-aggregated (`work_counts`, migration 108): the 400k-row backfill took about 20 s and the landscape's open-work query dropped from 180.7 ms to 0.33 ms. The largest tables are `record_issues` and `work_records`; a 2.8 million-issue ECC scope is the known heavy case (`docs/analysis-throughput.md`) |
| Long analyses | `MERIDIAN_CHECKS_TIME_LIMIT` default 24 h | the lifecycle step was reworked into batches on 2026-10-24 after the 6 h wall in `docs/analysis-throughput.md`; that document predates the fix and has no re-measurement (D-24) |

No sizing table for Postgres memory or disk per million records exists in the repository; the figures
above are the measured points.

## 8. The licence worker and what happens when it is unreachable

```
every 6 h (beat: revalidate_licence) and on cache expiry:
  POST https://licence.../api/licence/validate  {licence key, SHA-256 machine fingerprint}
  -> RS256-signed entitlements (modules, features, expiry); cached 6 h if valid, 60 s if invalid
```

From `api/middleware/licence.py`:

| Situation | Behaviour |
|---|---|
| Valid licence cached | serves; module and feature gates apply (402 for an unlicensed module) |
| Expired, inside the 7-day grace | serves with `X-Licence-Warning: expired_grace` |
| Licence worker unreachable, a valid licence was seen before | serves on the last validated entitlements for 2 hours from the first failure (`LICENCE_DEGRADED_CUTOFF_SECONDS`) |
| Unreachable past 2 hours, or never validated since start | licensed `/api/v1` routes answer 403 `licence_unverified`; sign-in, the licence page and health stay up so users can see why |
| Air-gapped or offline | no network call; an RS256 token (`MERIDIAN_LICENCE_TOKEN`) or HMAC-signed file is verified locally |

Because the valid cache lasts 6 hours and the degraded window 2 hours, a licence worker outage starts
blocking a connected deployment between 2 and 8 hours after it begins. The Cloudflare worker is the single
dependency here; a buyer integrating the product may want a longer window or a signed offline fallback for
connected installs (D-25).

## 9. Support model the product implies

- **Customer-operated.** The customer hosts and runs the stack; the vendor never has access to SAP data
  or the database. Support works from what the customer sends: the diagnostics bundle (no SAP data, no
  credentials), server error references (the 8-hex code every 500 shows and the audit log records), and
  the status page.
- **Vendor-delivered updates.** Releases are pulled from the registry by the updater or `update.sh`, with
  an automatic rollback on a failed health check; HQ can force a security release.
- **Remote support needs the customer.** There is no vendor back door or remote shell; screen sharing or a
  customer-run `meridianctl` session is the route.
- **Onboarding runbooks** exist for pilots: `docs/ops/pilot-customer-onboarding.md`,
  `docs/ops/sap-data-prep-checklist.md`, `docs/handover-purge-and-baseline.md`.
