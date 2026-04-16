# Air-Gapped Deployment

For environments with no internet access.

## Step 1: Prepare Images (on a connected machine)

```bash
# Pull the images
docker pull ghcr.io/vantax-org/meridian-api:latest
docker pull ghcr.io/vantax-org/meridian-frontend:latest
docker pull postgres:16-alpine
docker pull redis:7-alpine
docker pull ollama/ollama:latest
docker pull minio/minio:latest

# Save to tarballs
docker save ghcr.io/vantax-org/meridian-api:latest | gzip > vantax-api.tar.gz
docker save ghcr.io/vantax-org/meridian-frontend:latest | gzip > vantax-frontend.tar.gz
docker save postgres:16-alpine | gzip > postgres.tar.gz
docker save redis:7-alpine | gzip > redis.tar.gz
docker save ollama/ollama:latest | gzip > ollama.tar.gz
docker save minio/minio:latest | gzip > minio.tar.gz
```

## Step 2: Transfer to Air-Gapped Server

Transfer all `.tar.gz` files via USB drive, secure file transfer,
or other approved method.

## Step 3: Load Images

```bash
docker load < vantax-api.tar.gz
docker load < vantax-frontend.tar.gz
docker load < postgres.tar.gz
docker load < redis.tar.gz
docker load < ollama.tar.gz
docker load < minio.tar.gz
```

## Step 4: Prepare Ollama Model

On the connected machine:

```bash
docker run -v ollama_export:/root/.ollama ollama/ollama pull llama3.1:70b
docker run -v ollama_export:/root/.ollama --rm alpine tar czf - -C /root/.ollama . > ollama-models.tar.gz
```

On the air-gapped server:

```bash
docker volume create ollama_models
docker run -v ollama_models:/root/.ollama --rm -i alpine tar xzf - -C /root/.ollama < ollama-models.tar.gz
```

## Step 5: Offline Licence

Contact Meridian support to receive an offline licence file.

1. Place the file at `/opt/vantax/licence.json`
2. Set in `.env`:
   ```bash
   LICENCE_FILE=/opt/vantax/licence.json
   ```

The file format:
```json
{
  "valid": true,
  "licenceKey": "your-licence-key",
  "modules": ["business_partner", "material_master", "fi_gl"],
  "tenantId": "your-tenant-id",
  "expiresAt": "2027-03-01T00:00:00Z"
}
```

The container will read this file instead of calling the licence server.

## Step 6: Configure Local Auth

```bash
AUTH_MODE=local
```

This disables Clerk authentication. Users access the dashboard directly
without sign-in.

## Step 7: Configure SMTP (instead of Resend)

```bash
RESEND_API_KEY=
SMTP_HOST=your-smtp-server.local
SMTP_PORT=587
SMTP_USER=vantax@company.com
SMTP_PASSWORD=<password>
SMTP_FROM=vantax@company.com
```

## Step 8: Install

```bash
# Comment out the licence validation step in install.sh or set LICENCE_FILE
sudo bash scripts/meridian-deploy.sh
```

The installer will skip the remote licence check if `LICENCE_FILE` is set.
