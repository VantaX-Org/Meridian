# Meridian Customer Deployment — Internal Guide

## Overview

This guide covers how to package, distribute, and deploy Meridian to customer on-premise environments using **GitHub Container Registry (GHCR)** - completely free with unlimited private repositories.

## GitHub Container Registry Setup (One-time)

### Benefits
- ✅ **FREE** - unlimited private repositories
- ✅ Already integrated with GitHub
- ✅ No additional account required
- ✅ Automatic authentication via GitHub tokens
- ✅ Fine-grained access control

### 1. Enable GHCR (Already Done)

GHCR is automatically enabled for your GitHub repository. Images are automatically set to private and inherit repository permissions.

### 2. No Additional Configuration Needed

The workflow in `.github/workflows/release.yml` already:

## Release Process

### 1. Build and Push Images

When ready to release a new version:

```bash
# Tag the release
git tag v1.2.0
git push origin v1.2.0
```

This triggers `.github/workflows/release.yml` which:
- ✅ Builds production images from `docker/Dockerfile.*.prod`
- ✅ Pushes to GHCR (`ghcr.io/vantax-org/meridian-*`)
- ✅ Images are automatically private
- ✅ Uses GitHub's built-in authentication

**Manual Ollama build** (only when model changes):
```bash
# Trigger via GitHub Actions UI
# Actions → "Build & Push Production Images" → Run workflow
# Check "Build Ollama image" and select model
```

### 2. Create Customer Package

After images are pushed:

```bash
./scripts/create-customer-package.sh v1.2.0
```

Output: `meridian-deployment-v1.2.0.tar.gz`

This tarball contains:
- `docker-compose.yml` (references private images)
- `docker-compose.ollama.yml` (Tier 2 overlay)
- `scripts/meridian-deploy.sh` (interactive installer)
- `README.md` (customer documentation)
- `.env.example` (configuration template)
- `QUICKSTART.txt`
- `checksums.txt`

### 3. Test the Package

```bash
# Extract
tar -xzf meridian-deployment-v1.2.0.tar.gz
cd customer-package

# Run installer (test flow)
./scripts/meridian-deploy.sh
```

### 4. Distribute to Customer

#### Method A: Direct Transfer
```bash
scp meridian-deployment-v1.2.0.tar.gz customer@server:/tmp/
```

#### Method B: Secure Download Link
Upload to secure file sharing (e.g., SharePoint, encrypted S3 bucket) and send link.

## Customer Onboarding Flow

### 1. Generate Licence in Meridian HQ

1. Go to https://meridian-hq-portal.pages.dev
2. Login as admin
3. Navigate to **Tenants** → **New Tenant**
4. Fill in customer details:
   - Company name
   - Contact email
   - Tier (1, 2, or 3)
   - Expiry date
   - Enabled modules
5. **Optional**: Add admin user credentials for portal access
6. Click **Create Tenant & Generate Key**
7. **Copy the licence key** — it's shown only once
8. Save licence key securely

### 2. Provide GitHub Access

**Grant Package-Only Access** (Recommended - Secure & Free)

Customers get access to pull images but **cannot see your source code**.

1. Get customer's GitHub username
2. For each package, grant read access:
   - Go to https://github.com/orgs/vantax-org/packages
   - Click on package (e.g., `meridian-api`)
   - **Package settings** → **Manage Actions access**
   - Click **Add repository or user**
   - Enter customer's GitHub username
   - Set role: **Read**
   - Repeat for all packages: `meridian-api`, `meridian-frontend`, `meridian-worker`, `meridian-ollama`

3. Customer creates Personal Access Token:
   - Go to https://github.com/settings/tokens
   - Generate new token (classic)
   - Select scope: `read:packages`
   - Copy token

4. Customer uses in installation:
   ```bash
   docker login ghcr.io -u USERNAME -p TOKEN
   ```

**Important**: Package permissions are separate from repository permissions. Customers can pull images but never see your code.

See [Grant Package Access Guide](./grant-package-access-guide.md) for detailed step-by-step instructions.

### 3. Send Deployment Package

Email customer with:
```
Subject: Meridian Installation Package — [Customer Name]

Dear [Contact],

Your Meridian Platform licence has been activated.

**Licence Details:**
- Licence Key: MRDX-XXXX-XXXX-XXXX
- Tier: Professional
- Expiry: 2027-03-31

**Deployment Package:**
- Download: [secure link to tar.gz]
- SHA256: [checksum]

**GitHub Access Setup:**

To pull Meridian's private container images, you'll need a GitHub account.

1. **Create/Login to GitHub**: https://github.com (free account is fine)
2. **Share your GitHub username**: Reply to this email with your GitHub username
3. We'll grant you access to the Meridian image packages
4. **Create a Personal Access Token**:
   - Go to: https://github.com/settings/tokens
   - Click "Generate new token (classic)"
   - Name it: "Meridian Container Access"
   - Select scope: `read:packages` only
   - Click "Generate token"
   - **Copy and save the token** (shown only once)

5. **Installation**:
   ```bash
   tar -xzf meridian-deployment-v1.2.0.tar.gz
   cd customer-package
   ./scripts/meridian-deploy.sh
   ```
   
   When prompted, enter:
   - Licence key (above)
   - GitHub username
   - GitHub Personal Access Token

**Important**: Your GitHub account will ONLY have access to pull container images, not our source code.

**Documentation**: See README.md in the package

**Support**: support@vantax.co.za

Best regards,
Meridian Team
```

### 4. Customer Installation

Customer runs:
```bash
tar -xzf meridian-deployment-v1.2.0.tar.gz
cd customer-package
./scripts/meridian-deploy.sh
```

The installer will:
1. ✅ Check Docker prerequisites
2. 🔑 Prompt for licence key
3. ✅ Validate licence with HQ
4. 🐳 Prompt for Docker Hub credentials
5. 🐳 Authenticate with Docker Hub
6. ⚙️ Generate `.env` with secure passwords
7. 📦 Pull images from private registry
8. 🚀 Start all containers
9. 🗄️ Run database migrations
10. ✅ Display access URLs

## Air-Gapped Deployments

For customers without internet access:

### 1. Generate Offline Token in HQ

1. Go to tenant detail page in HQ
2. Scroll to **Offline Token** section
3. Set expiry days (e.g., 365)
4. Click **Generate Token**
5. Copy the JWT token

### 2. Export Images

On internet-connected machine:

```bash
# Login to GHCR
docker login ghcr.io

# Pull images
docker pull ghcr.io/vantax-org/meridian-api:v1.2.0
docker pull ghcr.io/vantax-org/meridian-frontend:v1.2.0
docker pull ghcr.io/vantax-org/meridian-worker:v1.2.0
docker pull ghcr.io/vantax-org/meridian-ollama:qwen3-5-9b-instruct  # Tier 2

# Export
docker save \
  ghcr.io/vantax-org/meridian-api:v1.2.0 \
  ghcr.io/vantax-org/meridian-frontend:v1.2.0 \
  ghcr.io/vantax-org/meridian-worker:v1.2.0 \
  ghcr.io/vantax-org/meridian-ollama:qwen3-5-9b-instruct \
  -o meridian-images-v1.2.0.tar

# Compress
gzip meridian-images-v1.2.0.tar
```

### 3. Transfer to Customer

```bash
# Via USB drive, secure file transfer, etc.
# File: meridian-images-v1.2.0.tar.gz
# Size: ~15-20GB (depends on Tier)
```

### 4. Customer Loads Images

```bash
# Load images
docker load -i meridian-images-v1.2.0.tar.gz

# Verify
docker images | grep ghcr.io/vantax-org/meridian
```

### 5. Configure Offline Mode

Edit `.env`:
```bash
MERIDIAN_LICENCE_MODE=offline
MERIDIAN_LICENCE_TOKEN=<jwt-from-hq>
# Remove MERIDIAN_LICENCE_KEY
```

Start:
```bash
docker compose up -d
```

## Updating Customers

### For Online Customers

1. Release new version (tag + push as above)
2. Notify customer via email
3. Customer runs:
   ```bash
   docker compose down
   docker compose pull
   docker compose up -d
   docker compose exec api alembic upgrade head
   ```

### For Air-Gapped Customers

1. Export new images (as above)
2. Send images to customer
3. Customer loads and restarts:
   ```bash
   docker load -i meridian-images-v1.3.0.tar.gz
   docker compose down
   docker compose up -d
   docker compose exec api alembic upgrade head
   ```

## Troubleshooting Customer Issues

### Licence Validation Fails

**Online Mode:**
```bash
# Test licence validation
curl -X POST https://meridian-licence-worker.reshigan-085.workers.dev/api/licence/validate \
  -H "Content-Type: application/json" \
  -d '{"licence_key":"MRDX-XXXX-XXXX-XXXX","machine_fingerprint":"test"}'
```

Check:
- ✅ Firewall allows HTTPS to cloudflare worker
- ✅ Licence key is correct
- ✅ Licence not expired
- ✅ Tenant status is "active" in HQ

**Offline Mode:**
- Verify JWT token in `.env`
- Check token expiry in HQ
- Regenerate token if needed

### Cannot Pull Images

Check:
- ✅ GitHub token has `read:packages` permission
- ✅ Token hasn't expired
- ✅ Customer authenticated: `docker login ghcr.io`
- ✅ Internet connectivity
- ✅ Firewall allows ghcr.io

### Services Won't Start

```bash
# Check logs
docker compose logs

# Common issues:
# - Database password mismatch in .env
# - Port conflicts (3000, 8000 already in use)
# - Insufficient memory for Ollama
```

## Security Considerations

### ✅ DO:
- Keep GitHub tokens secure (treat like passwords)
- Use customer's own GitHub accounts when possible
- Rotate shared tokens regularly (if using Option C)
- Use offline mode for highly sensitive environments
- Enable HTTPS with reverse proxy in production
- Regularly update to latest version
- Monitor licence expiry dates

### ❌ DON'T:
- Share production licence keys in emails/Slack
- Give customers write access to repository
- Commit tokens to git
- Allow unlimited public access to GHCR packages

## Monitoring & Analytics

Track customer deployments via licence validation pings in HQ:
- Last ping timestamp
- Machine fingerprint
- Enabled modules
- Version (via User-Agent or custom header - future)

## Cost Management
GitHub Container Registry**: **FREE** - unlimited private packages
- **Cloudflare Workers**: Free tier sufficient for licence validation
- **Cloudflare Pages**: Free tier sufficient for HQ portal

**Total hosting cost: $0/month** ✅ validation
- **Cloudflare Pages**: Free tier sufficient for HQ portal

## Future Enhancements

1. **Automated Docker Token Exchange**:
   - Customer hits endpoint with licence key
   - Returns time-limited Docker Hub token
   - No manual credential sharing

2. **Version Tracking**:
   - Customer stack reports version in health check
   - HQ tracks customer versions
   - Automated update notifications

3. **Health Monitoring**:
   - Customer opt-in to send anonymous metrics
   - Monitor service health from HQ
   - Proactive support

4. **OCI Registry Migration**:
   - Move from Docker Hub to AWS ECR or Azure ACR
   - Better access control per customer
   - Lower costs at scale

---

**Last Updated**: 2026-03-31  
**Owner**: DevOps Team  
**Contact**: devops@vantax.co.za
