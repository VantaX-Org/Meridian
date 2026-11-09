# Release notes

This folder holds one release-notes file for each Meridian release. The file is named after the release tag, for example `v0.0.633.md`.

## Releases

| Release | Previous | Notes |
|---|---|---|
| v0.0.633 | v0.0.632 | [v0.0.633.md](v0.0.633.md) |

Releases before v0.0.633 have no notes file in this folder. Their changes are in the git history.

## How a release number is made

The workflow `.github/workflows/build-and-deploy.yml` makes each release.

- It runs on a push to main. A push that changes only files under `docs/` or Markdown files does not start it.
- It can also be run by hand. The `version_bump` input is patch by default, or minor or major.
- It reads the latest tag of the form `vX.Y.Z`, bumps it and pushes the new tag.
- It builds the six images `ghcr.io/vantax-org/meridian-{api,frontend,worker,garage,nginx,updater}` with that tag, and sets the latest version in Meridian HQ.
- A newer push to main cancels a running build.

## How to write release notes

1. List the commits with `git log <previous tag>..HEAD`, and the changed files with `git diff --stat <previous tag>..HEAD`.
2. Use these sections in this order: Summary, Features, Fixes, Docs and training, Database migrations, Configuration changes, Deployment, Verification, Rollback, Known issues.
3. Name each change with its commit or pull request.
4. For database migrations, give the alembic head after the release and list each new revision file in `db/migrations/versions/`.
5. For configuration, give environment variable names only. Never write values, keys, tokens or passwords.
6. Do not name the customer, servers, addresses or people. Use roles.
7. Write plain prose in short sentences. Do not use marketing language.
8. Where a fact is not in the repository, write "To confirm" and the role that owns it.
9. Add the release to the table above.

Deployment steps are in [docs/meridian-update-guide.md](../meridian-update-guide.md). The cutover plan for the customer deployment is in [docs/project/cutover-and-go-live-plan.md](../project/cutover-and-go-live-plan.md).
