# Meridian Platform Installation Guide

**Version 1.0 | April 2026**

---

## Overview

Meridian is an enterprise SAP Data Quality and Master Data Management platform that runs entirely on your own infrastructure. This guide will walk you through the complete installation process, which takes approximately 15-30 minutes.

### What You're Installing

Meridian consists of:
- **Dashboard** — Web interface for data quality analysis and governance
- **API Backend** — Core processing engine and SAP connectivity
- **Analytics Engine** — Background workers for data analysis
- **Local AI** — Optional on-premise language model for insights
- **Supporting Services** — Database, cache, and file storage

All services are deployed as Docker containers on your server.

---

## Prerequisites

Before starting, ensure you have:

### System Requirements

- **Operating System**: Linux (Ubuntu 20.04+, RHEL 8+, or similar)
- **CPU**: 4+ cores recommended
- **RAM**: 8GB minimum (16GB+ recommended for local AI)
- **Storage**: 20GB+ free disk space
- **Docker**: Version 24.0 or later
- **Internet**: Required for initial download only

### Software Installation

If Docker is not installed:

```bash
# Install Docker on Ubuntu/Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group changes to take effect
```

For other operating systems, visit: https://docs.docker.com/engine/install/

### Network Access

- Port 3000 (Dashboard) and 8000 (API) must be available
- Outbound HTTPS access required during installation

---

## Before You Begin

You will need two things from Meridian:

1. **Meridian Licence Key**
   - Format: `MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX`
   - Provided in your welcome email

2. **Installation Script**
   - File: `meridian-deploy.sh`
   - Provided via secure download link or email attachment

---

## Installation Steps

### Step 1: Upload Installation Script

Transfer the `meridian-deploy.sh` file to your server:

```bash
# From your local machine, upload to server
scp meridian-deploy.sh user@your-server:/home/user/

# Or use your preferred file transfer method (SFTP, WinSCP, etc.)
```

---

### Step 2: Run the Installer

1. **Connect to your server** via SSH or console

2. **Navigate to the script location**:
   ```bash
   cd /home/user/  # or wherever you uploaded the script
   ```

3. **Make the script executable**:
   ```bash
   chmod +x meridian-deploy.sh
   ```

4. **Run the installer**:
   ```bash
   bash meridian-deploy.sh
   ```

---

### Step 3: Follow Interactive Prompts

The installer will guide you through the setup. Have your information ready:

#### Prompt 1: Licence Key
```
Enter your Meridian licence key (provided by Meridian):
Licence Key: MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX
```

The installer will validate your licence with Meridian servers and retrieve your company information.

#### Prompt 2: Admin Account
```
Admin Email: your@email.com
Admin Name: Your Name
Admin Password: ********
```
*This creates your first user account for logging into Meridian*

---

### Step 4: Wait for Installation

The installer will now automatically:

- ✅ Validate your licence with Meridian servers
- ✅ Download Meridian images from GitHub Container Registry (~5GB, takes 10-20 minutes)
- ✅ Generate secure configuration with random passwords
- ✅ Start database and cache services
- ✅ Run database migrations
- ✅ Start all application services (API, Workers, AI, Dashboard)
- ✅ Create your admin account

**Do not interrupt the installation process.**

Progress indicators will show each step. The entire process typically takes 15-30 minutes depending on your internet connection speed.

---

## Post-Installation

### Accessing Meridian

Once installation completes, you'll see:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Meridian is running!

  Dashboard:   http://localhost:3000
  API:         http://localhost:8000
  Login:       your@email.com

  Licence:     MRDX-XXXXXXXX****
  Tier:        professional
  Expires:     2027-03-31
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

1. **Open your browser** and navigate to: **http://your-server:3000**

2. **Log in** with the admin email and password you created

3. **Start using Meridian!**

### Email delivery

Meridian sends email through one of three backends, tried in this order. Set the variables for the one you use in `.env` (the API and the workers read the same file) and restart the stack.

| Backend | Variables | Notes |
|---|---|---|
| Microsoft Graph | `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `EMAIL_FROM` | Sends as a mailbox in your Microsoft 365 tenant; all four are required |
| SMTP relay | `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | For air-gapped networks with an internal relay |
| Resend | `RESEND_API_KEY` | Hosted API; needs outbound HTTPS |

Tenant alert channels (Admin > Notifications) and per-user delivery both use this backend. Per-user delivery, the digest and "tell me at once" choices each person makes under Me > Preferences, needs one of the three to be configured; without it users still get their in-app notifications, the preferences page says email is not configured, and `GET /health` reports `"email_backend": null`. Each user can confirm their own setup with "Send me a test" on that page.

---

## Useful Commands

### Manage Services

```bash
# View logs
docker compose logs -f

# Stop all services
docker compose stop

# Start all services
docker compose start

# Restart services
docker compose restart

# Check service status
docker compose ps
```

### Update Meridian

When a new version is released:

```bash
# Pull latest images
docker compose pull

# Stop services
docker compose down

# Start with new images
docker compose up -d

# Check status
docker compose ps
```

### Backup Meridian

Backup your database and configuration:

```bash
# Backup database
docker compose exec db pg_dump -U meridian meridian > meridian-backup-$(date +%Y%m%d).sql

# Backup configuration
cp .env .env.backup-$(date +%Y%m%d)
```

### Restore from Backup

```bash
# Restore database
cat meridian-backup-20260401.sql | docker compose exec -T db psql -U meridian meridian

# Restore configuration
cp .env.backup-20260401 .env
docker compose restart
```

---

## Troubleshooting

### Installation Fails at "Downloading Images"

**Problem**: Cannot pull images from GitHub Container Registry

**Solutions**:
1. Check internet connectivity: `ping ghcr.io`
2. Verify Docker is running: `docker ps`
3. Check disk space: `df -h` (need at least 20GB free)
4. If behind a corporate proxy, configure Docker proxy settings
5. Check Docker daemon is running: `sudo systemctl status docker`

**Test manually**:
```bash
docker pull ghcr.io/vantax-org/meridian-api:latest
docker pull ghcr.io/vantax-org/meridian-frontend:latest
docker pull ghcr.io/vantax-org/meridian-worker:latest
docker pull ghcr.io/vantax-org/meridian-ollama:latest
```

**Note**: Meridian images are publicly accessible. No GitHub account or authentication is required.

### Licence Validation Fails

**Problem**: "Licence validation failed: invalid_key"

**Solutions**:
1. Double-check the licence key (correct format: `MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX`)
2. Ensure your server has internet access to: `https://licence.meridian.vantax.co.za`
3. Test connectivity: `curl https://licence.meridian.vantax.co.za/api/licence/heartbeat`
4. Verify the key is active in your Meridian HQ account
5. Contact support@vantax.co.za if the key is correct but validation fails

**Common Error Codes**:
- `missing_key` — Licence key not found in database
- `invalid_key` — Licence key format is incorrect
- `expired` — Licence has expired
- `suspended` — Licence has been suspended

### Services Don't Start

**Problem**: Database or services fail health checks

**Solutions**:
1. Check available disk space: `df -h` (need at least 20GB free)
2. Check available RAM: `free -h` (need at least 8GB)
3. View service logs: `docker compose logs db` or `docker compose logs api`
4. Check if ports are available: `lsof -i :3000` and `lsof -i :8000`
5. Restart services: `docker compose restart`
6. Full reset (WARNING: deletes all data): `docker compose down -v && bash meridian-deploy.sh`

### Cannot Access Dashboard

**Problem**: Browser shows "Connection refused" at http://localhost:3000

**Solutions**:
1. **Check services are running**:
   ```bash
   docker compose ps
   ```
   All services should show "Up" status

2. **Check from server itself**:
   ```bash
   curl http://localhost:3000
   ```

3. **If accessing from remote machine**, use server IP:
   ```
   http://YOUR_SERVER_IP:3000
   ```

4. **Check firewall rules** — ports 3000 and 8000 must be open

### API logs "QueuePool limit ... reached"

**Problem**: Pages return errors under load, or the live job stream drops after about 30 seconds, and `docker compose logs api` shows `QueuePool limit of size ... overflow ... reached`.

**Cause**: Every API request in flight holds one database connection, and the pool ran out.

**Solution**: Raise the pool in `.env` and restart the API (`docker compose restart api`). The three settings, with their defaults:

| Variable | Default | Meaning |
|----------|---------|---------|
| `MERIDIAN_DB_POOL_SIZE` | `20` | Connections kept open by one API container |
| `MERIDIAN_DB_MAX_OVERFLOW` | `20` | Extra connections opened under load and closed again when idle |
| `MERIDIAN_DB_POOL_TIMEOUT` | `30` | Seconds a request waits for a free connection before it fails |

Keep `POOL_SIZE + MAX_OVERFLOW` below the Postgres `max_connections` left after the workers (the default Postgres limit is 100).

---

## Security Best Practices

### After Installation

1. **Change default passwords**: Use the dashboard to update admin password
2. **Enable HTTPS**: Configure reverse proxy (Nginx/Traefik) with SSL certificate
3. **Restrict access**: Use firewall rules to limit dashboard access to your network
4. **Backup regularly**: Schedule backups of the database and configuration

### Firewall Configuration

If using `ufw` on Ubuntu:
```bash
sudo ufw allow 3000/tcp  # Dashboard
sudo ufw allow 8000/tcp  # API
sudo ufw allow 22/tcp    # SSH (already allowed)
```

---

## Retention and purge

Meridian keeps every analysis run until you tell it otherwise. Archiving a run (Runs > Archive older runs) only hides it. Deleting data for good is a separate, deliberate step:

1. **Set the policy** in Admin > Settings > Retention: how many days to keep runs, reports and audit rows, how many of the newest runs per system to keep regardless, and whether the pinned baseline is kept. Use **Preview what would be purged** to see the exact runs, rows and storage the policy selects right now, and why a run would be refused.
2. **Let the dry runs accumulate.** The nightly task (02:30 UTC) writes a dry-run row to the purge log for everything it would delete. Nothing is deleted yet.
3. **Enable enforcement** once you are happy with a week of previews. Add to `.env` and restart the workers:
   ```bash
   MERIDIAN_PURGE_ENABLED=true
   docker compose up -d worker beat
   ```
   Deletion starts only when this flag is on **and** the tenant's oldest dry-run entry is at least seven days old. The Retention panel shows the current state ("Dry run until ...; set MERIDIAN_PURGE_ENABLED to enforce").

Rules that always apply:

- Only archived runs are purged; the pinned baseline and the newest runs of each system never are.
- A run with open stewardship items, unfinished cleaning or pending write-backs is refused until that work is closed. The refusal and its reason appear in the purge log.
- Golden records, learned rules, glossary terms, data contracts and your own rules are never touched.
- Storage (the parquet extract under `staging/<tenant>/<run>/` and the report PDF) is removed after the database rows; a storage error is recorded on the purge log entry rather than failing the purge.

To delete **one run** by hand, open Runs, show archived runs and choose **Delete permanently**; you must type the run's name. To delete **everything** (for example at the end of a contract), an administrator calls `POST /api/v1/admin/purge-tenant` once to receive a token, waits 24 hours, and calls it again with the token. The response is a certificate of deletion (PDF) listing the rows removed per table, the storage freed, the time and the requesting user. See `docs/legal/DPA.md` section 11.

---

## Meridian 2 settings

Most of what Meridian 2 added is set by an administrator in the product, not in `.env`, and is off until then:

| Feature | Where it is set | Default |
|---|---|---|
| SCIM provisioning | Administration > Users: issue the SCIM token, map identity provider groups to roles | Off (no token) |
| Brand theme | Administration > Settings > Appearance | Meridian's own |
| Webhooks | Administration > Webhooks: endpoints, events, signing secret, test send | None |
| Scheduled digests | Administration > Digests: audience, schedule, channel, preview, send now | None |
| Sandbox mode | Administration > Settings > Sandbox: copy a run, try decisions, discard | Off |
| Run cost (`run_cost`) | Administration > Settings > Cost model: per worker hour and per million records | Not set; run prediction then shows no cost |
| Status page | `/status`, readable signed out | On |

Environment settings (in `.env`, with these defaults when unset):

| Variable | Default | What it does |
|---|---|---|
| `MERIDIAN_APP_URL` | (falls back to `SERVER_DOMAIN`) | Address links in digests, webhooks, invitations and resets start with |
| `MERIDIAN_NL_LLM` | `0` | `1` lets the configured LLM map only the words of a plain-words question the fixed tables do not know; it never sees SAP data and each call is written to the LLM audit log |
| `MERIDIAN_API_INTERNAL_URL` | `http://api:8000` | Where the worker probes the API for the status page's uptime (the Helm chart sets its own service name) |
| `MERIDIAN_STATUS_QUEUES` | `celery` | Celery queues the status page watches |
| `MERIDIAN_STATUS_QUEUE_WARN` | `100` | Waiting tasks that turn a queue amber on the status page |
| `MERIDIAN_SIMULATION_TTL` | `86400` | Seconds a fix simulation result is kept |
| `MERIDIAN_SIMULATION_TIME_LIMIT` | `3600` | Ceiling in seconds for one fix simulation task |
| `MERIDIAN_DELTA_FULL_DAYS` | `7` | A delta extraction runs as a full one when the last full one is older than this |
| `SMTP_*` or Microsoft Graph | unset | Email for digests; with neither set, an email digest is recorded as failed with the reason |

The help panel's guide and recordings ship inside the API image (`frontend/docs/guide` and `frontend/docs/help-videos` are copied to `/app/docs`).

## Support & Contact

### Need Help?

**Email**: support@vantax.co.za  
**Subject**: Meridian Installation Support  
**Include**:
- Your licence key (first 9 characters only)
- Operating system details
- Error messages or logs
- Steps you've already tried

**Response Time**: Within 1 business day

### Documentation

- Full platform documentation: Available after login in the Help section
- API documentation: http://your-server:8000/docs

---

## Appendix: System Architecture

### Network Diagram

```
┌─────────────────────────────────────────────────────────┐
│  Your Server (Docker Host)                              │
│                                                         │
│  ┌─────────────┐                                        │
│  │  Dashboard  │  Port 3000 → Browser                   │
│  │  (Frontend) │                                        │
│  └──────┬──────┘                                        │
│         │                                               │
│         ↓                                               │
│  ┌─────────────┐     ┌──────────┐    ┌──────────┐     │
│  │     API     │────→│ Database │    │  Redis   │     │
│  │  (Backend)  │     │(Postgres)│    │ (Cache)  │     │
│  └──────┬──────┘     └──────────┘    └──────────┘     │
│         │                                               │
│         ↓                                               │
│  ┌─────────────┐     ┌──────────┐    ┌──────────┐     │
│  │   Workers   │────→│  Garage  │    │  Ollama  │     │
│  │  (Celery)   │     │ (Storage)│    │  (AI)    │     │
│  └─────────────┘     └──────────┘    └──────────┘     │
│                                                         │
└─────────────────────────────────────────────────────────┘
         ↕
    Internet
         ↕
┌─────────────────┐
│  Meridian Cloud  │
│ Licence Server  │ (validation only - no data transfer)
└─────────────────┘
```

### Data Privacy

- **All SAP data stays on your infrastructure**
- Licence validation sends only: licence key + server hostname
- No customer data is transmitted to Meridian
- AI processing is entirely local (no cloud API calls)

---

## Licence Information

This software is proprietary and licensed. See your Meridian Licence Agreement for terms and conditions.

**© 2026 Meridian. All rights reserved.**

---

*Document Version: 1.0*  
*Last Updated: April 2026*  
*For the latest version, contact: support@vantax.co.za*
