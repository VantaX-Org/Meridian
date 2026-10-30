# Meridian: updating a deployed platform

An installed Meridian is updated in place by `scripts/update.sh` in the install directory (`/opt/meridian` by
default), either from Administration (**Update now**, which runs it through the updater sidecar) or by hand over
SSH. The script installs one named release and pins the stack to it; it never follows a moving `:latest` tag.

## How a release reaches an install

1. A release build (`.github/workflows/build-and-deploy.yml`) tags the repository `vX.Y.Z`, pushes the six images
   as `ghcr.io/vantax-org/meridian-{api,worker,frontend,nginx,garage,updater}:vX.Y.Z` and sets `latest_version`
   in Meridian HQ.
2. Each install reads `latest_version` with its licence validation. Administration shows **Update available**
   when it is newer than the running version.

## Run an update

From Administration, **Update now** asks the updater sidecar to install exactly the release HQ offered.

By hand:

```bash
cd /opt/meridian
sudo bash scripts/update.sh                  # the release Meridian HQ names as latest
sudo bash scripts/update.sh --version 2.4.1  # one release (also accepts v2.4.1); use it offline or to reinstall
```

Without `--version` the script asks Meridian HQ through the running api's licence client. When HQ cannot
answer (an offline or air-gapped install, or the api is down), it stops before changing anything and asks for
`--version`.

What it does, in order:

1. Refuses to run while the worker is executing an extraction or a run (`MERIDIAN_UPDATE_FORCE=1` overrides).
2. Resolves the release and snapshots the images of the running release as `:rollback`.
3. Pulls the release's images by tag (`vX.Y.Z`), then copies that release's deployment files (compose file,
   nginx configuration, scripts) out of its api image; when `update.sh` itself changed it continues with the new
   one.
4. Backs up the database (`backups/pre-update-<time>.dump`).
5. Pins the release: writes `MERIDIAN_VERSION=vX.Y.Z` to the install's `.env` (beside the compose file,
   `docker/.env` on a customer install) and keeps the tag it replaced as `MERIDIAN_PREVIOUS_VERSION`. Every
   other line of `.env`, its owner and its mode are kept.
6. Recreates api, worker, beat, frontend and nginx on the release, runs the database migrations and waits up to
   300 seconds for `/health` and the front door. Postgres, Redis and object storage stay untouched (the one
   exception is the first update onto Garage, which copies MinIO's files over and verifies each one; see
   `docs/ops/pilot-upgrade-runbook.md`).

If the migration or the health check fails, the script rolls back on its own: the `:rollback` images are the
running release again, `.env` names that release, and the services are recreated on it. A database that had
already migrated is restored from the dump the script names in its output.

## Roll back

```bash
sudo bash scripts/update.sh --rollback
```

This restores the previous release: `MERIDIAN_VERSION` goes back to `MERIDIAN_PREVIOUS_VERSION`, the `:rollback`
images are tagged as that release, and the services are recreated on it. The release rolled back from becomes the
previous one, so a second `--rollback` returns to it. Database changes are not undone by a rollback; restore the
pre-update dump when the newer release had migrated.

## Check what is running

```bash
grep MERIDIAN_VERSION /opt/meridian/docker/.env        # the pinned release and the one before it
docker compose -f docker/docker-compose.customer.yml ps
curl -s http://127.0.0.1/health                         # reports the running version
```

## Troubleshooting

**The pull fails.** The release may not be published yet, or the host cannot reach `ghcr.io`. The running stack
is untouched; check the release exists, `docker login ghcr.io`, and free disk space (the script needs 10 GB).

**"Meridian HQ did not give a latest version".** The install is offline or the api is not running. Name the
release: `sudo bash scripts/update.sh --version X.Y.Z`.

**A migration fails.** The script has already rolled back to the running release. Read the cause with
`docker compose -f docker/docker-compose.customer.yml logs api --tail 100`.

**Services are unhealthy after the update.** Some services take longer to start. Wait 30 seconds and check
`docker compose -f docker/docker-compose.customer.yml ps`; if it stays unhealthy, roll back.
