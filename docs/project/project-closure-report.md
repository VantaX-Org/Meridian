# Project closure report

Status: draft. Sign-off is open. This report covers delivery up to release v0.0.633.

## Delivery against objectives

The objectives are in the [project charter](project-charter.md). Evidence is in the [traceability table](requirements-traceability.md).

| # | Objective | Delivered | Open |
|---|---|---|---|
| 1 | Extract from ECC, S/4HANA and SuccessFactors | RFC, ODP and SuccessFactors connectors with tests | None found in the repository |
| 2 | Deep rule pack for each licensed object | Material master 1,076 rules, customer master 803 rules, SuccessFactors 1,866 rules. The README quotes 9,349 rules and 11,113 proof cases across all packs. | DD03L learning for ECC and S/4HANA is not built |
| 3 | Traceable data-quality score | Scoring services and score history with tests | None found in the repository |
| 4 | Fix with approval and audit | Proposals, workflows, change requests and write-back with tests | Fix grid column alignment (cosmetic) |
| 5 | Monitoring after cleansing, shown in the UI | Learned monitors and object monitors with screens and tests | Monitors "Usual range" wrap (cosmetic) |
| 6 | Migration output in the target workbook format | Workbook formats, self-learning SuccessFactors workbooks, coverage gaps reported | Some SuccessFactors mandatory columns unmatched. Load-tool validation against real templates unproven. |
| 7 | Hand-over with guides, training and videos | Branded user guide and admin training PDFs, 31 re-recorded tour videos, project and release documents, sustain pack | Support team acceptance |

The go-live acceptance run in [docs/journeys/go-live-acceptance-test.md](../journeys/go-live-acceptance-test.md) is still to be done. Closure depends on it.

## Open items carried into sustain

These items move to the support team with the hand-over in [docs/sustain/README.md](../sustain/README.md). The full list with owners is in the [RAID log](raid-log.md).

1. Prove load-tool validation against the customer's real import templates.
2. Fill the two Pay Component mandatory columns by hand before each load.
3. Upload a picklist export for the Foundation workbook.
4. Refresh dependency pins by hand, because Dependabot is removed.

Closed by 9 November 2026: the engine licence settings, the licensor's grant sign-off, the engine pin (1.8.0), DD03L learning for ECC and S/4HANA, the SuccessFactors column names, the signed-in acceptance run, the licence narrowing and the table cosmetics.

## Lessons learned

These come from the commit history of the last release.

- Backups need a retention rule from the start. The backups folder grew to 41 dumps of about 450 MB each before retention was added (commit f143476e0).
- Phone-width accessibility checks find real faults. The axe checks at 390 pixels found tables that a keyboard could not scroll (commit 212edf03d).
- One table spec for every page is easier to keep right than per-page styles (commit d5ed58989).
- Guides, videos and training drift from the code. They had to be brought in line with the screens and with `update.sh` in the same release (commits 50a95f77c, c8be3e4a8 and 1935b338c).
- Automated tests run in fixture mode and cannot sign in to production. A signed-in acceptance run is the only proof with real accounts and data (go-live-acceptance-test.md).
- Licence citations must survive regeneration of the notices file (commit cd0cd76b1).

Further lessons from the project team: To confirm (Project manager).

## Sign-off

| Role | Decision | Date |
|---|---|---|
| Project sponsor | To confirm | To confirm |
| Product owner | To confirm | To confirm |
| Project manager | To confirm | To confirm |
| Engineering lead | To confirm | To confirm |
| Test lead | To confirm | To confirm |
| Customer administrator | To confirm | To confirm |
| Support team lead | To confirm | To confirm |
