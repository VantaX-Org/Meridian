# RAID log

Risks, assumptions, issues and dependencies for the customer deployment. Each item has an owner role and a status. Dates are from git history where the item came from a commit. Last reviewed: 9 November 2026.

Status values: Open, In progress, Waiting, Closed.

## Risks

| ID | Risk | Impact | Mitigation | Owner role | Status |
|---|---|---|---|---|---|
| R-01 | Load-tool validation against the customer's real import templates is not proven. The workbook tests use repository fixtures. | A migration file could pass Meridian and fail in the load tool. | Run section 4 of [go-live-acceptance-test.md](../journeys/go-live-acceptance-test.md) with a real workbook from the new system and the load tool's own validation. | Test lead | Open |
| R-02 | Some SuccessFactors mandatory columns were not matched to a source field. | The export could miss required values. | Closed in v0.0.635. Column names now come from the SuccessFactors dictionary, dependant columns join from the related person, and an added key column follows the sheet's spelling (`person-id-external` on import-style sheets). Checked against the customer's Employee and Foundation workbooks: every Foundation mandatory column is matched. Two Employee mandatory columns stay unmatched on the Pay Component sheet, which mixes recurring and non-recurring rows; they need a person to fill them. | Engineering lead | Closed |
| R-03 | Dependabot was removed on 9 November 2026 (commit 8bd66187d). Action pins, Dockerfile and compose digests now need a manual refresh (roadmap-and-debt D-32). | Known faults in dependencies could stay longer. | Refresh pins on a schedule. GitHub vulnerability alerts stay on, by the product owner's decision on 9 November 2026. | Engineering lead | Open |
| R-04 | The signed-in go-live acceptance run was not done. | Faults that only show with real accounts and data could reach users. | Done by the customer team on 9 November 2026 (see [test-strategy-and-report.md](test-strategy-and-report.md)). | Test lead | Closed |
| R-05 | The engine ran unlicensed until the licence settings were appended. | Engine features were limited. | Settings appended on 9 November 2026; the engine reports a valid licence on the server. | Customer administrator | Closed |

## Assumptions

| ID | Assumption | Owner role | Status |
|---|---|---|---|
| A-01 | The release version is v0.0.633. This comes from the patch bump in `build-and-deploy.yml` on a push to main. A manual run with minor or major would give another number. | Release manager | To confirm |
| A-02 | The customer licences only material master, SuccessFactors and customer master. | Commercial lead | Closed, confirmed and applied on 9 November 2026 (D-03) |
| A-03 | Meridian reads from SAP with a read-only role. Write-back happens only after approval. | SAP Basis | Open |
| A-04 | This release adds no database migrations. The alembic head stays at 149. | Engineering lead | Closed |

## Issues

| ID | Issue | Owner role | Status |
|---|---|---|---|
| I-01 | Cosmetic: column alignment in the Fix grid is not yet right. | Engineering lead | Closed, fixed in v0.0.634 |
| I-02 | Cosmetic: the "Usual range" text on Monitors wraps. | Engineering lead | Closed, fixed in v0.0.634 |
| I-03 | DD03L learning for ECC and S/4HANA is not built. SuccessFactors workbooks learn columns (commit 8bd66187d). ECC and S/4HANA do not yet learn fields from the data dictionary. | Engineering lead | Closed, built in v0.0.634 (DD03L lookup on workbook upload) |
| I-04 | The engine image pin was undecided. | Product owner | Closed, the product owner chose cortex0 1.8.0 on 9 November 2026 |
| I-06 | The Foundation workbook ships its picklist sheet (`Picklists_Original`) with no rows, so Meridian cannot check picklist values for that workbook. The Employee workbook carries 453 picklist values, and those are checked. | SAP team | Open, upload a picklist export from the new system |
| I-07 | Filling the customer's workbooks from the latest SuccessFactors run matched 135 of 544 Employee columns and 31 of 798 Foundation columns, because the run has no data for many columns. 39 Foundation and 3 Employee mandatory columns stay empty. The fill wrote a new workbook instead of the customer's own layout for both files. | Engineering lead | Open, extend the extraction to the missing fields and find why the layout export was not used |
| I-05 | The CI result for PR #639 could not be read when this log was written. | Release manager | To confirm |

## Dependencies

| ID | Dependency | Waiting on | Owner role | Status |
|---|---|---|---|---|
| D-01 | The engine licence settings had to be appended to `docker/.env` on the server by a person with sudo. Values are never put in the repository. | Customer administrator with sudo | Customer administrator | Closed, done on 9 November 2026 |
| D-02 | The embedded-engine grant had to be signed off by the licensor. | Licensor | Commercial lead | Closed, merged in the licensor's repository on 9 November 2026 (PR #26, commit 055482db) |
| D-03 | Licence narrowing to the three licensed modules. | Customer | Commercial lead | Closed, applied on the licence server on 9 November 2026. The tenant keeps 12 modules: material_master; sd_customer_master and business_partner (in S/4HANA a customer is a business partner); and the ten SuccessFactors modules employee_central, compensation, benefits, payroll_integration, performance_goals, succession_planning, recruiting_onboarding, learning_management and time_attendance. Menu items are unchanged. |
| D-04 | Real import templates from the new system are needed for R-01. | Customer SAP team | Programme lead | Waiting |
| D-05 | Support team acceptance of the hand-over pack in [docs/sustain/README.md](../sustain/README.md). | Support team | Project manager | Open |
