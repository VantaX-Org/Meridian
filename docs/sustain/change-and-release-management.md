# Change and release management

This document says how changes reach the customer deployment and how the support team applies them safely. The step-by-step update procedure is in [docs/meridian-update-guide.md](../meridian-update-guide.md) and runbook 3 in [runbooks.md](runbooks.md). The first production cutover follows [docs/project/cutover-and-go-live-plan.md](../project/cutover-and-go-live-plan.md).

## The freeze rule

Never update Meridian while an extraction, sync or analysis is running.

- Before any update, check Operations, Jobs (or the Basis home) and wait until no extraction, sync or run is active.
- `scripts/update.sh` refuses to start while the worker runs an extraction or a run. `MERIDIAN_UPDATE_FORCE=1` overrides that check. Do not use it on the customer deployment. The cutover plan forbids it during cutover, and this pack proposes the same rule for every update.
- The forced-update check (below) also waits while any background job is running.
- Do not start an extraction or analysis while an update is in progress.

## How a release is made

Releases are built by vendor engineering. The customer does not build images.

- `.github/workflows/build-and-deploy.yml` makes a release on a push to main. A push that changes only `docs/` or Markdown files does not start it. It can also be run by hand with `version_bump` set to patch (the default), minor or major.
- It bumps the latest `vX.Y.Z` tag, builds the six images `ghcr.io/vantax-org/meridian-{api,frontend,worker,garage,nginx,updater}` with that tag, and sets the latest version in Meridian HQ.
- Each release has notes in [docs/releases/](../releases/README.md). The notes list features, fixes, database migrations, configuration changes, deployment steps, verification, rollback and known issues.

Other workflows in `.github/workflows/` test and scan the product: unit-tests, rls-tests, fullstack-e2e, aurora-e2e, deploy-smoke, rollback-schema, perf-400k, security-scan, image-scan, dependency-audit and record-help-videos. Their results are for vendor engineering. Whether a release reaches the customer only after all of them pass: To confirm (owner: vendor engineering).

## Change types

The repository defines no change classes. The classes below are proposed, to agree (owner: customer service owner).

| Change | Examples | Proposed approval | Who carries it out |
|---|---|---|---|
| Standard | A patch release with no database migrations; adding a user; renewing a licence; rotating a credential with the documented procedure | Pre-approved, logged | Meridian administrator |
| Normal | A release with database migrations; a minor or major release; enabling an overlay (monitoring, ollama, updater); changing `docker/.env` settings; changing the Aletheia image pin | Customer service owner, after reading the release notes | Meridian administrator, with the customer infrastructure or hosting team |
| Emergency | A security release marked to install at once; a fix for an S1 incident | Customer service owner, approved after the fact if needed | Meridian administrator, with vendor engineering |
| SAP-side | A change to the RFC user, authorisation role or SAP connection | Customer SAP change process | Basis team |

Who approves a production release: To confirm (owner: customer service owner).

## Release notes to read before an update

Read the release notes for every release between the running one and the target. Check these sections:

1. **Database migrations.** If the release migrates the database, a rollback needs the pre-update dump (see below).
2. **Configuration changes.** New `docker/.env` names that must be set on the host. The notes give names only, never values.
3. **Deployment.** Extra steps for this release.
4. **Known issues.** Add new ones to [known-issues.md](known-issues.md).

## Applying an update

Two ways exist. Both run `scripts/update.sh`.

| Way | How | When to use |
|---|---|---|
| In the product | Administration, Platform and updates, **Update to** the offered version, then **Run the update**. Needs the manage system permission and the updater overlay. | Routine updates when the updater is installed |
| On the host | `sudo bash scripts/update.sh --version X.Y.Z` in `/opt/meridian` | Offline installs, a named release, a reinstall, or when the updater is not set up |

What `update.sh` does, in order: refuses to run during an extraction or run; checks for 10 GB of free disk; snapshots the running images as `:rollback`; pulls the release by tag; copies that release's deployment files out of its api image; dumps the database to `backups/pre-update-<time>.dump`; writes `MERIDIAN_VERSION` and `MERIDIAN_PREVIOUS_VERSION` to `docker/.env`; recreates api, worker, beat, frontend and nginx; runs migrations; waits up to 300 seconds for `/health` and the front door. PostgreSQL, Redis and object storage are not recreated.

The script keeps only the newest five `backups/pre-update-*.dump` files. `BACKUP_KEEP` changes the number. Copy a dump off the host first if it must be kept longer.

Options from the update guide and the administrator training:

- `--version X.Y.Z` installs one release.
- `--rollback` returns to `MERIDIAN_PREVIOUS_VERSION`.
- `--no-verify` skips the health probe. Do not use it on production unless vendor engineering asks.
- `--include-updater` also upgrades the updater sidecar's own image, as the last step. The in-product update never passes it.

After the update, follow the verification steps in the release notes. At minimum: `grep MERIDIAN_VERSION docker/.env`, `docker compose -f docker/docker-compose.customer.yml ps`, `/health` returns `"status":"ok"`, and the api log shows no `Traceback`.

## Rollback

- Automatic: if migrations or the health check fail, `update.sh` rolls back to the `:rollback` images by itself and prints the `pg_restore` command for the pre-update dump.
- Manual: `sudo bash scripts/update.sh --rollback`. A second `--rollback` returns to the newer release.
- A rollback restores images, not the database schema. There are no down-migrations (debt row D-22). When the newer release had migrated, restore the pre-update dump as printed. That loses any work done after the update.

Decide before each update with migrations who can approve a dump restore: To confirm (owner: customer service owner).

## Forced and automatic updates

Meridian HQ can set a minimum version for deployments, and can mark a security release to install at once (`force_now`).

- The beat task `forced_update_check` runs every 15 minutes.
- A deployment below the minimum version updates itself through the updater sidecar, only when no background job is running.
- It updates only inside `MERIDIAN_UPDATE_WINDOW`, unless the release is marked to install at once. The window format is `"Sun 02:00-04:00"` or `"02:00-04:00"`, in UTC (`api/services/forced_update.py`). An empty window means any time. A window that cannot be parsed never matches.

Proposed: set `MERIDIAN_UPDATE_WINDOW` to an agreed maintenance window on the customer deployment, so that a forced update does not happen in business hours. The agreed window: To confirm (owner: customer service owner).

## Dependency and image pins

Dependabot was removed on 9 November 2026 (decision log DL-05). GitHub Actions are pinned by commit SHA, and upstream images (PostgreSQL, Redis, ollama, nginx, Prometheus, Alertmanager, Grafana and others) are pinned by digest. These pins now need a manual refresh by vendor engineering (debt row D-32). GitHub vulnerability alerts stay on. See [access-and-security-operations.md](access-and-security-operations.md).

How often pins are refreshed: To confirm (owner: vendor engineering).

## Change records

For each change on the customer deployment, record: the date and time, the release before and after (`MERIDIAN_VERSION` and `MERIDIAN_PREVIOUS_VERSION`), the pre-update dump file name, who approved, the verification result, and any rollback. Where the record is kept: To confirm (owner: customer service owner).

## Practice before hand-over

Exit criterion 5 in [README.md](README.md) requires one update and one rollback by the support team, on a non-production deployment or under supervision. Use [docs/ops/pilot-upgrade-runbook.md](../ops/pilot-upgrade-runbook.md) as a worked example.
