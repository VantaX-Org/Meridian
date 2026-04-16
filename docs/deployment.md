# Deployment Guide

## Step 1: Obtain a Licence Key

1. Visit [portal.meridian.vantax.co.za](https://portal.meridian.vantax.co.za)
2. Create an account and subscribe to a plan
3. Copy your licence key from the dashboard

## Step 2: Prepare the Server

Ensure all [prerequisites](prerequisites.md) are met on your target server.

## Step 3: Download and Extract

```bash
# Download the release bundle
tar -xzf vantax-v1.0.0.tar.gz
cd vantax-v1.0.0
```

## Step 4: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```bash
DB_PASSWORD=<strong random password>
MINIO_PASSWORD=<strong random password>
LICENCE_KEY=<your licence key from portal>
```

Optional but recommended:

```bash
LLM_PROVIDER=ollama          # or ollama_cloud, anthropic
OLLAMA_MODEL=llama3.1:70b    # or llama3.1:8b for smaller GPUs
```

## Step 5: Install

```bash
chmod +x scripts/*.sh
sudo bash scripts/meridian-deploy.sh
```

The installer will:
1. Validate prerequisites and environment
2. Validate your licence key
3. Pull Docker images from GHCR
4. Run database migrations
5. Start all services
6. Pull the LLM model (if using local Ollama)
7. Create an initial tenant

## Step 6: Verify

Open your browser to `http://<server-ip>:3000` to access the dashboard.

Check the API health:
```bash
curl http://localhost:8000/health
```

## Step 7: Upload Your First Dataset

1. Log in to the dashboard at `http://<server-ip>:3000`
2. Navigate to **Upload**
3. Upload a CSV export from SAP (e.g., SE16 export of BUT000)
4. Select the module (e.g., Business Partner)
5. Wait for analysis to complete (typically 2-5 minutes)
6. View results on the Dashboard

## Updating

```bash
./scripts/update.sh
```

## Backing Up

```bash
./scripts/backup.sh
```

## Kubernetes Deployment

For Kubernetes environments, use the included Helm chart:

```bash
helm install vantax ./helm/vantax \
  --set licence.key=YOUR_KEY \
  --set postgres.storageSize=100Gi \
  --set llm.model=llama3.1:70b
```

See `helm/vantax/values.yaml` for all configurable values.
