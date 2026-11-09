# Known issues

This list helps the support team recognise known defects, limits and debt so they are not logged as new incidents. Each item names the owner role and the proposed handling. Handling is proposed, to agree, until the item is accepted at hand-over (see exit criterion 7 in [README.md](README.md)).

The sources are the [RAID log](../project/raid-log.md), the release notes in [docs/releases/](../releases/README.md), the debt register in [docs/diligence/roadmap-and-debt.md](../diligence/roadmap-and-debt.md) and [docs/PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md). Those documents stay the record. When an item there changes, update this list.

## Open items for the current release

| Item | What the support team will see | Owner role | Proposed handling |
|---|---|---|---|
| Some SuccessFactors mandatory columns are unmatched by design | The Migration screen reports workbook columns that the source system does not return, using the last run's coverage (RAID R-02). | Meridian administrator with the SAP team | Review the unmatched columns before each migration load. The column list: To confirm (owner: vendor engineering). |
| Binary, macro and OpenDocument workbooks come back as .xlsx | A user uploads a `.xls`, `.xlsb`, `.xlsm` or `.ods` workbook and receives a `.xlsx` file. This is by design: no writer for those formats is installed (`api/services/migration/workbook_formats.py`). Macros in an `.xlsm` upload are not in the returned file. | Meridian administrator | Accepted limit. L1 answers from this entry. |
| Aletheia engine image pin is undecided | The compose default is `ghcr.io/vantax-org/cortex0:1.7.0`, set through `MERIDIAN_ALETHEIA_IMAGE`. Moving to 1.8.0 is not decided (RAID I-04). | Vendor engineering, with the product owner | Do not change the pin on the customer deployment until the decision is made. |
| Aletheia engine runs unlicensed until its settings are added | Administration, Aletheia engine shows the engine unlicensed (RAID R-05). | Meridian administrator, with a person who has sudo on the host | Append the engine settings to `docker/.env` and rerun the update for the running version, as described in the release notes. |
| Signed-in go-live acceptance run not done | No signed-in tester has run [docs/journeys/go-live-acceptance-test.md](../journeys/go-live-acceptance-test.md) on the customer deployment (RAID R-04). | Customer test lead | Run it before users are told the release is ready. A fail in sections 1 to 3 stops the release. |
| Load-tool validation is not proven | A migration file can pass Meridian and fail in the target load tool. The workbook tests use repository fixtures (RAID R-01). | Customer test lead | Run section 4 of the acceptance test with a real import template. |
| Licence narrowing waits for the customer's go-ahead | Modules beyond the licensed scope may still be visible (release notes, known issues). | Vendor delivery lead | Narrow when the customer confirms. |

## Debt register items that affect support

Only open or partly fixed items that a support team can meet are listed. Read the full row in [roadmap-and-debt.md](../diligence/roadmap-and-debt.md) before acting.

| ID | Status in the register | Effect on support | Owner role | Proposed handling |
|---|---|---|---|---|
| D-22 | Partly fixed | A rollback restores images, not the database schema. There are no down-migrations. If the newer release migrated the database, the rolled-back release may need the pre-update dump. | Vendor engineering | Always keep the pre-update dump that `update.sh` names. See [change-and-release-management.md](change-and-release-management.md). |
| D-24 | Open | Analysis throughput is measured on a synthetic run only. A large real analysis may take longer than expected. | Vendor engineering | Record the duration of the first real large analysis and send it to vendor engineering. |
| D-27 | Partly fixed | Data-subject requests (Administration, Data subject requests) do not cover every place a personal value can sit. | Vendor engineering, with the customer privacy officer | For a subject request, check the register's list of uncovered places and handle those by hand. |
| D-28 | Half closed | A frontend test can fail under CPU load. This affects CI only. | Vendor engineering | No support action. |
| D-32 | Partly fixed | Dependabot was removed on 9 November 2026. Action pins, Dockerfile and compose digests need a manual refresh. `docker/docker-compose.updater.yml` uses `meridian-updater:latest`. | Vendor engineering | Refresh pins on a schedule. See [access-and-security-operations.md](access-and-security-operations.md). |
| DR-1 | Open | The demo and end-to-end tests run on frontend fixtures. The tour videos show demo data only. | Vendor engineering | Train on the customer deployment, not only on the videos. |
| DR-2 | Open | Live write-back to on-premise SAP sends nothing: `BAPI_FIELDS` is empty and live write-back is off by default. Corrections reach SAP by export. | Vendor engineering | Accepted limit. L1 answers "why did my fix not reach SAP" from this entry and the administrator training, Module 7. |
| DR-5 | Open | Most commits are by one principal engineer. This is a key-person risk for L3. | Vendor delivery lead | Covered by the contractual items in the register. Not a support action. |
| PC-1 | Open | On-premise extraction depends on `RFC_READ_TABLE`. It needs `S_RFC` on `SDTX` and table-read rights (`S_TABU_NAM` or broad `S_TABU_DIS`), and returns rows in a 512-byte work area. Many Basis teams refuse it in production. | Basis team | Use the role template in [docs/sap/authorisation-role-template.md](../sap/authorisation-role-template.md). Route authorisation errors to the Basis team. |

Items the register marks fixed are not repeated here, including D-01 (Python source in the API image), D-35 (background catalogue rebuild), PC-3 (money-at-risk shown as an estimate) and PC-7 (SheetJS now vendored, so `npm ci` needs no external host). Money amounts stay estimates from the tenant's cost model; L1 should say so if asked.

## Security and readiness gaps

| Item | Source | Owner role | Proposed handling |
|---|---|---|---|
| No web application firewall in front of nginx | [docs/PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md) | Customer infrastructure or hosting team | Decide whether the customer network provides one: To confirm (owner: customer security team). |
| No SBOM attached to release tags | PRODUCTION_READINESS.md | Vendor engineering | Accepted until a release adds one. |
| `npm audit` reported 3 high and 8 moderate findings | PRODUCTION_READINESS.md | Vendor engineering | Whether these are still current: To confirm (owner: vendor engineering). |
| The eight go-live gates in PRODUCTION_READINESS.md were unchecked as of 24 April 2026 | PRODUCTION_READINESS.md | Vendor delivery lead | Current state: To confirm (owner: vendor delivery lead). Use the [cutover and go-live plan](../project/cutover-and-go-live-plan.md) for this deployment. |
| `MERIDIAN_LICENCE_ALLOW_LEGACY_SIGNATURES` is on by default | `api/config.py`, debt row DR-3 | Vendor engineering | Stays on until the licence worker uses Ed25519 signing. A later release turns it off. No customer action. |

## Fixed in v0.0.634

- ECC and S/4HANA target workbooks now learn columns from the SAP data dictionary (DD03L). A column held by one table is added to the next extraction. A column held by several tables is listed on the Migration screen with those tables, and the user names the table in the header as TABLE-FIELD. A column held by none is reported as not in the system (RAID I-03). Limit: lookups are cached in the API process, so a field added in SE11 is seen after the next restart or update.
- The Fix grid "Object and run" column lines up, and the Monitors "Usual range" text no longer wraps (RAID I-01, I-02).

## Documentation errors (fixed in v0.0.634)

Release v0.0.634 fixed the faults this section used to list:

- [docs/troubleshooting.md](../troubleshooting.md) now uses the customer compose file, the `ollama` service from its overlay (`OLLAMA_BASE_URL=http://ollama:11434`), the `meridian` database user and name, the `MERIDIAN_LICENCE_*` settings, and the health check through nginx at `http://127.0.0.1/health`.
- `scripts/healthcheck.sh` checks nginx at `http://127.0.0.1/health`. `MERIDIAN_HEALTH_URL` overrides the address.
- Each alert in `docker/monitoring/prometheus/alerts.yml` has a `runbook_url` annotation that points to the alert table in [monitoring-and-alerting.md](monitoring-and-alerting.md).
- `scripts/manage_users.py` uses the deployment's `MERIDIAN_TENANT_ID`, the same setting the API reads. Without it, the single-tenant default applies, as in the API.

## How to add an item

1. Check the RAID log and the debt register first. If the item is there, link to it.
2. Add a row with the symptom as a user or operator sees it, the owner role and the handling.
3. Never add customer names, host names, addresses, personal names or secrets.
