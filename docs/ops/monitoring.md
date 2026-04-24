# Monitoring stack — Prometheus + Grafana + Alertmanager

Opt-in monitoring for a customer Meridian deployment. The API already emits Prometheus metrics at `/metrics` and JSON logs — this stack scrapes + renders + alerts.

## What you get

- **Prometheus** (port 9090, internal-only) — scrapes `api:8000/metrics` every 15s, retains 30 days.
- **Alertmanager** (port 9093, internal-only) — routes alerts to Slack / PagerDuty / email based on what's configured in `.env`.
- **Grafana** (port 3001 by default on the host) — pre-provisioned with a Meridian Overview dashboard: request rate, 5xx %, p50/p95/p99 latency, Celery task rates, LLM call rates, audit backlog.

All three containers share the `meridian-net` network with the app, so Prometheus reaches `api:8000` over the internal docker network — `/metrics` never needs to be exposed publicly.

## Enabling it

Add these to your customer `.env`:

```bash
# Grafana — change both before exposing
GRAFANA_ADMIN_PASSWORD=<strong password>
GRAFANA_ROOT_URL=https://grafana.example.com
GRAFANA_PORT=3001              # host port (default 3001)

# Alert receivers — fill in at least one. Leave others empty.
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/xxxx
PAGERDUTY_ROUTING_KEY=xxxxxxxxxxxxxxxx
ALERT_EMAIL_TO=oncall@example.com
ALERT_EMAIL_FROM=alerts@meridian.example.com
SMTP_SMARTHOST=smtp.example.com:587
SMTP_AUTH_USERNAME=alerts@example.com
SMTP_AUTH_PASSWORD=<smtp password>
```

Then bring it up alongside the main stack:

```bash
docker compose \
  -f docker/docker-compose.customer.yml \
  -f docker/docker-compose.monitoring.yml \
  --profile monitoring \
  up -d
```

Grafana will be at `http://<host>:3001` — log in as `admin` / `$GRAFANA_ADMIN_PASSWORD`. The Meridian folder contains the provisioned dashboard.

## Alert rules

Defined in `docker/monitoring/prometheus/alerts.yml`:

| Alert | Condition | Severity |
|---|---|---|
| ApiDown | `up{job="meridian-api"} == 0` for 2m | critical |
| HighErrorRate | 5xx rate > 1% for 5m | warning |
| HighP95Latency | p95 > 2s for 10m | warning |
| DatabaseErrors | 503s > 0.1/s for 5m | critical |
| AuditBacklog | `meridian_audit_pending > 100` for 5m | warning |
| LlmUnreachable | LLM error rate > 50% for 10m | warning |
| LicenceValidationFailing | Non-2xx on `/api/v1/licence` > 0.1/s for 15m | critical |

## Runbook shortcuts

Each alert carries a `runbook` label. Recommended to maintain per-alert docs under `docs/ops/runbooks/<runbook>.md`; for now, the alert `description` field includes the first-step commands to check logs.

## Self-test

After bringing the stack up:

```bash
# 1. Prometheus is scraping the API
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job, health}'

# 2. Alert rules are loaded
curl -s http://localhost:9090/api/v1/rules | jq '.data.groups[].name'

# 3. Trip an alert deliberately — kill the API briefly and watch ApiDown fire.
docker compose stop api; sleep 180; docker compose start api
```

## Rolling back

To stop the monitoring stack without touching the app:

```bash
docker compose -f docker/docker-compose.monitoring.yml down
```

Volumes persist by default (historical metrics survive). Add `-v` to wipe them.
