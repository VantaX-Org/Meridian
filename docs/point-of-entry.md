# Point of entry: stopping bad master data before it is saved

Meridian's data quality firewall judges a candidate record against your enabled rules and answers at once. This page shows how to put that answer in front of the SAP save for the three licensed objects: material master, customer master and SuccessFactors employee data.

What this is and is not. It is a synchronous check with a block or warn decision inside the SAP save. It is not a change workflow: there is no approval chain inside SAP and no staging area. A duplicate search is available on request (see below); it warns and never blocks. Meridian's change requests (`/api/v1/change-requests`) carry approvals, but they are separate from the save in SAP.

## What the firewall answers

`POST /api/v1/dq-firewall/validate` takes `{ "module": "material_master", "records": [ { "MARA.MATNR": "...", ... } ] }` (1 to 100 records, keys are `TABLE.FIELD` names the rule pack reads). Per record it returns:

| Value | Meaning | Entry behaviour |
| --- | --- | --- |
| `verdict: "block"` | at least one failing rule has severity `critical` | stop the save with an error message |
| `verdict: "pass"` with failures listed | only high, medium or low rules fail | show a warning, let the save go on |
| `verdict: "pass"`, no failures | nothing fails | stay silent |

The route returns only `block` and `pass`. "Warn" is derived by the caller: a `pass` that still lists failures. The Entry gate screen counts the same way.

## Fix suggestions (opt-in)

Add `"suggest": true` to the body and a failure may carry a `suggestion`. Without the flag the response is unchanged. A suggestion exists only when it is grounded in the failing rule itself:

- `kind: "value"`: the rule's own `auto_fix` steps produce a corrected value for what was sent (for example `KGM` becomes `KG` under rule MM016), and the same check engine re-judged the corrected record and the rule passes. `verified` is true.
- `kind: "allowed_values"`: the rule lists the values it accepts, shown with the labels the rule carries.

Every suggestion names its `rule_id` and `source`. If no grounded value exists, there is no `suggestion` key. Suggestions are computed in Meridian with no language model; the record values never leave the check engine. Values come from the rule definition, not from your live SAP check tables.

## Duplicate search at entry (opt-in)

Add `"duplicates": true` to the body and Meridian also looks for existing records that a candidate resembles. Without the flag the response is unchanged. It covers `material_master`, `sd_customer_master` and `business_partner`; for any other object the answer says nothing was searched.

It reuses the tenant's active match rules, their thresholds and the match engine, and searches the golden records Meridian already holds (`master_records`), not your live SAP tables. Candidates are found first by an exact match on the normalised value of each match field, then, for the free-text fields only (material description, customer name, business partner name) and only when the normalised key is at least 6 characters, by a pg_trgm similarity pass (threshold 0.5) that catches typos such as "Acme Holdngs" for "Acme Holdings". Tax numbers, part numbers and short keys are exact only. Every candidate is scored by the same engine; each match says `found_by` (`exact` or `similar`) and each record says whether the similar pass ran (`fuzzy.ran`, with a `reason` when it did not: `key_too_short`, `no_free_text_value`, `extension_missing`, `index_missing`). The similar pass needs the pg_trgm extension and the three trigram indexes from migration 135; if the migration role could not create them, the exact pass still runs and the response says so. Semantic rules are skipped and counted, so no language model runs. At most 50 candidates are scored per record and at most 10 matches are returned; when the cap cuts a search the record says `truncated: true`.

Per record the response carries `duplicates`: a `verdict` (`warn` when a match scores at or above the auto-merge threshold, otherwise `pass`), and for each match the existing record's key, its score, the threshold used, and for each field the similarity and whether it met its own threshold. It never carries the other record's field values. A duplicate warns and never blocks. The top level carries `duplicate_search`; when `searched` is false it gives a `reason` (`module_not_supported`, `no_match_rules`, `no_population`, or `no_block_field_in_population` when no existing record carries a field the search looks up, which is the case for a flat upload that kept its own column names), and that must not be read as "no duplicates". The same holds per record: `duplicates.searched` is false when the record has no usable value in a looked-up field (blank, a placeholder such as `N/A`, or a value with no ASCII letters or digits, so a name written only in a non-Latin script is not searched).

The audit entry records counts only (records searched, matches, warned and truncated records), never values or keys.

Measured once on a laptop: local Postgres 16 in Docker, about 1,000,000 synthetic material records in one tenant, three match rules, all block-key and trigram indexes built, table analysed, warm cache, called as a role with no superuser or row level security bypass, like the application role from migration 040. Medians of 21 runs for one record, 5 runs for a batch:

| Call | Median | Worst |
| --- | --- | --- |
| One record, part number only, so only the exact pass runs | 2.4 ms | 14.9 ms |
| One record with a typo in its description, found by the similar pass | 23.7 ms | 44.2 ms |
| One record with a planted duplicate, both passes | 26.1 ms | 69.2 ms |
| One record with no candidates, both passes | 4.7 ms | 6.4 ms |
| Batch of 100 records with no candidates | 319 ms | 325 ms |
| Batch of 100 records with a typo each | 2,185 ms | 2,192 ms |

These are database-and-engine times without HTTP, authentication or network, and one run on one machine, not a guarantee. The descriptions came from a small vocabulary, so many records share trigrams, and real text may be faster or slower. A batch runs its records one after another, so a batch of 100 that all hit takes seconds: keep batches out of the SAP save.

Both passes read the view `entry_duplicate_population` from migration 135, not `master_records`. Row level security keeps these expressions away from the indexes on the table itself, where the same exact lookup took 142 ms and the similar lookup 590 ms on 300,000 rows. The view filters on the tenant set for the transaction and fails closed when none is set. It is fast only when it is owned by a role that bypasses row level security, which is the case when migrations run as the database owner; on a managed Postgres where they do not, the search stays correct but slow and the migration logs a warning.

Limits: a typo is found only in the three free-text fields and only for keys of 6 or more characters (a typo in a tax number or part number is not found, on purpose, because a near match there is another taxpayer or another part); the similar pass dominates latency when it runs (see the table above); the similar pass shares the 50-candidate cap with the exact pass, exact first, and a search cut short says so; a record of the same number in another connected system is passed over with the record being saved, because a candidate does not name its system; and the population is as fresh as the last load into Meridian.

The sample ABAP passes `iv_duplicates = abap_true` and adds a warning line per match. It has not been run against a live SAP system.

## Route to a steward (opt-in)

Add `"route_to_steward": true` to the body and a record that is blocked, warned or flagged by the duplicate search is also opened as a change request of kind create, through the same change request machinery the Requests screen uses, and submitted so the tenant's active change request workflow routes it. Without the flag the response is unchanged, and a record that passes cleanly opens nothing.

Each flagged record carries `steward_request`. When a request was opened it holds `request_id` and `status`; open it in the Requests screen. The request carries the candidate as its payload, and a comment lists the failing rule ids with their severity and description, and the duplicate keys with their scores. The comment holds no field values. Whether a steward is assigned depends on the steps of the tenant's change request workflow: the gate submits the request and the workflow decides.

Repeats are idempotent. The key is the tenant, the object and the candidate content: an HMAC of the object and the sorted TABLE.FIELD values, keyed with the tenant secret, stored in `change_requests.entry_fingerprint` (migration 136). While a request for the same content is still open (draft, submitted, in approval, approved, being created or failed and waiting for a retry), the call returns that request with `existing: true` and adds none. A database unique index enforces this, so two parallel calls also open one. Once the request is rejected, cancelled or created, sending the same content again opens a new one. A failed request can be retried, so it keeps the content until someone cancels it. Any change to a value is new content and opens its own request. A tenant without a secret cannot form the key, so no request is opened and the answer says `not_opened`.

When no request is opened, there is no `request_id` and `reason` says why, so it never fails silently:

- `module_has_no_change_request`: the object has no change request type. This is the case for `employee_central` (SuccessFactors). Material master opens a material request, customer master a customer request, business partner a business partner request and accounts payable a vendor request. The object list of change requests is not widened for this.
- `over_limit`: at most 25 requests are opened per call; later flagged records get this reason.
- `not_accepted`: the change request refused the payload (for example a field it does not support). `detail` gives the first problems.
- `not_opened`: opening failed. The error is logged by its type, never with values, and the verdict is still returned with status 200.

Permission and requester. The endpoint already needs `mdm.write`, and that is enough to open a request. The requester is the caller. A person signed in to the Try a record panel is the requester. An SAP hook that calls with an API key is the key's service user, so the request names that service account and not the SAP user who pressed save; the gate does not know that person. Name the service account clearly so stewards can tell where the request came from.

Personal data. The candidate values are stored in the change request payload, exactly as for any change request, so a candidate with personal data is held there, and in the workflow's own records, until the request is closed. Do not use the flag for `employee_central` (it has no request anyway). Values are not logged and are never sent to a language model. Note that Meridian's general audit middleware keeps the request body of every successful POST, validate calls included; this feature does not change that.

The gate stays fast. Opening happens after the verdict is computed, one savepoint per record, and a failure to open never changes the verdict or the status code. Each opened request adds a database write and a workflow start, so keep `route_to_steward` for the Try a record panel and for batches, not for a save that waits on SAP.

The Entry gate screen has a checkbox for this under Try a record, a table of the requests it opened with their status and a link to each, and a panel listing the latest ten requests opened from the gate with their object and status.

## Setup

1. **API key.** In Admin, API keys, create a key for a service account whose only grant is the role holding `mdm.write` (the permission the endpoint requires). Give it no other scope and a short expiry you rotate on a calendar. Keep it in the SAP system, never in code.
2. **Network.** The SAP application server must reach the Meridian host over HTTPS. Allow only that host and port.
3. **SAP side (material and customer).** Create an HTTP destination of type G in SM59 named `MERIDIAN_FIREWALL`, TLS on, and set the request header `Authorization: Bearer mk_...` in the destination. Create message class `ZMERIDIAN` in SE91 with messages 001 and 002 (text `&1`). Install `sap/abap/Z_CL_MERIDIAN_ENTRY_GATE.abap`, then the material sample `sap/abap/Z_MERIDIAN_BADI_MATERIAL_CHECK.abap` as an implementation of BADI_MATERIAL_CHECK (method CHECK_DATA). Open the BAdI in SE18 first: its importing parameters differ by release, so map the structures in the sample to the real signature.
4. **Customer master.** `sap/abap/Z_MERIDIAN_CUSTOMER_CHECK.abap` is a form, not a BAdI implementation. Meridian does not name an enhancement spot here because the right one depends on whether you save through XD01/XD02 or through business partner transaction BP. Choose it with your basis team and call the form where screen data is complete and a message can still stop the save.
5. **Test.** Use the Try a record panel on the Entry gate screen, then save a deliberately bad material in a sandbox client.

## Timeouts

The sample waits 5 seconds (`c_timeout`). A check of one record takes about 0.1 second on the Meridian side, and the duplicate search adds tens of milliseconds; a user is waiting at the save, so keep the timeout short. Send one record per save.

## Fail open or fail closed

When Meridian cannot be reached, times out, rejects the key (401 or 403) or refuses the request (422), the firewall has given no verdict. You choose what the save does, per SAP system, with the TVARVC parameter `ZMERIDIAN_GATE_FAILMODE`:

- `OPEN` (default): the save goes on and the user sees a warning that the check could not run. Pick this when availability of data entry matters more than the check.
- `CLOSED`: the save is stopped. Pick this only for objects where a bad record is costlier than a blocked user, and only with a monitored Meridian.

Either way, an outage is visible: the Entry gate screen shows the calls it did receive, and a gap shows as a dash.

## SuccessFactors

SuccessFactors has no ABAP. The pattern, to be built with your SuccessFactors consultant, is to call the same endpoint from the place that runs when an employee record is created or changed: an Integration Center integration or a business rule callout that sends the record to an HTTPS endpoint and reads the verdict. This page does not name product APIs because the callout mechanism differs by tenant configuration; check the SuccessFactors documentation for your release.

- Module: `employee_central`. Send keys the pack reads, such as `EMPEMPLOYMENT.USERID`, `PERINFO.FIRSTNAME`, `PERINFO.LASTNAME` and `EMPEMPLOYMENT.START_DATE`. List the exact fields with the Try a record panel; an unknown field is refused with a plain sentence.
- Decision: treat `block` as a stop in the rule or integration, and a `pass` with failures as a warning to the HR user.
- Auth: the same firewall-scoped API key, held as a credential in SuccessFactors, never in the integration text.
- Mind the personal data: employee values travel to Meridian, which runs in your own environment and stores none of them (the audit row holds counts and rule ids). Confirm with your data protection officer before you send employee data.

## What Meridian stores

One audit row per call: the module, record counts, blocked and warned record counts, and the failing rule ids with counts, plus how many requests were opened when `route_to_steward` was used. Never a record value. The Entry gate screen reads these rows. A request opened from the gate is stored as a change request like any other, with the candidate as its payload.
