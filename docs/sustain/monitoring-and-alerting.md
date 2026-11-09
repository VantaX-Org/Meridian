# Monitoring and alerting

Full setup detail is in [docs/ops/monitoring.md](../ops/monitoring.md). This document lists what the support team watches, what each signal means and who acts.

## Signals the product provides

| Signal | Where | What it tells you | Who uses it |
|---|---|---|---|
| `/health` | `curl -s http://127.0.0.1/health` on the host | Probes PostgreSQL and Redis. Returns `"status":"ok"` and the running version, or 503 `degraded` when either dependency is down. | L1 and L2 |
| `/health/live` | Inside the network | Shallow liveness only; does not check dependencies | Container orchestration |
| `/health/llm` | Inside the network | Language model reachability | L2 |
| Doctor | Administration, or `GET /api/v1/admin/doctor` (needs manage_system) | Checks PostgreSQL, Redis, storage, language model, licence and migrations | L2 |
| Status page | `/status` screen, `GET /api/v1/status/page` | Health samples every 5 minutes, kept for 35 days | L1, L2 and users |
| SAP connection checks | Systems screens; beat task `check_all_systems` every 30 minutes | Whether each SAP connection still works | L2 and Basis team |
| Failed jobs | Runs, Jobs; the Basis home | Extractions and analyses that failed | L2 and Basis team |
| Error reference | Shown to the user on every server error (8 hexadecimal characters); logged by the api as `ref=<code>` | Links a user report to the log entry | L1 captures, L2 and L3 search |
| Diagnostics bundle | Administration, **Download diagnostics bundle**, or `GET /api/v1/support/diagnostics` and `/api/v1/support/diagnostics.zip` | Collected support evidence for vendor engineering | L2 sends to L3 |
| Licence status | Administration, Licence; header `X-Licence-Warning: offline_grace` | Licence state and grace period | L2 |
| Aletheia engine status | Administration, Aletheia engine | Verdict for the sidecar | L2 |
| `/metrics` | `api:8000/metrics`, internal only | Prometheus metrics from `api/middleware/metrics.py` | Prometheus |
| Container health | `docker compose -f docker/docker-compose.customer.yml ps` | Health checks for nginx, api, frontend, db, redis and storage | L2 |

## Monitoring stack

The stack is opt-in. It is not running unless the overlay was started.

```bash
docker compose \
  -f docker/docker-compose.customer.yml \
  -f docker/docker-compose.monitoring.yml \
  --profile monitoring \
  up -d
```

| Component | Port | Notes |
|---|---|---|
| Prometheus | 9090, internal only | Scrapes `api:8000/metrics` every 15 seconds, keeps 30 days |
| Alertmanager | 9093, internal only | Routes alerts to Slack, PagerDuty or email, depending on which receiver variables are set |
| Grafana | `GRAFANA_PORT` on the host (default 3001) | Provisioned "Meridian Overview" dashboard. Admin password from `GRAFANA_ADMIN_PASSWORD`; external address from `GRAFANA_ROOT_URL` |

Receiver variables in `docker/.env` (set at least one): `SLACK_WEBHOOK_URL`, `PAGERDUTY_ROUTING_KEY`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`, `SMTP_SMARTHOST`, `SMTP_AUTH_USERNAME`, `SMTP_AUTH_PASSWORD`.

Status on the customer deployment:

- Whether the monitoring overlay is running: To confirm (owner: customer infrastructure or hosting team).
- Which receiver is configured and who receives alerts: To confirm (owner: customer service owner).
- Whether Grafana's host port is reachable only from the admin network: To confirm (owner: customer infrastructure or hosting team).
- The self-test in [docs/ops/monitoring.md](../ops/monitoring.md) calls `localhost:9090`, but Prometheus is internal only. Whether that port is reachable from the host is To confirm (owner: vendor engineering). The self-test also stops the api for three minutes; run it only in a maintenance window or on a non-production deployment.

## Alert rules and first response

Rules are in `docker/monitoring/prometheus/alerts.yml`. Each alert has a `runbook` label and a `runbook_url` annotation that points to the table below. The table gives the first response and links the matching runbook in [runbooks.md](runbooks.md).

Severity mapping to the support model is proposed, to agree (see [support-model.md](support-model.md)).

| Alert | Condition | Alert severity | Proposed incident severity | First response |
|---|---|---|---|---|
| ApiDown | `up{job="meridian-api"} == 0` for 2 minutes | critical | S1 | [Runbook 1](runbooks.md#1-health-check), then api logs ([runbook 12](runbooks.md#12-read-logs)). If a failed update just ran, check whether it rolled back ([runbook 3](runbooks.md#3-update-with-updatesh-and-roll-back)). |
| HighErrorRate | HTTP 5xx rate over 1% for 5 minutes | warning | S3, S2 if sustained | Collect error references from the api log, check the doctor, escalate repeated references to L3 |
| HighP95Latency | p95 over 2 seconds on a route for 10 minutes | warning | S3 | Check whether a large extraction or analysis is running, check host load and disk |
| DatabaseErrors | 503 responses over 0.1 per second for 5 minutes | critical | S1 | Check `db` health and logs, check disk space, restart `db` only if it is not recovering |
| AuditBacklog | `meridian_audit_pending > 100` for 5 minutes | warning | S3 | Check db health and api logs; escalate to L3 if it keeps growing |
| LlmUnreachable | Language model error rate over 50% for 10 minutes | warning | S3 | Check `/health/llm`, the ollama container if used, or the external provider settings in [docs/llm-configuration.md](../llm-configuration.md) |
| LicenceValidationFailing | Non-2xx on `/api/v1/licence` over 0.1 per second for 15 minutes | critical | S2, S1 if cut off | [Runbook 6](runbooks.md#6-check-or-renew-the-meridian-licence) |

## What is not monitored by these rules

The alert rules watch the api only. The items below have no alert rule in the repository. The checks are proposed, to agree.

| Item | Proposed check | Owner |
|---|---|---|
| Worker and beat running | Daily look at `docker compose ps` and Runs, Jobs; failed or stuck jobs | Meridian administrator |
| Host disk space | Host monitoring; `update.sh` needs 10 GB free | Customer infrastructure or hosting team |
| Backups succeeded and left the host | Check the backup job output daily | Customer infrastructure or hosting team |
| Certificate expiry for nginx | Host or certificate monitoring | Customer infrastructure or hosting team |
| SAP connection failures | Systems screens and the Basis home | Basis team |
| Licence expiry date | Administration, Licence, checked monthly | Meridian administrator |
| Aletheia sidecar | Administration, Aletheia engine | Meridian administrator |
| Storage health | `docker compose ps storage`, doctor | Meridian administrator |

## Routine checks (proposed, to agree)

| Frequency | Check | Owner |
|---|---|---|
| Each working day | [Runbook 1](runbooks.md#1-health-check); failed jobs on the Basis home; status page | Meridian administrator |
| Each working day | Backup job result | Customer infrastructure or hosting team |
| Weekly | Restore drill result if `scripts/backup-restore-drill.sh` is scheduled | Customer infrastructure or hosting team |
| Monthly | Licence status and expiry; Aletheia engine status; disk trend; release notes for a pending update | Meridian administrator |
| Monthly | `restore.sh --drill`, as the administrator training advises | Meridian administrator |

## In-product monitoring of data quality

Separate from platform monitoring, Meridian monitors data quality after cleansing (Monitors screens). That is a business function owned by the data owners and stewards. See [frontend/docs/guide/monitoring.md](../../frontend/docs/guide/monitoring.md).
