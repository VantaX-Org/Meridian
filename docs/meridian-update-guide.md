# Meridian: Updating a Deployed Platform

## Overview

After applying fixes to the codebase and pushing to the repo, follow these steps to update a running Meridian instance on a customer server.

---

## Step 1: Push the Fix to the Repo

From your local development machine:

```bash
cd ~/meridian-2
git add .
git commit -m "fix: async analysis polling + progress bar"
git push origin main
```

This triggers the GitHub Actions workflow which builds and pushes new Docker images to `ghcr.io/agentum-au/meridian-{api,frontend,worker,nginx}:latest`.

## Step 2: Wait for CI to Finish

Go to `https://github.com/agentum-au/meridian-2/actions` and wait for the build to go green. This usually takes 5–10 minutes.

## Step 3: Create the Update Script (First Time Only)

SSH into the customer server and check if the update script already exists:

```bash
ls -la /opt/meridian/update.sh
```

If it doesn't exist, create it:

```bash
sudo nano /opt/meridian/update.sh
```

Paste the following:

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/meridian"
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.yml"

echo "═══════════════════════════════════════"
echo "  Meridian Update"
echo "═══════════════════════════════════════"

cd "$INSTALL_DIR"

echo ""
echo "→ Pulling latest images..."
docker compose -f "$COMPOSE_FILE" pull

echo ""
echo "→ Running database migrations..."
docker compose -f "$COMPOSE_FILE" run --rm api alembic upgrade head 2>/dev/null || echo "  (no pending migrations)"

echo ""
echo "→ Restarting services..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "→ Waiting for services to stabilise..."
sleep 10

echo ""
echo "→ Health check..."
if [ -f "${INSTALL_DIR}/healthcheck.sh" ]; then
    bash "${INSTALL_DIR}/healthcheck.sh"
else
    docker compose -f "$COMPOSE_FILE" ps
fi

echo ""
echo "═══════════════════════════════════════"
echo "  Update complete"
echo "═══════════════════════════════════════"
```

Save the file, then make it executable:

```bash
sudo chmod +x /opt/meridian/update.sh
```

## Step 4: Run the Update

```bash
sudo bash /opt/meridian/update.sh
```

This will pull the new images, run any pending database migrations, restart only the containers whose images changed (Postgres, Redis, and MinIO stay untouched), and run a health check.

## Step 5: Verify the Update

Check the service logs to confirm the new code is running:

```bash
cd /opt/meridian

# API logs — look for the new status endpoint
docker compose logs api --tail 20

# Worker logs — look for progress updates
docker compose logs worker --tail 20

# Frontend — check for build timestamp
docker compose logs frontend --tail 10
```

Then open the dashboard in your browser and test the fix (e.g. re-upload the file that was timing out).

---

## Quick Reference

For all future updates after the script is in place, the process is just:

```bash
# 1. On your local machine
git add . && git commit -m "your message" && git push origin main

# 2. Wait for CI to go green at github.com/agentum-au/meridian-2/actions

# 3. SSH into the server and run
sudo bash /opt/meridian/update.sh
```

---

## Troubleshooting

**"Image not found" or pull fails:**

The CI build may still be running. Check the Actions tab and wait for it to finish before pulling.

**"Permission denied" on update.sh:**

```bash
sudo chmod +x /opt/meridian/update.sh
```

**Migration fails:**

Check the API logs for the full traceback:

```bash
docker compose -f /opt/meridian/docker-compose.yml logs api --tail 50
```

If a migration is broken, you can skip it temporarily and investigate:

```bash
docker compose -f /opt/meridian/docker-compose.yml up -d
```

**Services show "unhealthy" after update:**

Some services (especially Ollama) take longer to start. Wait 30 seconds and re-check:

```bash
docker compose -f /opt/meridian/docker-compose.yml ps
```

---

## Reminder: Add update.sh to the Repo

So that future customer installs get the update script automatically, add a block to `scripts/meridian-deploy.sh` (the installer) that writes `update.sh` to the install directory alongside `healthcheck.sh` during first-time setup.
