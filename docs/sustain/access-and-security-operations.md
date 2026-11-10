# Access and security operations

This document covers the routine security work on the customer deployment: users and sign-in, credentials and secrets, licences, vulnerability handling, data retention and data-subject requests. The detailed steps for users are in Module 3 of the [administrator training](../admin-training/meridian-administrator-training.md). The task steps are in [runbooks.md](runbooks.md), runbooks 5 to 8 and 11.

## Users and sign-in

All user administration happens in the product, under Administration. The Meridian administrator owns it.

| Task | Where | Notes |
|---|---|---|
| Invite a user | Administration, Users, **Invite a user** | Invitations expire after 7 days. Resend or copy the link from the person's row. |
| Import users | Administration, Users, **Import users** (CSV, with a preview) | The seat meter counts active and invited users against the licence. |
| Give or scope access | Administration, Users and Administration, Roles and permissions | Roles are grants. A grant can be scoped to one system or object and can expire. Built-in roles cannot be changed; copy one to make a custom role. |
| Single sign-on | Administration, Single sign-on (OpenID Connect) | People who sign in for the first time get the Viewer role and no access grants. The client secret is stored encrypted and never shown again. |
| Require single sign-on | Administration, Sign-in page | Password sign-in stops for everyone except administrators, who keep it in case the identity provider is down. |
| Provisioning | Administration, Users, Provisioning (SCIM), base URL `/scim/v2` | **Rotate the token** stops the old token at once. **Revoke** stops provisioning; people keep their accounts. Group-to-role mapping re-syncs everyone in a SCIM group on save. |
| API keys | Administration, API keys | Each key is its own service account with only the roles given to it. The key is shown once, at creation. |

Account lockout: ten failed sign-ins lock an account for 15 minutes. To check a locked account, filter the audit log (Administration, Audit log) on `auth.login_failed` and `auth.lockout`. Other sign-in events are `auth.login`, `auth.logout`, `auth.password_change`, `auth.sso_login`, `auth.sso_refused` and `auth.sso_user_created`. The audit log never records passwords.

Proposed routine (to agree, owner: customer service owner):

- Disable a leaver's account on the day they leave, or remove them in the identity provider when SCIM is used.
- Review users, roles and API keys each quarter. Revoke keys that are not used.
- Keep at least two administrators with password sign-in, so that access is not lost if the identity provider fails.

Whether the customer requires single sign-on, and which identity provider is used: To confirm (owner: customer security team).

## Credentials and secrets

Secrets live in `docker/.env` on the host. This pack never records their values.

- Stored SAP and connector credentials are encrypted with the credential master key. Rotate it with `scripts/rotate-credential-key.py`, which re-encrypts the stored system credentials and external database connections. Run it with `--dry-run` first. See [runbooks.md](runbooks.md), runbook 5.
- `docker/.env` holds the master keys, so `scripts/backup.sh` encrypts it in the backup (`env.gpg`). Keep the backup passphrase file readable by root only. See [backup-and-dr.md](backup-and-dr.md).
- The diagnostics bundle removes every secret and holds no SAP record values. Check it before it leaves the site.
- The SSO client secret and SCIM token are set in the product and never shown again.

Gaps in the repository:

- The format of the master key and the host or container where `rotate-credential-key.py` runs: To confirm (owner: vendor engineering).
- Rotation procedures for `DB_PASSWORD`, the object storage keys and `UPDATER_SHARED_SECRET`: To confirm (owner: vendor engineering). The HQ signing keys (`JWT_SECRET` and the licence signing key) rotate with an overlap window; see [runbooks.md](runbooks.md#hq-signing-keys).
- The rotation interval for each secret: To confirm (owner: customer security team).

## SAP access

The RFC user and its authorisation role belong to the Basis team. Meridian only reads from SAP unless live write-back is turned on, and live write-back to on-premise SAP sends nothing today (known issue DR-2). The role template is in [docs/sap/authorisation-role-template.md](../sap/authorisation-role-template.md). Route authorisation errors to the Basis team (runbook 9).

## Licences

Two licences exist.

| Licence | Where to check | Settings | Runbook |
|---|---|---|---|
| Meridian | Administration, Licence. An `X-Licence-Warning: offline_grace` header shows the offline grace period is in use. | `MERIDIAN_LICENCE_*` names in `docker/.env` | [Runbook 6](runbooks.md#6-check-or-renew-the-meridian-licence) |
| Aletheia engine | Administration, Aletheia engine | `ALETHEIA_URL`, `ALETHEIA_TOKEN`, `ALETHEIA_TENANT`, `ALETHEIA_LICENSE_KEY`, `ALETHEIA_DEPLOYMENT_ID`, `ALETHEIA_LICENSE_SERVER`, and `MERIDIAN_ALETHEIA_IMAGE` for the image | [Runbook 7](runbooks.md#7-check-or-renew-the-aletheia-licence) |

Licence files and keys are secrets. Do not copy them into tickets or this pack. Adding the Aletheia settings to `docker/.env` needs sudo on the host.

Renewal of both licences, and who requests it: To confirm (owner: vendor delivery lead). Proposed: check expiry dates monthly (see [monitoring-and-alerting.md](monitoring-and-alerting.md)).

## Vulnerability handling

- GitHub vulnerability alerts on the product repository stay on, by the product owner's decision of 9 November 2026 (RAID R-03). Vendor engineering reviews them.
- Dependabot pull requests were removed (commit `8bd66187d`, decision log DL-05). The reason is recorded as To confirm (owner: engineering lead) in the decision log.
- Without Dependabot, GitHub Action SHAs, Dockerfile base images and compose image digests are refreshed by hand (debt row D-32). `docker/docker-compose.updater.yml` still uses `meridian-updater:latest`.
- The workflows `security-scan`, `image-scan` and `dependency-audit` in `.github/workflows/` scan the product on the vendor side.
- A fix reaches the customer deployment as a normal release, or as a forced update when Meridian HQ marks a security release to install at once. See [change-and-release-management.md](change-and-release-management.md).

How the vendor tells the customer about a security fix, and the target time to ship one: To confirm (owner: vendor delivery lead).

## Security references

These documents stay the record. Read them; do not copy them.

- [docs/security/THREAT_MODEL.md](../security/THREAT_MODEL.md): threats and controls
- [docs/security/DATA_FLOW.md](../security/DATA_FLOW.md): where data goes
- [docs/security/pentest-scope.md](../security/pentest-scope.md): scope for a penetration test
- [docs/legal/DPA.md](../legal/DPA.md) and [docs/legal/PRIVACY.md](../legal/PRIVACY.md): data processing and privacy terms
- [docs/PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md): readiness gates and known gaps

Known gaps (see [known-issues.md](known-issues.md)): no web application firewall in front of nginx, no SBOM on release tags, `npm audit` findings, and `MERIDIAN_LICENCE_ALLOW_LEGACY_SIGNATURES` on by default.

## Retention and purge

- Retention periods are set under Administration, Settings, Retention.
- The nightly purge runs at 02:30 UTC as a dry run by default. It reports what it would delete.
- `MERIDIAN_PURGE_ENABLED=true` turns on deletion. Turn it on only after at least 7 days of dry-run reports have been reviewed.
- `POST /api/v1/admin/purge-tenant` deletes a tenant. This cannot be undone. Take a backup first and get approval from the customer service owner.

See [runbooks.md](runbooks.md), runbook 11. The retention periods the customer needs: To confirm (owner: customer privacy officer).

## Data-subject requests

Administration, Data subject requests handles requests about a person's data. Debt row D-27 is partly fixed: some places where a personal value can sit are not covered. For each request, check the uncovered places listed in [roadmap-and-debt.md](../diligence/roadmap-and-debt.md) and handle them by hand. SAP stays the system of record, so a request may also need action in SAP by the customer.

Who receives and approves data-subject requests: To confirm (owner: customer privacy officer).

## Security incidents

Report a suspected security incident to the customer security team and vendor engineering at the same time (see [support-model.md](support-model.md)). The repository has no security incident procedure. One is To confirm (owner: customer security team, with the customer service owner).
