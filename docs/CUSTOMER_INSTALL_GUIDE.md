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
2. Ensure your server has internet access to: `https://meridian-licence-worker.reshigan-085.workers.dev`
3. Test connectivity: `curl https://meridian-licence-worker.reshigan-085.workers.dev/api/licence/heartbeat`
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
│  │   Workers   │────→│  MinIO   │    │  Ollama  │     │
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
