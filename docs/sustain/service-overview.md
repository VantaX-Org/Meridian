# Service overview

## What Meridian does

Meridian is a data-quality platform for SAP. It reads master data from a connected SAP system, runs data-quality rules against it, shows findings, and supports fixing, approving and exporting the corrections. SAP stays the system of record. Meridian holds extracted copies, findings and the decisions people make about them.

The product is operated by the customer. The vendor has no access to the customer's SAP data and no back door into the deployment. Vendor support works from what the customer sends: the diagnostics bundle, error references and the status page (see [monitoring-and-alerting.md](monitoring-and-alerting.md)).

## How it is deployed

The customer deployment is a single-tenant Docker Compose stack defined in `docker/docker-compose.customer.yml`. All services join one internal network, `meridian-net`. The default install directory is `/opt/meridian`. The deployment's tenant is set by `MERIDIAN_TENANT_ID`.

The release is pinned in `docker/.env` by `MERIDIAN_VERSION`. The previous release is kept in `MERIDIAN_PREVIOUS_VERSION` so that a rollback knows where to go. Application images come from `ghcr.io/vantax-org/meridian-{api,worker,frontend,nginx,garage,updater}` with the tag `vX.Y.Z`.

Install and configuration are described in [docs/customer-deployment.md](../customer-deployment.md). Other deployment variants are in [docs/air-gapped-deployment.md](../air-gapped-deployment.md) and [docs/packaging-and-deployment-guide.md](../packaging-and-deployment-guide.md).

Every service logs with the json-file driver, rotated at 50 MB per file and 5 files.

## Components

### Core services (always running)

| Service | What it does | Network exposure | Health check in compose | Data it holds |
|---|---|---|---|---|
| nginx | Front door. Terminates HTTP and HTTPS and routes to frontend and api. Config in `docker/nginx/meridian.conf`, certificates in `docker/nginx/certs`. HTTPS is enabled with `scripts/nginx-https.sh`. | Publishes ports 80 and 443 on the host | `nginx -t` and a request to `/health` | None |
| api | Application API. Runs `alembic upgrade head` at start, then `API_WORKERS` uvicorn processes (default 3). | Internal only, `api:8000`. No host port. | `curl -f http://localhost:8000/health` inside the container | None (stateless) |
| worker | Celery worker, concurrency 4. Runs extractions, rule checks and other background jobs. | Internal only | None | None |
| beat | Celery beat scheduler (`celery -A workers.celery_app beat`). Starts scheduled jobs such as connection checks, health sampling, retention purge and the forced-update check. | Internal only | None | Schedule state (not backed up) |
| frontend | Web user interface on port 3000. Uses `INTERNAL_API_URL` to reach the api and `AUTH_MODE` for sign-in mode. | Internal only, reached through nginx | Request to port 3000 | None |
| db | PostgreSQL 16 (`postgres:16-alpine`). Database and user are both `meridian`; the password is `DB_PASSWORD`. | Internal only | `pg_isready -U meridian` | All application data, volume `postgres_data` |
| redis | Redis 7.2 (`redis:7.2-alpine`). Celery broker and cache. | Internal only | `redis-cli ping` | Queue and cache, volume `redis_data` (not backed up) |
| storage | Garage object storage (image `meridian-garage`), which replaced MinIO. Reached at the network alias `minio:9000` so that existing `.env` files keep working. Uses `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_PASSWORD`, `MINIO_BUCKET_UPLOADS` and `MINIO_BUCKET_REPORTS`. | Internal only | `/health` on port 3903 inside the container | Uploaded files and reports, volume `storage_data` |

### Optional services (overlays and profiles)

| Service | How it is enabled | What it does | Notes |
|---|---|---|---|
| aletheia | Compose profile `aletheia` in the customer compose file | The Aletheia engine sidecar. The api reaches it at `ALETHEIA_URL` (default `http://aletheia:8000`). It receives aggregates only, not record-level SAP data. | Image `${MERIDIAN_ALETHEIA_IMAGE:-ghcr.io/vantax-org/cortex0:1.7.0}`, volume `aletheia_data`. Settings: `ALETHEIA_TOKEN`, `ALETHEIA_LICENSE_KEY`, `ALETHEIA_DEPLOYMENT_ID`, `ALETHEIA_LICENSE_SERVER`. The image pin is an open decision (see [known-issues.md](known-issues.md)). |
| updater | Overlay `docker/docker-compose.updater.yml` | Holds the Docker socket so the "Update now" button can run `scripts/update.sh` without giving api or worker any host-level Docker control. The api calls `POST /update` with the `X-Updater-Secret` header, authenticated by `UPDATER_SHARED_SECRET`. | No published port. Never recreated by a normal update; upgraded only with `update.sh --include-updater`. |
| ollama | Overlay `docker/docker-compose.customer.ollama.yml` | Local language model server for the assistant features. | Service name is `ollama`. LLM settings are in [docs/llm-configuration.md](../llm-configuration.md). |
| prometheus, alertmanager, grafana | Overlay `docker/docker-compose.monitoring.yml` with `--profile monitoring` | Metrics, alerting and dashboards. | See [monitoring-and-alerting.md](monitoring-and-alerting.md). |

Other overlays:

- DNS overlay: `scripts/dns-overlay.sh`, driven by `MERIDIAN_DNS_1` and `MERIDIAN_DNS_2`. `update.sh` re-applies it.
- RFC overlay: `scripts/build-rfc-overlay.sh` builds images that include the SAP NW RFC SDK, which the customer must supply.

### Licensing

Two licences apply, and they are separate.

- The Meridian licence gates the product modules. Its mode is set by `MERIDIAN_LICENCE_MODE`: online (`MERIDIAN_LICENCE_KEY` and `MERIDIAN_LICENCE_SERVER_URL`, validated and cached for 6 hours) or offline (`MERIDIAN_LICENCE_TOKEN`). Every licence path checks an Ed25519 signature against a public key compiled into the image. The admin screen is Administration, Licence.
- The Aletheia licence is set by `ALETHEIA_LICENSE_KEY` and must match `ALETHEIA_DEPLOYMENT_ID`. The admin screen is Administration, Aletheia engine.

Licence operations are in [access-and-security-operations.md](access-and-security-operations.md) and [runbooks.md](runbooks.md).

## How the parts connect

1. A user's browser connects to nginx on port 80 or 443.
2. nginx serves the frontend and passes API calls to the api.
3. The api reads and writes PostgreSQL, uses Redis, and stores files in Garage storage.
4. The api puts long jobs on the Redis queue. The worker picks them up. Beat adds scheduled jobs to the same queue.
5. The worker connects to SAP over RFC to extract data, then runs rules and writes findings to PostgreSQL.
6. If enabled, the api sends aggregates to the aletheia sidecar and prompts to the configured language model.
7. The api checks the Meridian licence online or offline. The aletheia sidecar checks its own licence.

A data-flow description for security review is in [docs/security/DATA_FLOW.md](../security/DATA_FLOW.md) and the threat model is in [docs/security/THREAT_MODEL.md](../security/THREAT_MODEL.md).

## External dependencies

| Dependency | Used for | Owner |
|---|---|---|
| SAP system (ECC or S/4HANA) | Source of master data, read over RFC | Basis team |
| SAP RFC user and authorisation role | Read access for extraction. Template in [docs/sap/authorisation-role-template.md](../sap/authorisation-role-template.md) | Basis team |
| Container registry `ghcr.io/vantax-org` | Release images | Vendor engineering |
| Meridian licence server (online mode only) | Licence validation | Vendor engineering |
| Aletheia licence server | Aletheia licence validation | Vendor engineering |
| Language model provider (if not local ollama) | Assistant features, set by `LLM_PROVIDER` | Meridian administrator |
| Identity provider (if SSO is used) | OIDC sign-in and SCIM provisioning | Customer identity team |
| Host, disk, network and DNS | Running the stack | Customer infrastructure or hosting team |

## Where to look next

- Day-to-day tasks: [runbooks.md](runbooks.md)
- Product use by role: [frontend/docs/guide/](../../frontend/docs/guide/) and [docs/journeys/](../journeys/)
- Operations posture summary: [docs/diligence/operations.md](../diligence/operations.md)
