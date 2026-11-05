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

It reuses the tenant's active match rules, their thresholds and the match engine, and searches the golden records Meridian already holds (`master_records`), not your live SAP tables. Candidates are found by an exact match on the normalised value of each match field, then scored by the same engine. Semantic rules are skipped and counted, so no language model runs. At most 50 candidates are scored per record and at most 10 matches are returned; when the cap cuts a search the record says `truncated: true`.

Per record the response carries `duplicates`: a `verdict` (`warn` when a match scores at or above the auto-merge threshold, otherwise `pass`), and for each match the existing record's key, its score, the threshold used, and for each field the similarity and whether it met its own threshold. It never carries the other record's field values. A duplicate warns and never blocks. The top level carries `duplicate_search`; when `searched` is false it gives a `reason` (`module_not_supported`, `no_match_rules`, `no_population`, or `no_block_field_in_population` when no existing record carries a field the search looks up, which is the case for a flat upload that kept its own column names), and that must not be read as "no duplicates". The same holds per record: `duplicates.searched` is false when the record has no usable value in a looked-up field (blank, a placeholder such as `N/A`, or a value with no ASCII letters or digits, so a name written only in a non-Latin script is not searched).

The audit entry records counts only (records searched, matches, warned and truncated records), never values or keys.

Measured once on a laptop: local Postgres 16 in Docker, about 1,000,000 material records in one tenant, three match rules, the eight block-key indexes built, table analysed, warm cache, a superuser role (so row level security was not in the timing). One record with one planted duplicate took 1.0 ms at the median (21 runs, 1.6 ms worst); a record with no candidates took 0.8 ms; a batch of 100 records took 44.8 ms at the median (49.1 ms worst). These are database-and-engine times without HTTP, authentication or network, and one run on one machine, not a guarantee.

Limits: a typo in a match field's value is not found, because candidates are found by exact normalised value; a record of the same number in another connected system is passed over with the record being saved, because a candidate does not name its system; there is no steward workflow at entry; and the population is as fresh as the last load into Meridian.

The sample ABAP passes `iv_duplicates = abap_true` and adds a warning line per match. It has not been run against a live SAP system.

## Setup

1. **API key.** In Admin, API keys, create a key for a service account whose only grant is the role holding `mdm.write` (the permission the endpoint requires). Give it no other scope and a short expiry you rotate on a calendar. Keep it in the SAP system, never in code.
2. **Network.** The SAP application server must reach the Meridian host over HTTPS. Allow only that host and port.
3. **SAP side (material and customer).** Create an HTTP destination of type G in SM59 named `MERIDIAN_FIREWALL`, TLS on, and set the request header `Authorization: Bearer mk_...` in the destination. Create message class `ZMERIDIAN` in SE91 with messages 001 and 002 (text `&1`). Install `sap/abap/Z_CL_MERIDIAN_ENTRY_GATE.abap`, then the material sample `sap/abap/Z_MERIDIAN_BADI_MATERIAL_CHECK.abap` as an implementation of BADI_MATERIAL_CHECK (method CHECK_DATA). Open the BAdI in SE18 first: its importing parameters differ by release, so map the structures in the sample to the real signature.
4. **Customer master.** `sap/abap/Z_MERIDIAN_CUSTOMER_CHECK.abap` is a form, not a BAdI implementation. Meridian does not name an enhancement spot here because the right one depends on whether you save through XD01/XD02 or through business partner transaction BP. Choose it with your basis team and call the form where screen data is complete and a message can still stop the save.
5. **Test.** Use the Try a record panel on the Entry gate screen, then save a deliberately bad material in a sandbox client.

## Timeouts

The sample waits 5 seconds (`c_timeout`). A check of one record takes about 0.1 second on the Meridian side; a user is waiting at the save, so keep the timeout short. Send one record per save.

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

One audit row per call: the module, record counts, blocked and warned record counts, and the failing rule ids with counts. Never a record value. The Entry gate screen reads these rows.
