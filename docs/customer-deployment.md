# Meridian Platform — Customer Deployment Guide

## Quick Start

This package contains everything you need to deploy Meridian on your infrastructure.

### Prerequisites

- **Docker Engine** 24.0+ ([Install Docker](https://docs.docker.com/engine/install/))
- **Minimum Hardware**:
  - 8GB RAM (16GB+ recommended for local LLM)
  - 20GB+ free disk space
  - 4 CPU cores
- **Network**: Internet connectivity for initial setup and licence validation

### Installation

1. **Extract the deployment package**:
   ```bash
   tar -xzf meridian-deployment.tar.gz
   cd meridian-deployment
   ```

2. **Run the installation script**:
   ```bash
   ./scripts/meridian-deploy.sh
   ```

   The installer will:
   - ✅ Check prerequisites
   - 🔑 Prompt for your licence key
   - ✅ Validate licence with Meridian HQ
   - 🐙 Authenticate with GitHub (requires access granted by Meridian)
   - ⚙️ Generate secure configuration
   - 📦 Pull Meridian images
   - 🚀 Start all services
   - 🗄️ Initialize database

3. **Access Meridian**:
   - Web Dashboard: http://localhost:3000
   - API Documentation: http://localhost:8000/docs

### What's Included

- **docker-compose.yml** — Container orchestration
- **docker-compose.ollama.yml** — Local LLM (Tier 2/3)
- **scripts/meridian-deploy.sh** — Interactive installer
- **.env.example** — Configuration template

### Services

After successful installation, the following services will be running:

| Service    | Purpose                        | Port  |
|------------|--------------------------------|-------|
| `frontend` | Next.js web dashboard          | 3000  |
| `api`      | FastAPI backend                | 8000  |
| `worker`   | Celery background jobs         | -     |
| `db`       | PostgreSQL database            | 5432  |
| `redis`    | Task queue & caching           | 6379  |
| `minio`    | S3-compatible file storage     | 9000  |
| `llm`      | Ollama LLM (Tier 2 only)       | 11434 |

### Common Tasks

#### View logs
```bash
docker compose logs -f api
docker compose logs -f frontend
docker compose logs -f worker
```

#### Stop the platform
```bash
docker compose stop
```

#### Start the platform
```bash
docker compose start
```

#### Restart services
```bash
docker compose restart
```

#### Check service status
```bash
docker compose ps
```

#### Update to new version
```bash
# Stop services
docker compose down

# Pull new images
docker compose pull

# Start with new images
docker compose up -d

# Run migrations
docker compose exec api alembic upgrade head
```

### Configuration

All configuration is stored in `.env`. Key settings:

#### Licence Configuration
```bash
MERIDIAN_LICENCE_MODE=online                    # or 'offline' for air-gapped
MERIDIAN_LICENCE_KEY=MRDX-XXXX-XXXX-XXXX        # Your licence key
```

#### LLM Configuration (Tier-dependent)

**Tier 1 — Cloud API**:
```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-key-here
# or
LLM_PROVIDER=azure_openai
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-key-here
```

**Tier 2 — Bundled Ollama**:
```bash
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://llm:11434
OLLAMA_MODEL=qwen3.5:9b-instruct
```

**Tier 3 — BYOLLM**:
```bash
LLM_PROVIDER=custom
CUSTOM_LLM_BASE_URL=https://your-llm-endpoint
CUSTOM_LLM_API_KEY=your-key-here
```

#### SAP Connectivity

Configure your SAP connection details through the web interface:
- Navigate to **Settings** → **SAP Connection**
- Enter connection parameters
- Test connection

### Troubleshooting

#### Services won't start
```bash
# Check Docker is running
docker ps

# View service logs
docker compose logs

# Verify .env configuration
cat .env
```

#### Cannot reach licence server
- **Online mode**: Ensure outbound HTTPS to `meridian-licence-worker.reshigan-085.workers.dev`
- **Offline mode**: Use offline JWT token in `.env`

#### Cannot pull images
- **Check GitHub access**: Contact support@vantax.co.za to verify your GitHub username has been granted access
- **Verify token permissions**: Personal Access Token must have `read:packages` scope
- **Test login**: `echo $TOKEN | docker login ghcr.io -u USERNAME --password-stdin`
- **Verify image access**: Try `docker pull ghcr.io/vantax-org/meridian-api:latest`

#### Database connection errors
```bash
# Restart database
docker compose restart db

# Check database logs
docker compose logs db

# Verify password in .env matches DATABASE_URL
```

#### Out of memory errors
- Increase Docker memory limit (Docker Desktop: Settings → Resources)
- For local LLM: minimum 8GB RAM, recommended 16GB+

### Air-Gapped Deployment

For environments without internet access:

1. **On internet-connected machine**:
   ```bash
   # Login to GHCR
   docker login ghcr.io

   # Pull images
   docker pull ghcr.io/vantax-org/meridian-api:latest
   docker pull ghcr.io/vantax-org/meridian-frontend:latest
   docker pull ghcr.io/vantax-org/meridian-worker:latest
   docker pull ghcr.io/vantax-org/meridian-ollama:qwen3-5-9b-instruct  # Tier 2 only
   
   # Export images
   docker save \
     ghcr.io/vantax-org/meridian-api:latest \
     ghcr.io/vantax-org/meridian-frontend:latest \
     ghcr.io/vantax-org/meridian-worker:latest \
     ghcr.io/vantax-org/meridian-ollama:qwen3-5-9b-instruct \
     -o meridian-images.tar
   ```

2. **Transfer to air-gapped server**:
   ```bash
   # Load images
   docker load -i meridian-images.tar
   ```

3. **Configure offline mode** in `.env`:
   ```bash
   MERIDIAN_LICENCE_MODE=offline
   MERIDIAN_LICENCE_TOKEN=<jwt-from-hq>
   ```

4. **Start services**:
   ```bash
   docker compose up -d
   ```

### Data Persistence

All data is stored in Docker volumes:

```bash
# Backup volumes
docker run --rm -v meridian_postgres_data:/data \
  -v $(pwd):/backup ubuntu tar czf /backup/postgres-backup.tar.gz /data

# Restore volumes
docker run --rm -v meridian_postgres_data:/data \
  -v $(pwd):/backup ubuntu tar xzf /backup/postgres-backup.tar.gz -C /
```

### Security Best Practices

- 🔒 Change default passwords in `.env`
- 🔒 Use firewall rules to restrict access to ports 3000 and 8000
- 🔒 Enable HTTPS with reverse proxy (nginx/traefik) in production
- 🔒 Regularly backup database volumes
- 🔒 Keep Meridian updated to latest version
- 🔒 Rotate SAP credentials periodically

### Getting Help

- **Documentation**: https://docs.meridian.vantax.co.za
- **Support Email**: support@vantax.co.za
- **GitHub Container Registry**: Images hosted at `ghcr.io/vantax-org/meridian-*`
- **Emergency**: Call your account manager

### Licence & Updates

Your licence includes:
- ✅ Software updates for 12 months
- ✅ Technical support
- ✅ Security patches
- ✅ Module access per your tier

To check licence status:
```bash
curl -X POST https://meridian-licence-worker.reshigan-085.workers.dev/api/licence/validate \
  -H "Content-Type: application/json" \
  -d '{"licence_key":"YOUR-KEY","machine_fingerprint":"'$(hostname)'"}'
```

### System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 Customer Environment                     │
│                                                          │
│  ┌──────────┐  ┌─────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Frontend │  │   API   │  │  Worker  │  │  Ollama │ │
│  │ (Next.js)│  │(FastAPI)│  │ (Celery) │  │  (LLM)  │ │
│  └────┬─────┘  └────┬────┘  └────┬─────┘  └────┬────┘ │
│       │             │             │             │      │
│  ┌────┴──────┬──────┴────┬────────┴────┬────────┴────┐ │
│  │           │           │             │             │ │
│  │  Postgre  │   Redis   │    MinIO    │     SAP     │ │
│  │     SQL   │           │             │   (RFC/OData)│ │
│  │           │           │             │             │ │
│  └───────────┴───────────┴─────────────┴─────────────┘ │
│                                                          │
│  All SAP data stays within your infrastructure          │
│                                                          │
└─────────────────────┬────────────────────────────────────┘
                      │
                      ├─── Licence validation (every 6h)
                      │    (key + fingerprint only, no data)
                      │
                      ▼
             Meridian HQ (Cloudflare)
```

---

**© 2026 Meridian. All rights reserved.**

Meridian Platform is licensed software. Unauthorized distribution or use is prohibited.
