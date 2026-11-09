# Solution design summary

This is a short summary. The full design is in the documents linked below. Read those for detail. This page does not copy them.

## Where the design is written

- Architecture: [docs/ARCHITECTURE.md](../ARCHITECTURE.md)
- Architecture for diligence: [docs/diligence/architecture.md](../diligence/architecture.md)
- Data flow: [docs/security/DATA_FLOW.md](../security/DATA_FLOW.md)
- Threat model: [docs/security/THREAT_MODEL.md](../security/THREAT_MODEL.md)
- Penetration test scope: [docs/security/pentest-scope.md](../security/pentest-scope.md)
- Third-party licences: [docs/diligence/licences.md](../diligence/licences.md)
- Operations: [docs/diligence/operations.md](../diligence/operations.md) and [docs/ops/](../ops/)

## Shape of the system

The customer deployment runs as containers defined in `docker/docker-compose.customer.yml`. The release build in `.github/workflows/build-and-deploy.yml` produces six images: api, frontend, worker, garage, nginx and updater. The compose file defines the services nginx, api, worker, beat, frontend, db, redis, storage and aletheia.

- The API is a Python service. Its routes are in `api/routes/` and its services in `api/services/`.
- Workers run extraction, checks, cleansing, migration, reports and monitors. Their tasks are in `workers/tasks/`.
- SAP access is in `sap/`. It covers RFC, ODP and the SuccessFactors API.
- Rule packs are YAML files in `checks/rules/`. The runner is `checks/runner.py`.
- The database schema is managed by alembic in `db/migrations/`. The head is revision 149.
- The frontend is in `frontend/`. The current screens are in `frontend/design/v2/`. The app opens in light mode by default.

## Change in this release: Meridian's own Aletheia engine

From v0.0.633, the compose file has an `aletheia` service under the compose profile `aletheia`. It uses the image set by `MERIDIAN_ALETHEIA_IMAGE`, which defaults to cortex0 1.7.0. It keeps its data in the volume `aletheia_data`. The API reaches it at `ALETHEIA_URL`.

- `scripts/update.sh` pulls the engine image and starts the engine on a best-effort basis. A failure gives a warning and does not stop the update.
- `api/services/aletheia_engine.py` sends only aggregate metrics to the engine. It does not send records.
- The engine runs unlicensed without a key. The licence key and deployment id are set in the host's `docker/.env` and never in the repository.
- The administrator screen is `frontend/design/v2/admin/engine.tsx`.

The licence terms are in [docs/diligence/licences.md](../diligence/licences.md) section 6. Open points are in the [RAID log](raid-log.md).

## Security

Security controls, data flow and threats are in [docs/security/](../security/). The release adds no new route that returns record data. The two new routes are `/api/v1/aletheia/engine` and `/api/v1/insights/engine-drivers`.

## Design owner

Engineering lead. Design review sign-off: To confirm (Engineering lead).
