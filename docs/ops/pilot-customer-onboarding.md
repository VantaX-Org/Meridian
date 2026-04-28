# Pilot customer onboarding — runbook

_Target audience: the engineer driving a pilot deployment end-to-end. Use this as a checklist; every step is either green (you did it) or blocking (you didn't)._

## Before the customer says yes

- [ ] Contract in place (EULA + DPA signed; see `docs/legal/`)
- [ ] Counsel has reviewed and signed off on the legal templates
- [ ] Pen test engagement booked (scope: `docs/security/pentest-scope.md`)
- [ ] Customer's Meridian HQ portal account created with a strong password
- [ ] Customer's licence tier + module list confirmed and entered in HQ portal
- [ ] Customer's billing record set up (Stripe or manual invoicing)

## T-7 days — customer infrastructure

Share the pre-install checklist with the customer's IT team:

- [ ] A Linux host: Ubuntu 22.04+, Rocky 9+, or Debian 12+
- [ ] Minimum spec: 16 GB RAM, 8 vCPU, 50 GB disk (Tier 2 adds a GPU requirement)
- [ ] Outbound HTTPS to `licence.meridian.vantax.co.za`
- [ ] Outbound HTTPS to the configured LLM provider (or none for Tier 0)
- [ ] Docker 24+ and Docker Compose installed
- [ ] DNS record for the customer's chosen dashboard hostname, pointing at the host
- [ ] TLS option decided (Let's Encrypt / self-signed / customer-provided cert)
- [ ] Backup destination (external volume, S3, or similar) with write access from the host
- [ ] A person with `sudo` on the host who can run the install + handle updates
- [ ] A monitoring receiver (Slack webhook / PagerDuty key / email inbox)

## T-3 days — credentials + licence key

- [ ] Licence key generated in HQ portal (`/admin/tenants/<id>/regenerate-key`)
- [ ] Licence key sent to the customer's admin via a secure channel (1Password Share, Bitwarden Send — **not** email/Slack plaintext)
- [ ] Customer admin has tested their TOTP app works (Google Authenticator / 1Password / Authy)

## Install day

On the customer's host, as a sudoer:

```bash
# 1. Clone and install
git clone --depth 1 https://github.com/VantaX-Org/Meridian.git /opt/meridian
cd /opt/meridian
sudo bash scripts/meridian-deploy.sh
```

Script will prompt for:
- Licence mode (online / offline / airgap) — pilot is normally online
- Licence key (from T-3 above)
- LLM tier (0 / 1 / 1.5 / 2 / 3) and associated keys
- Server domain, SSL mode
- Admin email + password

### Immediately after install

```bash
# 2. Log in once with the seeded credentials — you'll be forced to
#    rotate the password on first login (migration 041).

# 3. Apply any post-install migrations (safety net; deploy script
#    already runs these)
docker compose -f docker/docker-compose.customer.yml \
    exec -T api alembic upgrade head

# 4. Validate /health and /metrics
curl -sf http://localhost/health | python3 -m json.tool
docker compose -f docker/docker-compose.customer.yml \
    exec -T api curl -sf http://localhost:8000/metrics | head -5

# 5. Confirm the licence call succeeded
docker compose -f docker/docker-compose.customer.yml \
    exec -T db psql -U meridian -d meridian -tAc \
    "SELECT licensed_modules FROM tenants LIMIT 1"
```

### Enable monitoring

```bash
# Add the env vars from docs/ops/monitoring.md to .env
# (SLACK_WEBHOOK_URL or PAGERDUTY_ROUTING_KEY or ALERT_EMAIL_TO + SMTP_*)
# then bring the monitoring stack up alongside the main stack:

docker compose \
    -f docker/docker-compose.customer.yml \
    -f docker/docker-compose.monitoring.yml \
    --profile monitoring up -d
```

Verify:
- Grafana at `http://<host>:3001` — log in, confirm dashboard renders
- Trip a synthetic alert: `docker compose stop api; sleep 180; docker compose start api` — expect `ApiDown` to fire through the configured receiver

### Enable the RLS hardening

Follow `docs/ops/rls-hardening.md`:
- [ ] Add `MERIDIAN_APP_PASSWORD` to `.env`
- [ ] Update `DATABASE_URL` + `DATABASE_URL_SYNC` to use `meridian_app`
- [ ] Add `DATABASE_URL_MIGRATE` pointing at the `meridian` owner
- [ ] Apply migration 040 (creates the role)
- [ ] Restart api + worker

### Set backup cron

```bash
# Daily backup at 03:00 with 14-day retention + encryption
sudo tee /etc/cron.d/meridian-backup <<'CRON'
0 3 * * * root cd /opt/meridian && ./scripts/backup.sh --encrypt --output /var/backups/meridian && find /var/backups/meridian -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +

# Weekly backup-restore drill at 04:00 Sunday
0 4 * * 0 root cd /opt/meridian && ./scripts/backup-restore-drill.sh >> /var/log/meridian-drill.log 2>&1
CRON
```

## Week 1 — first real analysis

Pair with the customer admin to:

- [ ] Configure their first SAP system connection (Admin → Connections → Add System)
- [ ] Trigger a small test extract (one module, one month of transactions)
- [ ] Review the findings with them — are the rules producing signal or noise for their specific SAP version?
- [ ] Tune the field mapping if they use Z-fields for things our standard map doesn't cover
- [ ] Generate the first PDF report and walk through it with a stakeholder

## Week 2 — scale to full extract

- [ ] Full extract of the agreed modules
- [ ] Run the 400k perf check against their actual data (use `tests/checks/test_perf_400k.py` as a template — point at their Postgres)
- [ ] Check Grafana for alerts over the run
- [ ] Confirm no cross-tenant leak (run `tests/test_rls_integration.py` against their Postgres)

## Week 3 — sign-off

- [ ] Customer has produced their first stakeholder-ready DQ report
- [ ] Pen test report in hand (parallel process)
- [ ] Customer has rotated the seeded admin password
- [ ] Customer has at least one MFA-enrolled admin on the HQ portal
- [ ] Backup-restore drill has fired at least once on cron and succeeded

## If something goes wrong

- **Licence validation failing**: `docs/ops/runbooks/licence-validation-failing.md` (TBD — file as issue)
- **API down**: `docker compose logs api --tail=200` and check `/api/v1/admin/doctor`
- **Update rolled back**: `sudo bash scripts/update.sh --rollback` — if you need to go further, restore from backup
- **Support escalation**: security@vantax.co.za for security incidents, support@vantax.co.za for everything else

## Post-pilot → GA

- [ ] Customer has been live for ≥ 30 days with no P1 incidents
- [ ] All alerts have been triaged; false positives tuned
- [ ] Pen test remediations landed
- [ ] Any feature-gap learnings filed as issues
- [ ] Customer agrees to be a reference (optional)
