# RAID log

Risks, assumptions, issues and dependencies for the customer deployment. Each item has an owner role and a status. Dates are from git history where the item came from a commit. Last reviewed: 9 November 2026.

Status values: Open, In progress, Waiting, Closed.

## Risks

| ID | Risk | Impact | Mitigation | Owner role | Status |
|---|---|---|---|---|---|
| R-01 | Load-tool validation against the customer's real import templates is not proven. The workbook tests use repository fixtures. | A migration file could pass Meridian and fail in the load tool. | Run section 4 of [go-live-acceptance-test.md](../journeys/go-live-acceptance-test.md) with a real workbook from the new system and the load tool's own validation. | Test lead | Open |
| R-02 | Some SuccessFactors mandatory columns are not matched to a source field. Commit 9ec6f0b23 reports workbook columns the source system does not return, using the last run's coverage. | The export could miss required values. | Review the unmatched columns with the SAP team. The column list: To confirm (Engineering lead). | Engineering lead | Open |
| R-03 | Dependabot was removed on 9 November 2026 (commit 8bd66187d). Action pins, Dockerfile and compose digests now need a manual refresh (roadmap-and-debt D-32). | Known faults in dependencies could stay longer. | Refresh pins on a schedule. GitHub vulnerability alerts stay on, by the product owner's decision on 9 November 2026. | Engineering lead | Open |
| R-04 | The signed-in go-live acceptance run is not yet done. | Faults that only show with real accounts and data could reach users. | Run it before users are told the release is ready. | Test lead | Open |
| R-05 | The engine runs unlicensed until the licence settings are appended. | Engine features are limited. | Append the settings (D-01) and rerun the update for the running version. | Customer administrator | Open |

## Assumptions

| ID | Assumption | Owner role | Status |
|---|---|---|---|
| A-01 | The release version is v0.0.633. This comes from the patch bump in `build-and-deploy.yml` on a push to main. A manual run with minor or major would give another number. | Release manager | To confirm |
| A-02 | The customer licences only material master, SuccessFactors and customer master. | Commercial lead | Open |
| A-03 | Meridian reads from SAP with a read-only role. Write-back happens only after approval. | SAP Basis | Open |
| A-04 | This release adds no database migrations. The alembic head stays at 149. | Engineering lead | Closed |

## Issues

| ID | Issue | Owner role | Status |
|---|---|---|---|
| I-01 | Cosmetic: column alignment in the Fix grid is not yet right. | Engineering lead | Closed, fixed in v0.0.634 |
| I-02 | Cosmetic: the "Usual range" text on Monitors wraps. | Engineering lead | Closed, fixed in v0.0.634 |
| I-03 | DD03L learning for ECC and S/4HANA is not built. SuccessFactors workbooks learn columns (commit 8bd66187d). ECC and S/4HANA do not yet learn fields from the data dictionary. | Engineering lead | Closed, built in v0.0.634 (DD03L lookup on workbook upload) |
| I-04 | The engine image pin is undecided. The compose default is cortex0 1.7.0. Moving to 1.8.0 is not decided. | Product owner | Open |
| I-05 | The CI result for PR #639 could not be read when this log was written. | Release manager | To confirm |

## Dependencies

| ID | Dependency | Waiting on | Owner role | Status |
|---|---|---|---|---|
| D-01 | The engine licence settings (ALETHEIA_DEPLOYMENT_ID, ALETHEIA_LICENSE_KEY, ALETHEIA_TOKEN and MERIDIAN_ALETHEIA_IMAGE) must be appended to `docker/.env` on the server. Only a person with sudo on the server can do this. Values are never put in the repository. | Customer administrator with sudo | Customer administrator | Waiting |
| D-02 | The embedded-engine grant must be signed off by the licensor. The mark-and-name grant was given on 9 November 2026. The embedded-deployment extension is drafted but not yet signed off or merged by the licensor ([licences.md](../diligence/licences.md) section 6). | Licensor | Commercial lead | Waiting |
| D-03 | Licence narrowing to the three licensed modules waits for the customer's go-ahead. | Customer | Commercial lead | Waiting |
| D-04 | Real import templates from the new system are needed for R-01. | Customer SAP team | Programme lead | Waiting |
| D-05 | Support team acceptance of the hand-over pack in [docs/sustain/README.md](../sustain/README.md). | Support team | Project manager | Open |
