# Support model

## Principles from the product

Three facts from the repository shape this model.

1. Meridian is operated by the customer. The vendor has no access to the customer's SAP data and no back door into the deployment ([docs/diligence/operations.md](../diligence/operations.md)).
2. Vendor engineering therefore works from evidence the customer sends: the diagnostics bundle, the 8-character error reference shown on every server error, and the status page. See [monitoring-and-alerting.md](monitoring-and-alerting.md).
3. SAP stays the system of record. Lost findings can be rebuilt by re-extracting. Human decisions (approvals, fixes, assignments) cannot, so they are the data to protect.

The repository does not define support levels, severity levels, targets or support hours. Everything in this document marked "proposed, to agree" is a starting point for the customer service owner and the vendor delivery lead to agree.

## Support levels

| Level | Who | Handles | Typical actions |
|---|---|---|---|
| L1 | Customer service desk | First contact, triage, routing, user questions | Record the incident, capture the error reference and screen, check the status page, answer "how do I" questions from [frontend/docs/guide/](../../frontend/docs/guide/), route by category below |
| L2 | Meridian administrator, with the customer infrastructure or hosting team and the Basis team | Running the deployment | Runbooks in [runbooks.md](runbooks.md): health checks, restarts, updates, rollbacks, backups, restores, user and licence administration, SAP reconnection, re-running jobs, disk and log work |
| L3 | Vendor engineering | Product defects, data-loss risk, failed updates that rollback did not fix, licence-server problems, security issues in the product | Analyse the diagnostics bundle, ship a fixed release, advise on recovery |

### L1 routing

| The problem is about | Route to |
|---|---|
| How to use a screen, rule or report | Answer at L1 from the user guide, else Meridian administrator |
| Sign-in, locked account, missing access | Meridian administrator (see [access-and-security-operations.md](access-and-security-operations.md)) |
| "No authorisation to read this table", failed SAP connection test, failed extraction | Basis team, with the Meridian administrator |
| Site down, slow, error references on many screens | Meridian administrator and customer infrastructure or hosting team |
| Licence warning or 402 or 403 licence errors | Meridian administrator, then vendor engineering |
| A finding or rule result looks wrong | Meridian administrator, then vendor engineering with the rule id and record |
| Suspected security incident | Customer security team and vendor engineering at the same time |

## RACI

R is responsible, A is accountable, C is consulted, I is informed. Roles:

- SO: customer service owner
- MA: Meridian administrator (customer)
- INF: customer infrastructure or hosting team
- BAS: Basis team
- SD: customer service desk (L1)
- VE: vendor engineering (L3)
- SEC: customer security team

| Activity | SO | MA | INF | BAS | SD | VE | SEC |
|---|---|---|---|---|---|---|---|
| Log and triage incidents | I | C | | | R/A | | |
| Health checks and restarts | I | R/A | C | | | | |
| Apply an update with `update.sh` | A | R | C | I | I | C | |
| Approve a release for production | A | R | C | C | I | C | |
| Roll back a failed update | I | R/A | C | | I | C | |
| Schedule and verify backups | A | C | R | | | | |
| Restore from backup | A | R | R | | I | C | |
| Restore drill | A | R | R | | | | |
| User and role administration | I | R/A | | | | | C |
| Credential rotation | A | R | C | | | C | C |
| Meridian and Aletheia licence renewal | A | R | | | | R | |
| SAP connection and RFC user | I | C | | R/A | | | |
| SAP authorisation role | I | C | | R/A | | | C |
| Monitoring and alert receivers | A | C | R | | I | | |
| Vulnerability alerts on the product code | I | I | | | | R/A | C |
| Product defects and fixes | I | C | | | | R/A | |
| Security incidents | A | R | R | C | I | R | R |

The RACI is proposed, to agree. Who approves a production release is To confirm (owner: customer service owner).

## Severity levels

The repository defines no incident severity levels. The levels below are proposed, to agree.

| Severity | Definition | Examples |
|---|---|---|
| S1 Critical | Service down for all users, or risk of data loss or a security breach | `ApiDown` or `DatabaseErrors` alert; front door not answering; failed update that did not roll back; restore needed; `LicenceValidationFailing` causing 403 `licence_server_cutoff` |
| S2 High | A major function unavailable, no workaround | All extractions failing; worker not processing jobs; SAP connection lost for a production system; licence in `offline_grace` with the end near |
| S3 Medium | A function degraded, or a workaround exists | `HighErrorRate` or `HighP95Latency` alert; one object's extraction failing; `LlmUnreachable`; assistant features unavailable |
| S4 Low | Question, cosmetic issue or request | How-to questions; cosmetic layout issues; new user requests |

## Targets

The repository states no service levels. All targets are proposed, to agree (owner: customer service owner with the vendor delivery lead).

| Severity | First response | Update interval | Target to restore service |
|---|---|---|---|
| S1 | Proposed, to agree | Proposed, to agree | Proposed, to agree |
| S2 | Proposed, to agree | Proposed, to agree | Proposed, to agree |
| S3 | Proposed, to agree | Proposed, to agree | Proposed, to agree |
| S4 | Proposed, to agree | Proposed, to agree | Proposed, to agree |

Inputs for the restore target: [docs/ops/backup-restore.md](../ops/backup-restore.md) estimates about 10 minutes to restore on a warm host for a database under 1 GB, and `update.sh` waits up to 300 seconds for health before it rolls back by itself. The recovery objectives are discussed in [backup-and-dr.md](backup-and-dr.md).

## Support hours

- Customer L1 and L2 hours: To confirm (owner: customer service owner).
- Vendor L3 hours and out-of-hours cover for S1: To confirm (owner: vendor delivery lead).
- Contact channel for vendor engineering (ticket system, email or phone): To confirm (owner: vendor delivery lead). Do not record personal names or addresses in this pack; keep the contact list in the customer's service management tool.

## Escalation

### What to send with an escalation to L3

1. The error reference (8 hexadecimal characters) shown on the error screen.
2. The diagnostics bundle from Administration, "Download diagnostics bundle", or `GET /api/v1/support/diagnostics.zip`.
3. The running version: `grep MERIDIAN_VERSION /opt/meridian/docker/.env`.
4. The output of `docker compose -f docker/docker-compose.customer.yml ps`.
5. The time the problem started, what changed just before (update, configuration, SAP change), and the screen or job involved.

Check the bundle before sending it. It is meant for support, but the customer decides what leaves the site.

### When to escalate

| Condition | Escalate to |
|---|---|
| A runbook step fails, or the runbook does not cover the case | Next level up |
| `update.sh` failed and the automatic rollback also failed | Vendor engineering, S1 |
| `restore.sh` exits with code 1 and the cause is not clear | Vendor engineering, S1 |
| The same error reference repeats after a restart | Vendor engineering |
| Licence still invalid after "Check with Meridian HQ now" | Vendor engineering |
| Suspected security incident or data exposure | Customer security team and vendor engineering at once |

### Incident response

The repository has no dedicated incident response procedure. The only incident procedure is "Full restore (production incident response)" in [docs/ops/backup-restore.md](../ops/backup-restore.md). A full incident process, including security incident handling and post-incident review, is To confirm (owner: customer service owner, with the customer security team for security incidents).

## Change freeze rule

Never update Meridian while an extraction, sync or analysis is running. `update.sh` refuses to start while a `run_extraction` or `run_checks` task is active. See [change-and-release-management.md](change-and-release-management.md).
