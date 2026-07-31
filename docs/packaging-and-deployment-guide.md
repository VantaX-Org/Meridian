# Meridian — Packaging & Customer Deployment Guide

This is the canonical guide for packaging Meridian for a customer and deploying it on their infrastructure. It covers the full lifecycle from build to running stack.

---

## Overview

Meridian ships as a set of pre-built Docker images hosted on GitHub Container Registry (GHCR) under the `vantax-org` organisation. Customers never receive source code — only compiled, multi-stage images.

There are two scripts in the deployment pipeline:

| Script | Run by | Purpose |
|--------|--------|---------|
| `scripts/create-customer-package.sh` | Internal team | Generates a pre-configured tarball for a specific customer |
| `scripts/meridian-deploy.sh` | Customer | Installs Meridian on their server from the tarball |

The packaging script bakes in all customer-specific configuration (licence, tier, LLM, passwords, GHCR credentials) so the customer installer only needs to ask for server-specific details (domain, SSL, admin account).

---

## Prerequisites (Internal Team)

Before packaging, ensure:

1. **Images are built and pushed to GHCR**
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```
   GitHub Actions (`.github/workflows/build-and-deploy.yml`) builds and pushes `ghcr.io/vantax-org/meridian-{api,frontend,worker,nginx}:v1.2.0`.

2. **GHCR read token is available**
   Generate a classic Personal Access Token at [github.com/settings/tokens](https://github.com/settings/tokens):
   - Owner: `vantax-org`
   - Scope: `read:packages` only
   - Store it securely — this token is injected into every customer package

3. **Customer licence exists in Meridian HQ**
   Create the tenant and generate a licence key at [meridian-hq.vantax.co.za](https://meridian-hq.vantax.co.za).

---

## Step 1 — Package for Customer

### Basic usage

```bash
export GHCR_READ_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx

./scripts/create-customer-package.sh \
  --customer acme-corp \
  --licence-key MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX \
  --tier 2 \
  --version v1.2.0
```

### Full options

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--customer <slug>` | Yes | — | Customer identifier (used in filenames and .env) |
| `--licence-key <key>` | Yes* | — | Meridian licence key (*not required with `--offline`) |
| `--tier <1\|2\|3>` | No | `1` | LLM tier |
| `--version <tag>` | No | `latest` | Docker image version tag |
| `--model <name>` | No | `qwen3.5:9b` | Ollama model (Tier 2 only) |
| `--domain <host>` | No | — | Customer server domain/IP (pre-fills CORS) |
| `--offline` | No | — | Use offline JWT licence mode |
| `--offline-token <jwt>` | With `--offline` | — | Offline licence JWT from Meridian HQ |
| `--gpu` | No | — | Enable NVIDIA GPU in Ollama compose (Tier 2) |
| `--air-gapped` | No | — | Export Docker images into the tarball |

Environment variable `GHCR_READ_TOKEN` is **required** — the script exits immediately if it is not set.

### Example: Tier 1 (Cloud LLM, online licence)

```bash
GHCR_READ_TOKEN=ghp_xxx ./scripts/create-customer-package.sh \
  --customer globex \
  --licence-key MRDX-A1B2C3D4-E5F6A7B8-C9D0E1F2 \
  --tier 1 \
  --version v1.2.0 \
  --domain meridian.globex.com
```

### Example: Tier 2 (Bundled Ollama, GPU, air-gapped)

```bash
GHCR_READ_TOKEN=ghp_xxx ./scripts/create-customer-package.sh \
  --customer acme-corp \
  --licence-key MRDX-A1B2C3D4-E5F6A7B8-C9D0E1F2 \
  --tier 2 \
  --version v1.2.0 \
  --model qwen3.5:9b \
  --gpu \
  --air-gapped
```

### Example: Offline licence (air-gapped, no internet)

```bash
GHCR_READ_TOKEN=ghp_xxx ./scripts/create-customer-package.sh \
  --customer secure-bank \
  --offline \
  --offline-token "eyJhbGciOiJSUzI1NiIs..." \
  --tier 2 \
  --version v1.2.0 \
  --air-gapped
```

### Output

```
meridian-deployment-acme-corp-v1.2.0.tar.gz
```

The tarball contains:

```
customer-package/
├── docker-compose.yml              # Version + customer name substituted
├── docker-compose.ollama.yml       # Tier 2 only, GPU-enabled if --gpu
├── .env                            # Pre-configured (passwords, licence, LLM)
├── README.md                       # Customer-specific deployment guide
├── QUICKSTART.txt                  # Quick start reference
├── checksums.txt                   # SHA-256 checksums for integrity
├── scripts/
│   └── meridian-deploy.sh          # Installer with GHCR token baked in
├── docker/
│   ├── docker-compose.customer.yml       # Template (used by installer)
│   ├── docker-compose.customer.ollama.yml
│   └── nginx/
│       └── meridian.conf                 # Nginx reverse proxy config
└── meridian-v1.2.0.tar.gz         # Docker images (--air-gapped only)
```

---

## Step 2 — Distribute to Customer

### Online customers
Transfer the tarball via secure channel:
```bash
scp meridian-deployment-acme-corp-v1.2.0.tar.gz customer@server:/tmp/
```

### Air-gapped customers
Transfer via USB drive or approved file transfer method. The tarball includes Docker images — no internet required on the target server.

---

## Step 3 — Customer Installation

The customer receives the tarball and runs:

```bash
tar -xzf meridian-deployment-acme-corp-v1.2.0.tar.gz
cd customer-package
sudo bash scripts/meridian-deploy.sh
```

### What the installer does

The installer detects the pre-configured `.env` from the package and runs in **pre-configured mode** — it skips prompts for licence, passwords, and LLM configuration.

| Step | Action | Interactive? |
|------|--------|-------------|
| 1 | Pre-flight checks (OS, RAM, disk, architecture) | No |
| 2 | Load licence from `.env` | No (pre-configured) |
| 3 | Detect tier from LLM provider | No (pre-configured) |
| 4 | Install Docker (if not present) | No |
| 5 | Prompt for server domain/IP | **Yes** |
| 5 | Prompt for SSL mode (HTTP / self-signed / Let's Encrypt) | **Yes** |
| 5 | Prompt for admin account (email, name, password) | **Yes** |
| 6 | Deploy compose files to `/opt/meridian` | No |
| 7 | Copy `.env` and patch CORS origins with chosen domain | No |
| 8 | Configure SSL (generate certs / run certbot) | No |
| 9 | Login to GHCR and pull images | No |
| 10 | Start services and run database migrations | No |
| 11 | Create admin user | No |
| 12 | Write helper scripts (`update.sh`, `healthcheck.sh`) | No |
| 13 | Print access URLs and next steps | No |

### SSL options

| Mode | Ports | Use case |
|------|-------|----------|
| 1 — HTTP only | 80 | Private/internal networks |
| 2 — Self-signed | 80 + 443 | Internal HTTPS (browser warning) |
| 3 — Let's Encrypt | 80 + 443 | Public domain with trusted cert |

### What gets installed

All files are deployed to `/opt/meridian/`:

```
/opt/meridian/
├── docker-compose.yml
├── docker-compose.ollama.yml    # Tier 2 only
├── .env                         # chmod 600
├── nginx/
│   ├── meridian.conf
│   └── certs/                   # SSL certs (modes 2 and 3)
├── logs/
├── backups/
├── update.sh                    # Pull latest + migrate
└── healthcheck.sh               # Verify all services
```

---

## Step 4 — Post-Installation

### Verify health
```bash
sudo bash /opt/meridian/healthcheck.sh
```

### Access the dashboard
- **HTTP**: `http://<server-domain>`
- **HTTPS**: `https://<server-domain>`
- **API docs**: `http://<server-domain>/docs`

### Configure SAP connection
Navigate to **Settings > SAP Connection** in the dashboard. The default SAP connector is `mock` — switch to `rfc` or `odata` and enter connection credentials.

### Tier 1: Set LLM API key
If the customer is Tier 1, they need to edit `/opt/meridian/.env` and set their `ANTHROPIC_API_KEY` (or Azure OpenAI credentials), then restart:
```bash
cd /opt/meridian
docker compose restart api worker
```

---

## Updating a Customer

### Online customers

1. Build and push new version:
   ```bash
   git tag v1.3.0
   git push origin v1.3.0
   ```

2. Customer runs:
   ```bash
   sudo bash /opt/meridian/update.sh
   ```
   This pulls latest images, runs migrations, and restarts services.

### Air-gapped customers

1. Export new images:
   ```bash
   ./scripts/export-images.sh v1.3.0 --tier 2 --model qwen3-5-9b
   ```

2. Transfer `meridian-v1.3.0.tar.gz` to customer server.

3. Customer loads and restarts:
   ```bash
   docker load < meridian-v1.3.0.tar.gz
   sudo bash /opt/meridian/update.sh
   ```

---

## LLM Tiers Reference

| Tier | Provider | What ships | Customer action |
|------|----------|-----------|-----------------|
| 1 | Cloud API | No Ollama | Set `ANTHROPIC_API_KEY` or Azure OpenAI creds in `.env` |
| 2 | Bundled Ollama | `ghcr.io/vantax-org/meridian-ollama` | None — model is pre-baked |
| 3 | BYOLLM | No Ollama | Set `CUSTOM_LLM_BASE_URL` and key in `.env` |

---

## Air-Gapped Deployment

For customers with no internet access:

1. **Package with `--air-gapped` and `--offline`**:
   ```bash
   GHCR_READ_TOKEN=ghp_xxx ./scripts/create-customer-package.sh \
     --customer secure-bank \
     --offline \
     --offline-token "eyJhbG..." \
     --tier 2 \
     --version v1.2.0 \
     --air-gapped
   ```

2. The tarball includes `meridian-v1.2.0.tar.gz` (Docker images, ~5-15 GB).

3. Customer loads images before running the installer:
   ```bash
   tar -xzf meridian-deployment-secure-bank-v1.2.0.tar.gz
   cd customer-package
   docker load < meridian-v1.2.0.tar.gz
   sudo bash scripts/meridian-deploy.sh
   ```

4. The offline JWT token is pre-configured in `.env` — no outbound calls needed.

---

## Standalone Image Export

To export images independently (not as part of packaging):

```bash
./scripts/export-images.sh v1.2.0
./scripts/export-images.sh v1.2.0 --tier 2 --model qwen3-5-9b
```

Output: `meridian-v1.2.0.tar.gz`

Load on target server:
```bash
docker load < meridian-v1.2.0.tar.gz
```

---

## Troubleshooting

### Packaging fails: "GHCR_READ_TOKEN env var is required"
Export the token before running:
```bash
export GHCR_READ_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

### Customer: "GHCR login failed"
The GHCR token baked into the package may have expired. Generate a new one and re-package.

### Customer: images fail to pull
- Verify outbound HTTPS to `ghcr.io` is open
- Check the version tag exists: `docker manifest inspect ghcr.io/vantax-org/meridian-api:v1.2.0`
- For air-gapped: ensure `docker load` was run before the installer

### Customer: licence validation fails
- **Online**: Verify outbound HTTPS to `licence.meridian.vantax.co.za:443`
- **Offline**: Check JWT expiry in Meridian HQ, regenerate if needed
- Test manually: `curl -X POST https://licence.meridian.vantax.co.za/validate -H "Content-Type: application/json" -d '{"licenceKey":"MRDX-...","machineFingerprint":"test"}'`

### Customer: services won't start
```bash
# Check logs
cd /opt/meridian
docker compose logs api
docker compose logs db

# Verify .env passwords match DATABASE_URL
grep DB_PASSWORD .env
grep DATABASE_URL .env
```

---

## Security Notes

- The GHCR read token (`GHCR_READ_TOKEN`) has `read:packages` scope only — it cannot push images or access source code
- The token is injected into `meridian-deploy.sh` at packaging time via `sed` — it never appears in the git repository
- Customer `.env` files are generated with `chmod 600` and contain random 32-character passwords
- Production Docker images contain compiled `.pyc` only (no Python source) and Next.js standalone builds (no `.tsx` source)
- Customers authenticate to GHCR transparently — they never need a GitHub account

---

## Quick Reference

### Package a customer
```bash
GHCR_READ_TOKEN=ghp_xxx ./scripts/create-customer-package.sh \
  --customer <slug> \
  --licence-key <MRDX-...> \
  --tier <1|2|3> \
  --version <tag>
```

### Customer installs
```bash
tar -xzf meridian-deployment-<customer>-<version>.tar.gz
cd customer-package
sudo bash scripts/meridian-deploy.sh
```

### Customer updates
```bash
sudo bash /opt/meridian/update.sh
```

### Customer health check
```bash
sudo bash /opt/meridian/healthcheck.sh
```

---

**Last updated**: 2026-04-08
**Owner**: DevOps Team
**Contact**: support@vantax.co.za
