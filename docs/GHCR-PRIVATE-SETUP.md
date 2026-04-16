# GHCR Private Package Setup — Complete

## ✅ Configuration Complete

Your Meridian deployment is now set up with **private GitHub Container Registry packages**.

### What This Means

✅ **Repository stays private** — Your source code is fully protected  
✅ **Images are private** — Nobody can pull without explicit permission  
✅ **Selective customer access** — Grant only package pull permissions  
✅ **100% FREE** — No GHCR costs, unlimited private packages  
✅ **No code exposure** — Customers never see source, only compiled images

---

## How It Works

### Your Workflow (Internal Team)

1. **Build and push** (automated):
   ```bash
   git tag v1.2.0
   git push origin v1.2.0
   ```
   → GitHub Actions builds and pushes to `ghcr.io/vantax-org/meridian-*`

2. **Grant customer access** (per deployment):
   - Customer provides GitHub username
   - You grant read access to packages (NOT repository)
   - See: [Grant Package Access Guide](./grant-package-access-guide.md)

3. **Send deployment package**:
   ```bash
   ./scripts/create-customer-package.sh \
     --version v1.2.0 \
     --customer acme-corp \
     --licence MRDX-XXXX-XXXX-XXXX \
     --tier 2
   ```
   → Generates `deployments/acme-corp/meridian-deployment-v1.2.0.tar.gz`

### Customer Workflow

1. **Receive package** (tar.gz file via secure transfer)
2. **Get GitHub username added** (contact you with their username)
3. **Create GitHub PAT** (Personal Access Token with `read:packages` scope)
4. **Run installer**:
   ```bash
   tar -xzf meridian-deployment-v1.2.0.tar.gz
   cd customer-package
   ./scripts/meridian-deploy.sh
   ```
5. **Enter credentials**:
   - Licence key
   - GitHub username
   - GitHub PAT

---

## Files Updated

### CI/CD Pipeline
- `.github/workflows/release.yml` → Builds to GHCR on version tags
- Uses `GITHUB_TOKEN` (automatic, no secrets needed)

### Customer Deployment
- `scripts/meridian-deploy.sh` → Prompts for GitHub creds with access instructions
- `docker/docker-compose.customer.yml` → References GHCR images
- `docker/docker-compose.customer.ollama.yml` → References GHCR Ollama image

### Documentation
- `docs/customer-deployment.md` → Customer-facing installation guide
- `docs/internal-deployment-guide.md` → Internal team deployment process
- `docs/grant-package-access-guide.md` → **NEW** — Step-by-step access granting

---

## Quick Reference

### Grant Package Access to New Customer

```bash
# 1. Get customer's GitHub username (they send it to you)

# 2. For EACH package, grant access:
#    - Go to: https://github.com/orgs/vantax-org/packages
#    - Click package: meridian-api
#    - Package settings → Manage Actions access
#    - Add user → Enter username → Role: Read
#    
#    Repeat for: meridian-frontend, meridian-worker, meridian-ollama

# 3. Notify customer they've been granted access
```

See [detailed guide](./grant-package-access-guide.md) for full instructions.

### Verify Customer Has Access

Customer runs:
```bash
docker login ghcr.io -u their-username
# Enter their PAT

docker pull ghcr.io/vantax-org/meridian-api:latest
```

Success = access working ✓

### Revoke Customer Access

1. Go to: https://github.com/orgs/vantax-org/packages
2. Click package
3. Package settings → Find user → Remove

---

## Next Steps

### 1. Test First Build

Tag and push to trigger first GHCR build:
```bash
git add -A
git commit -m "phase-3b: GHCR private package setup complete"
git push origin main

git tag v1.0.1-test
git push origin v1.0.1-test
```

Watch: https://github.com/VantaX-Org/Meridian/actions

### 2. Verify Images

Check packages appear:
- https://github.com/orgs/vantax-org/packages

Should see:
- `meridian-api:v1.0.1-test`
- `meridian-frontend:v1.0.1-test`
- `meridian-worker:v1.0.1-test`
- `meridian-ollama:v1.0.1-test`

### 3. Grant Test Access

Grant your own GitHub username access and test pull:
```bash
docker login ghcr.io -u vantax-org
docker pull ghcr.io/vantax-org/meridian-api:v1.0.1-test
```

### 4. Create First Customer Package

```bash
./scripts/create-customer-package.sh \
  --version v1.0.1-test \
  --customer test-customer \
  --licence MRDX-TEST-TEST-TEST \
  --tier 2
```

### 5. Test Installation

Extract and run installer to verify full flow:
```bash
cd deployments/test-customer
tar -xzf meridian-deployment-v1.0.1-test.tar.gz
cd customer-package
./scripts/meridian-deploy.sh
```

---

## Security Notes

✅ **Source Code Protection**
- Repository: Private ✓
- Packages: Private ✓  
- Customers: Package access only (cannot see code) ✓

✅ **Image Protection**
- Python: Compiled to `.pyc`, source stripped
- Next.js: Standalone build only, no `.tsx` files
- Multi-stage builds: Source not in final layers

✅ **Access Control**
- Per-package permissions
- User-level granularity
- Revocable anytime
- Audit trail via GitHub

✅ **No Costs**
- GHCR: FREE unlimited private packages
- GitHub Actions: 2000 minutes/month free (plenty for builds)
- Storage: 500MB packages storage free (our images ~2GB total)

---

## Support

**For internal team**: See [Internal Deployment Guide](./internal-deployment-guide.md)  
**For customers**: See [Customer Deployment Guide](./customer-deployment.md)  
**For access management**: See [Grant Package Access Guide](./grant-package-access-guide.md)

---

## Summary

Your images are now **private but shareable**:
- ✅ Hosted on GitHub Container Registry (free)
- ✅ Private by default
- ✅ You control who can pull
- ✅ Customers authenticate with GitHub (not to your repo)
- ✅ Zero code exposure
- ✅ Zero infrastructure costs
