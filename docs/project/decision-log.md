# Decision log

Decisions found in the repository and git history. Each date is the commit date from `git log`. The evidence column names the commit or pull request. The decision maker for each item: To confirm (Project manager), unless stated.

| ID | Date | Decision | Reason given in the repository | Evidence |
|---|---|---|---|---|
| DL-01 | 2026-10-30 | Install one pinned release at a time. `scripts/update.sh` writes `MERIDIAN_VERSION` and keeps `MERIDIAN_PREVIOUS_VERSION`, and `--rollback` returns to the previous release. | Floating `latest` tags made installs hard to reproduce (roadmap-and-debt D-32). | PR #538, commit 3b3561757 |
| DL-02 | 2026-11-07 | Export migration data in the format of the target system's own workbooks. | Not stated in the commit. To confirm (Product owner). | PR #636, commit b772a6107 |
| DL-03 | 2026-11-08 | Open the app in light mode by default and drop the System theme option. | Stated in the commit "Default the app to light mode and drop the System theme option". | Commit 01198c087, merged in PR #637 (edb410fe5) |
| DL-04 | 2026-11-09 | SuccessFactors workbooks learn their columns, and the workbook check keeps learned columns. | When a target workbook carries a column that the extraction does not yet fetch, Meridian records it and adds it to the next extraction. Each learned property is checked against the tenant's own metadata, so no field is invented (commit 8bd66187d). | Commits 8bd66187d and c03e84505 |
| DL-05 | 2026-11-09 | Remove Dependabot. Pins are refreshed by hand. | Stated in roadmap-and-debt D-32. The reason for the removal itself: To confirm (Engineering lead). | Commit 8bd66187d |
| DL-06 | 2026-11-09 | Report workbook columns that the source system does not return, using the last run's coverage. | A learned column used to wait forever when the tenant never returns the property (commit 9ec6f0b23). | Commit 9ec6f0b23 |
| DL-07 | 2026-11-09 | Keep only the newest five pre-update backups. `BACKUP_KEEP` changes the number. | The backups folder had grown to 41 dumps of about 450 MB each. | Commit f143476e0 |
| DL-08 | 2026-11-09 | Run Meridian's own Aletheia engine as a sidecar service under the compose profile `aletheia`, and send it only aggregate metrics. | Stated in the commit "run Meridian's own Aletheia engine as a sidecar". | Commit b1a924cfa |
| DL-09 | 2026-11-09 | Cite the written Aletheia grant in the third-party notices, and keep the citation when the notices are regenerated. | The mark-and-name grant was given on 9 November 2026. | Commits d691ea16d and cd0cd76b1 |
| DL-10 | 2026-11-09 | Use one table spec on every page. Numbers right-align with `.m2-num`, and density tokens set the spacing. | Static tables ignored the density tokens the Grid uses, so rows looked cramped and uneven next to Grid screens (commit d5ed58989). | PR merge b92a69fa5, commit d5ed58989 |
| DL-11 | 2026-11-09 | Give tables that scroll sideways keyboard access below 760 pixels wide. | This fixed the axe `scrollable-region-focusable` failures at 390 pixels. | Commit 212edf03d |
| DL-12 | 2026-11-09 | Brand the training and guide PDFs from `public/brand/brand.json`. | Not stated in the commit. To confirm (Product owner). | Commit 5b0f40d7b |
| DL-13 | 2026-11-09 | Re-record the 31 guided tour videos against the fixture build at 1440 by 900 and 15 frames a second, with posters and captions. | Recorded in fixture mode with the demo flag, so every screen shows demo data only (commit 1935b338c). | Commit 1935b338c, merge 4d8e7ea64 |
| DL-14 | 2026-11-10 | Support schema rollback with down-migrations. Downgrades that would lose data the older schema cannot hold raise `NotImplementedError` (revision 030); downgrades of seeded rows delete them. The pre-update dump stays the fallback. | Debt row D-22: a rollback restored images only, and the older release could need the dump for any schema change. | This change (D-22) |

| DL-14 | 2026-11-09 | Fill a SuccessFactors dependant's columns from the related person, and add a missing person key in the sheet's own spelling. | The dependant sheets hold the related person's own data, and import-style sheets use kebab-case headers such as `person-id-external`. | v0.0.635 |
| DL-15 | 2026-11-09 | The customer licence keeps 12 modules: material master, customer master with business partner, and the ten SuccessFactors modules. | The customer licences material master, SuccessFactors and customer master only. Business partner stays because a customer is a business partner in S/4HANA. | Licence server change, 9 November 2026 |
| DL-16 | 2026-11-09 | Move the engine image pin to cortex0 1.8.0. | Product owner decision. | Closes DO-01 |
| DL-17 | 2026-11-10 | Give each object a cleaning workbook in Excel, with every failing record and field, the current and suggested value, the rule, why it failed and the fix steps. | The data owners clean in Excel and need the full list, not only a summary. Suggested values come only from the run, the rule's automatic fix or its value map. | Release v0.0.636 |
| DL-18 | 2026-11-10 | Data-subject requests also cover change request comments and attachments, write-back run records, comments, watches, notifications, undo entries, webhook deliveries, exceptions and their comments, and the sample keys in field dependencies and rule proposals. Shared rows are scrubbed, not deleted, and erasure clears the tenant's response cache. | Debt row D-27: these stores can hold a subject's record key or values. Audit rows stay scrubbed for retention. | docs/sustain/data-subject-coverage.md |
| DL-19 | 2026-11-10 | Admin, Users shows each role's description beside its name, and the user import preview shows each role code with its name. | Every code in a table shows its text beside it. | This pull request |
| DL-21 | 2026-11-10 | Rule packs build date parts from `.dt.year`, `.dt.month` and `.dt.day`, never `.dt.strftime`, and a test fails any pack that uses it. Employee Central gains rules EC713 to EC727 for names, self-parents, date order, shift code, third nationality, negative amounts and expired work permits. | `.dt.strftime` raises on columns that hold only empty dates or mixed types, so 17 Employee Central rules could error instead of run. The new rules cover fields that had no check. | `tests/test_sf_ec_audit_rules.py` |
| DL-22 | 2026-11-10 | Let the migration workbook's columns drive the extraction for every module. Each column is resolved against the live schema ($metadata or DDIC), added to the extract and dictionary, and columns the system lacks are reported as not in the system. | The SuccessFactors workbook export filled only external codes because column spellings, country-specific sheets and kebab-case ids did not match the extract. Product owner decision. | v0.0.639 |
| DL-23 | 2026-11-10 | Audit every rule pack rule by rule, and add a rule only when it can be proven against fields that exist in the SAP dictionary. A rule that needs a field Meridian does not extract widens the extract instead of being dropped. | Rules that reference invented fields fail silently on real data, and the customer asked for the most comprehensive rule set. | Product owner |

## Decisions still open

| ID | Decision needed | Owner role |
|---|---|---|
| DO-02 | Hyper-care length and exit criteria. | Project sponsor |

See the [RAID log](raid-log.md) for the items these decisions affect.

