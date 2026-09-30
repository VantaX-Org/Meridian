# Komatsu — upgrade runbook

| | |
|---|---|
| Meridian server | `10.106.221.25` |
| Install directory | `/opt/meridian` (default of `scripts/install.sh`) |
| Licence | online (HQ licence server) |
| SAP connectivity | RFC — SAP NW RFC SDK installed on the server |

Run every command as root on `10.106.221.25`, from `/opt/meridian`.

## 0. One-time: refresh the deployment files

Releases before this one only updated images, never the compose file or the
host scripts — and Docker Hub no longer serves `minio/minio`, so the old
`update.sh` fails at the pull. Fetch this release's files once, the same way
`install.sh` does (GitHub token with `repo` + `read:packages`):

```bash
cd /opt/meridian
export GH_TOKEN=ghp_xxx REF=main
get() { curl -fsSL -H "Authorization: token $GH_TOKEN" -H "Accept: application/vnd.github.raw" \
        "https://api.github.com/repos/VantaX-Org/Meridian/contents/$1?ref=$REF" -o "$1"; }
cp docker/docker-compose.customer.yml docker/docker-compose.customer.yml.bak
for f in docker/docker-compose.customer.yml docker/docker-compose.updater.yml docker/Dockerfile.rfc \
         scripts/update.sh scripts/preflight.sh scripts/build-rfc-overlay.sh scripts/backup.sh scripts/restore.sh; do
    mkdir -p "$(dirname "$f")"; get "$f"
done
chmod +x scripts/*.sh
```

From this release on, every update carries its own deployment files (they
ship inside the api image and `update.sh` syncs them, keeping `*.bak` copies
of anything changed locally).

## 1. Preflight

```bash
sudo bash scripts/preflight.sh --sap-host <SAP application server> --sap-sysnr <NN>
```

Fix every FAIL before continuing. Typical ones at Komatsu:

- **Containers cannot resolve the SAP host.** Containers use 8.8.8.8 by
  default. Set the internal DNS in `.env`:
  `MERIDIAN_DNS_1=<internal DNS IP>` and `MERIDIAN_DNS_2=<secondary>`.
- **Not logged in to ghcr.io.** Run
  `docker login ghcr.io -u <user>` (token with `read:packages`). The updater
  sidecar reuses this login.
- **`LICENCE_SERVER_PUBLIC_KEY` not set.** This is a WARN. Set it to HQ's
  public key (`cloudflare/licence-worker/DEPLOY_RUNBOOK.md`, step 4) so forged
  licence responses are rejected.

## 2. Update

```bash
sudo bash scripts/update.sh --include-updater   # first time: the updater gets its registry login + SDK mount
sudo bash scripts/update.sh                     # afterwards (or Admin → Update now)
```

What it does, in order (or press **Update now** in Admin, which runs the same
script through the updater sidecar):

1. Snapshots the running images as `:rollback`.
2. Pulls the new Meridian images and syncs this release's deployment files.
3. Pulls the pinned Postgres, Redis and MinIO images (a failure here doesn't
   block the update).
4. Rebuilds the RFC overlay, if one is configured.
5. **Backs up the database** to `backups/pre-update-<UTC>.dump`, then aborts
   if the backup fails.
6. Recreates `api`, `worker`, `beat`, `frontend` and `nginx`, runs the
   migrations, and checks `/health`.
7. Rolls back automatically if any step after the restart fails.

## 3. First time only: SAP RFC support

```bash
sudo bash scripts/build-rfc-overlay.sh          # --sdk <dir> if not /usr/local/sap/nwrfcsdk
sudo bash scripts/update.sh
docker compose -f docker/docker-compose.customer.yml -f docker/docker-compose.rfc.yml \
    exec worker python -c "import pyrfc; print(pyrfc.__version__)"
```

SAP user and authorisations: `docs/sap-connector.md`.

## 4. Verify

- `sudo bash scripts/preflight.sh`: all checks PASS, and the running version
  is the new one.
- In the app, open **Systems**, pick the system and click **Test connection**,
  then **Discover design**. The Coverage tab should show no `failed` tables.
  If it does, a table authorisation is missing.
- **Extract & analyse** one module, then check that **Issues** and **Versions**
  fill in.

## Rollback

```bash
sudo bash scripts/update.sh --rollback      # previous images, incl. the RFC overlay
# If the new release's migrations had already run:
docker compose -f docker/docker-compose.customer.yml exec -T db \
    pg_restore -U meridian -d meridian --clean --if-exists < backups/pre-update-<UTC>.dump
```
