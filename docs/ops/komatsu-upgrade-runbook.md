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
3. Pulls the pinned Postgres and Redis images (a failure here doesn't block
   the update).
4. Rebuilds the RFC overlay, if one is configured.
5. **Backs up the database** to `backups/pre-update-<UTC>.dump`, then aborts
   if the backup fails.
6. **First time on Garage only:** moves the files (uploads, reports) from
   MinIO to Garage — see below.
7. Recreates `api`, `worker`, `beat`, `frontend` and `nginx`, runs the
   migrations, and checks `/health`.
8. Rolls back automatically if any step after the restart fails.

### Object storage: MinIO → Garage (once)

This release replaces MinIO with Garage. Garage cannot read MinIO's files on
disk, so the first update copies them over S3:

1. Stops `api`, `worker` and `beat` so nothing writes during the copy.
2. Starts Garage next to the old MinIO and copies every object, bucket by
   bucket. Each copy is read back and checked against the SHA-256 of the
   original; a copy that was interrupted is resumed on the next run.
3. Switches over only if every object matched: the old MinIO container is
   removed and `.storage-migrated` is written. **The old volume
   (`docker_minio_data`) is kept untouched.** Once Meridian checks out, free
   the space with `docker volume rm docker_minio_data`.
4. If anything failed, it removes Garage, brings MinIO and the app back
   exactly as they were, and aborts the update with the reason.

Garage needs a storage password of **16+ characters** (preflight checks it).
If yours is shorter, set a new one in `.env` (`MINIO_PASSWORD` and
`MINIO_SECRET_KEY`, same value, e.g. `openssl rand -hex 16`) before
updating. The copy reads MinIO with MinIO's own, old credentials.

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

## 5. Pilot scorecard: is Meridian right about Komatsu's data?

After the first **Extract & analyse**, open the system and click **Pilot scorecard**.

- **Precision per rule** comes from your stewards' decisions in **Issues**: close
  each reviewed issue as *false positive*, *accepted risk* or *fixed in source*.
  A rule is rated once 10 of its issues are reviewed, and flagged **needs tuning**
  below 90 %. Send the flagged rules back with a few example records.
- **Recall:** upload the records your stewards already know are wrong
  (CSV `object,record,note`; record = SAP key, parts separated by `|`, e.g.
  `accounts_payable,1000|100001,duplicate vendor`). The scorecard shows how many
  Meridian caught and lists the ones it missed.
- **Reference data** (system page): upload the official postal codes and your
  licensed SWIFT BIC directory, then analyse again.

## Rollback

```bash
sudo bash scripts/update.sh --rollback      # previous images, incl. the RFC overlay
# If the new release's migrations had already run:
docker compose -f docker/docker-compose.customer.yml exec -T db \
    pg_restore -U meridian -d meridian --clean --if-exists < backups/pre-update-<UTC>.dump
```

Rolling back keeps the files in Garage: the previous images reach it at
`minio:9000` exactly as they reached MinIO. The untouched `docker_minio_data`
volume is the last resort if the copied files themselves were ever in doubt.
