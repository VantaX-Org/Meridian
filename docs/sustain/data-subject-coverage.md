# Data-subject request coverage map

This map lists every place in Meridian that can hold a data subject's record, and says what Administration, Data subject requests does with it. The service is `api/services/subject_requests.py`. A subject is found by record key, for example `PERNR=00001234`. Use this map with debt row D-27 in [roadmap-and-debt.md](../diligence/roadmap-and-debt.md) and the [known issues](known-issues.md).

## How the request works

- **Search and export** read every store marked "Covered" below and return one JSON file per table, plus the matching rows from the extracts.
- **Erasure** runs a dry run first, then the real run. The database part commits first. Cached API responses for the tenant are then cleared. Then the extract files are rewritten without the subject's rows.
- **Delete** removes the row. **Scrub** keeps the row and clears the key and the values, so totals, history and audit stay intact.
- **Retention rules.** Erasure is refused while a single-record change request on the subject is still open (draft, submitted, in approval, approved, creating or failed). Audit rows are never deleted. They are scrubbed and match the full key only. The repository has no legal-hold flag. A hold must be applied by not running the erasure.
- **Suppression.** When an erasure completes, a keyed hash of the key goes on the suppression list, so a later extract drops the record again.

## Stores covered by the request

| Store | Action | What happens and why |
|---|---|---|
| finding_records, record_issues, work_records, record_hashes, remediation_items, rule_suppressions | Delete | Findings, issues, work items and fingerprints exist only for the record. |
| data_anomalies, config_matches, migration_gap_findings, record_fixes | Delete | Per-record results of checks and fixes. |
| data_duplicates, dedup_candidates, match_scores, record_relationships, mdm_pair_constraints | Delete | Any pair or link that includes the subject. |
| master_records, master_record_history, survivorship_decisions, golden_writeback_requests | Delete | Golden records built from the subject and their history. |
| mdm_merge_events | Scrub | The merge event stays for the golden record's history. The subject's key and values go. |
| cleaning_queue, cleaning_audit | Scrub | The cleansing history stays. The key and the before and after values go. |
| change_requests, change_request_field_changes | Scrub | Closed requests stay for approval history. The key, title, content and old and new values go. |
| change_request_comments, change_request_attachments | Delete | The thread on the subject's single-record change requests, and any comment that names the key. A mass change keeps its thread, because it is about many records. The attachment row is removed. The file itself is stored outside Meridian. |
| migration_export_files, migration_reconciliations | Scrub | The file or run stays. The subject's keys and rows go from the lists inside it. |
| writeback_run_records | Scrub | The row and its state stay for the run's totals. The key, the values sent, the result and the error go. |
| comments, watches | Delete | Comments and watches on the record, and comments whose text names the key. |
| notifications | Delete | Any notification whose title, body or link names the key. |
| undo_actions | Delete | An undo entry would write the subject's values back, so it goes. |
| webhook_deliveries | Scrub | The delivery row stays for the webhook's history. The payload is cleared. The export leaves the payload out. |
| field_dependencies, learned_rule_proposals, exceptions | Scrub | These keep up to 20 sample keys across many subjects. Only the subject's keys leave the sample lists. The export leaves the sample lists out, so it shows no other subject's key. |
| exception_comments | Delete | Comments on exceptions whose text names the key. |
| audit_log | Scrub | Kept for audit retention. Rows that carry the full key lose their before and after values. |
| Extract files in the object store (`staging/<tenant>/`) | Rewrite | The subject's rows are removed and the file is written again. |
| Migration export snapshots (`migration-snapshots/<tenant>/`) | Rewrite | The subject's rows are removed from each snapshot table and its digest is recomputed. A snapshot that cannot be rewritten is deleted whole. |
| Cached API responses (Redis) | Clear | The tenant's response cache is cleared after the database part commits. |

## Stores not covered by the request

| Store | Why it is not covered | How to handle it |
|---|---|---|
| Raw uploaded workbooks (`uploads/<tenant>/`), report files (`reports/<tenant>/`), findings archives (`archive/<tenant>/`) and export packages | Files in many formats. The service does not parse and rewrite them. | Delete the files by hand from the upload, report or export screen, or let the tenant's retention policy purge them. |
| workflow_events, workflow_tasks and approval comments | Kept as the approval trail. They match on request id, not on record key. | Review them by hand if the request needs it. |
| llm_audit_log | Holds a hash of each prompt, never the prompt text, so it holds no record value. | No action needed. |
| Application users: users, api_keys, saved_views, scim_users, share_links, user_role_scopes, and the actor, address and browser columns of audit_log | These are about people who use Meridian, not about subjects in SAP data. | Use Administration, Users to deactivate or delete the user. Deactivation also ends every session, because it raises the user's token version. |
| Free text that names the subject by something other than the full key | Search is by record key. Free text matches on the full key only. | Search the text by hand for names or other values. |
| Database and object store backups | Out of reach of a running service. | Let the backups expire under the backup policy. See [backup-and-dr.md](backup-and-dr.md). |
| The source SAP system | Meridian does not delete from SAP. SAP stays the system of record. | The customer erases the record in SAP. |

## Tests

- `tests/test_subject_requests_pg.py` seeds one subject in every covered store, in two tenants and next to a second subject. It proves the export finds every store and holds no other subject's key, and that erasure leaves no row for the subject while the other subject and the other tenant keep theirs.
- `tests/test_subject_requests_coverage.py` checks the target list and the SQL it builds without a database.
