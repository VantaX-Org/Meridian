# Friction audit of v0.0.542

Every journey of this folder walked through today's product, measured, and the friction written down so each finding
can be reproduced from its address and steps. Measured on 30 Oct 2026 against `main` at v0.0.542.

## Method

- **Build**: the demo build of the frontend, `NEXT_PUBLIC_MERIDIAN_DEMO=1 npm run build`, served standalone
  (`npm run start:standalone`, port 3300). No backend: every read is answered from `lib/api/v2/fixtures` (`?fixture=1`),
  every `/api/v1` call is refused, as in the e2e specs.
- **People**: each role signs in as its own browser context with `?fixture=1&role=<key>` (the way
  `e2e/v2-roles.spec.ts` sets a role) and the start-screen persona of that role. Fixture mode reads the role from the
  address only, so a client-side link drops it; the walker put it back with a reload after each navigation (no click
  counted) so every step ran with the role's real permissions.
- **Walk**: a Playwright script clicked each journey the way a person would, from the start screen, through visible
  controls only (map, next-step buttons, inspector actions, the account menu, the command line where no control
  exists). It counted every click, acting key press and list selection, and the fields typed; it recorded the screens
  (path plus the inspector kind), the toasts, the downloads and every control it could not find. Chromium 1194 at
  1440 by 900 and 390 by 844, light theme.
- **Phone width**: at 390 the map is a sheet behind **Map** and the inspector fills the screen, so a step that crosses
  from the inspector to the canvas or the map costs a **Close** and a **Map** click. Where the phone walk completed
  the count is measured; where the automation was defeated by the sheet's animation the count is the 1440 path plus
  those extra clicks, marked "computed", and each phone-only finding was confirmed by hand.
- **Code**: hand-offs were checked in the API as well as on screen, because the fixtures answer for a backend
  (for example, the fixture inbox shows a notice the API never writes). The file and line are named in the finding.
- **What fixture mode cannot measure**: server time. Every interaction answered at once, so waits are listed where the
  product itself says a person waits (extraction, analysis, report build), not timed.
- **Screenshots**: `img/`, fixture data only, each with the "Demo data" bar.

## Measured clicks against targets

| Journey | Target | 1440 measured | 390 | Screens (1440) | Typed fields | Meets target |
|---|---|---|---|---|---|---|
| [First live week](first-live-week.md) (licence, connect, dry run and extract, run, three rules proved, cost model, one invite) | 30 | 28 | 34, computed | 13 | 9 | Yes in clicks; no without knowing `⌘K` for **Connect a system** (F02) and choosing three rules by reading each (F03) |
| [Find, fix, approve, send](find-fix-approve-send.md): steward | 5 | 4 | 4 | 2 | 0 | Yes |
| Find, fix, approve, send: owner | 4 | 3 | 3 | 1 | 0 | Yes in clicks; the owner is not told the batch waits (F06) and **Send to SAP** only downloads a file (F08) |
| Find, fix, approve, send: verify on the next run | 3 | 3 | 4 | 2 | 0 | No: rule-level only, nothing per batch (F09) |
| [Migration wave](migration-wave.md): setup (waves, gate, readiness, simulate) | 12 | 9 | Blocked | 4 | 0 | Yes at 1440 (plus 2 to pin the baseline); blocked at 390, no **Edit** (F35) |
| Migration wave: go or no-go on the day | 4 | 4 | 5, computed | 1 | 0 | Clicks yes; the refusal is a toast (F18) |
| [Basis operations](basis-operations.md): one refused credential, start to fixed and retried | 3 to the fix | 3 to the credentials, 8 to fixed and retried | 10, computed | 4 | 2 | No (F21) |
| Basis operations: edit a schedule | 2 | 3 | 4, computed | 2 | 0 | No (F23) |
| [Audit](audit.md) | 12 | 14 | 17, computed | 6 | 0 | No, and two exports are incomplete or unfiltered (F25, F26) |
| [Monthly governance](monthly-governance.md) | 10 | 12 | 15, computed | 10 | 0 | No; the digest is out of the lead's reach (F29) |
| [New master data request](new-master-data-request.md) | 6 | Not built | Not built | | | Target, being built |

Per-step logs of the walk (the step, the role, the address after it, the running count) are reproducible with the
method above; the addresses are in each finding.

## Findings

Severity: **Blocks** the journey (it cannot be completed as intended, or completes wrongly), **Slows** it (extra
clicks, a detour, a wait, knowledge the person must bring), **Polish** (wording, consistency, layout). Fix size:
**S** a day or less, **M** up to a week, **L** more.

All addresses take `?fixture=1&role=<key>` on the demo build; on a live tenant drop `fixture` and sign in as the role.

| ID | Journey | Step | Screen | What happens | What should happen | Severity | Fix |
|---|---|---|---|---|---|---|---|
| F01 | First live week | 1.5 | `docs/live-deployment-checklist.md`; `/admin/users` | The checklist invites people in section 10, after SAP Basis has connected the system in section 5 and the SAP team has proved rules in section 8. Basis and the SAP team have no account when their step comes. | Invite SAP Basis and the SAP team in section 3, right after the first sign-in; the administrator's start screen on a new tenant offers "Invite SAP Basis". | Slows | S |
| F02 | First live week, Basis | 2.2 | `/` as `sap_basis` once any system exists | No visible **Connect a system** control: not on the Basis home, not in the map's Systems heading. The only ways are `⌘K` then "Connect a system", or typing `/s/new`. The "Three steps to your first scores" panel with the button shows only on an empty tenant. | **Connect a system** in the Basis home's **Connections** header and in the map under Systems, for anyone with manage systems. | Slows | S |
| F03 | First live week, SAP team | 4.2 | `/o/ecc-production/material-master?open=rule:MM142` | To find one completeness rule, one value-list rule and one join rule the person opens rules one at a time and reads **Prove in SAP**, which sits below Facts, Definition, Authority, Scope, Blocks, Lineage, Versions and Contract in the inspector. No filter by how SE16 can express a rule. | A **Prove three rules** entry on the run (`/run/{id}`) that proposes one rule of each kind with its SE16 selection, and **Prove in SAP** near the top of the rule inspector. | Slows | M |
| F04 | First live week, SAP team | 4.5 | same, **Download the reconciliation workbook** | The workbook holds "the ten rules with the most failing records in this run", not the rules the team chose; a value-list or join rule they proved may be missing. | The workbook leads with the rules the person opened under **Prove in SAP**, then the top ten. | Slows | S |
| F05 | First live week, admin | 5.2 | `/admin/settings` | One page with eight separate save buttons (**Save the appearance**, **Save weights**, **Save bands**, **Save tolerance**, **Save cost model**, **Save assumptions**, **Save policy**, **Save retention**). Nothing summarises which blocks hold unsaved edits. | Mark a block with unsaved edits in its heading and in the section index; warn before leaving with unsaved blocks. | Polish | S |
| F06 | Find, fix, approve, send | 2.2 to 3.1 | `/work` as `data_steward`, **Accept the 112 suggested values**, `Enter` | The values go into the steward's draft batch and nobody is told: the Work actions (`api/routes/work.py`) write no notification and no webhook. A batch drafted through `POST` on the fix-batch API notifies only people who watch its objects (`api/services/collab.py` `notify_batch_waiting_sync`), not the object's owner. The owner learns of it only at their next sign-in (start-screen line and **Approve batch B-241**) or in the weekly digest. (The fixture inbox shows "Batch B-241 waits for your approval"; the API never writes that notice.) | Every batch that starts waiting notifies the owner of each object in it (and their deputy when away), in the inbox and by email, with **Open the batch**; the SLA clock is visible to both. | Blocks | M |
| F07 | Find, fix, approve, send | 3.3 | `/?open=batch:B-241` as `data_owner`, **Send back** or **Approve** | **Send back** notifies nobody (`api/routes/remediation.py` `send_back_batch`); **Approve** fires a webhook only. The steward does not learn the batch came back with a reason, or that it was approved and can go to SAP. | Notify the steward on send back (with the reason and **Open the batch**) and on approval. | Slows | S |
| F08 | Find, fix, approve, send | 4.1 | `/?open=batch:B-241` as `data_owner`, **Approve batch B-241**, **Send to SAP** | Without live write-back, **Send to SAP** downloads a Migration Cockpit file (`remediation-cockpit_xlsx-B-241.xlsx`), with no confirmation although "It cannot be taken back", and the batch and its records then read **Sent to SAP** although nothing reached SAP. The load happens outside Meridian with no named person and no hand-off. | Without live write-back the button reads **Export load file** (as it already does beside live write-back), asks once, sets "Exported, waiting for the SAP load", names who loads it and notifies them; **Sent to SAP** only when SAP confirmed (BAPI) or someone marks the load done. | Blocks | M |
| F09 | Find, fix, approve, send | 5.2 | `/run/{a}/vs/{b}` as `data_steward`; `/?open=batch:B-241` | After the next run the batch says nothing about its records: the run compare counts rules (New, Fixed, Worse, Better per object), not the batch's 328 records. To verify, the steward opens record histories one by one. | The batch inspector shows "Verified on run 23 Oct 2026: 320 fixed, 8 still failing" with **Open the 8**, and the steward and owner are notified. | Slows | M |
| F10 | Find, fix, approve, send; Audit | 2.3, 2.2 | `/work` | The chips stop at **Waiting for approval** and **Exceptions** (`lib/v2/work.ts` `ChipId`). Approved, Sent to SAP and Fixed records have no chip, so an approved batch drops out of Work and an auditor cannot list the batches sent in a period. | Chips (or a status filter) for **Approved**, **Sent to SAP** and **Fixed**, grouped by batch like **Waiting for approval**. | Slows | S |
| F11 | Find, fix, approve, send | 1.1 | `/` as `data_steward`, **Accept the suggested values** | Opens `/work` on all objects and every owner, where a second, different button **Accept the 112 suggested values** waits. The persona guide says "Work opens on your rows". | The next step names the rule and count ("Accept the 112 suggested values for MM142"), opens Work scoped to the steward's rows with the confirmation bar ready. | Slows | S |
| F12 | Find, fix, approve, send | 3.2 | `/?open=batch:B-241` as `data_owner` | The batch lists changes such as "`MARA-MTART` blank to no value yet" and "`MARA-BRGEW` 0 to no value yet"; **Approve** and **Send to SAP** accept them, so records with no new value are approved and sent. | Items without a value are held out of approval ("12 records have no new value: approve the other 316 or send back"), and are never sent. | Slows | S |
| F13 | Find, fix, approve, send | 3.2 | `/?open=batch:B-241` | Record keys in the batch read `000000000000000700`; Work and the guide show SAP's form (`700`, full key on hover). | The same key format as Work. | Polish | S |
| F14 | Migration wave | 4, hand-off | `/` as `programme_lead`, **Clear the 3 no-go objects in Wave 1: finance foundations** | Opens `/work?verdict=no-go`. Work has no `verdict` filter (`lib/v2/work.ts`), so it shows "Work, All objects, 25,712 records to fix": every object, not the wave's three. | Open Work filtered to the wave's no-go objects (a `wave` filter, or the module list), with the sentence naming the wave. | Blocks | S |
| F15 | Migration wave | 2.2 | `/?view=waves`, **Edit** on Wave 1 | **Edit** on one wave opens the panel of all three waves (`?open=waves`) as one long form; the lead scrolls to find the gate of the wave they chose. | `?open=waves:w-1` opens that wave, its gate first; the others collapsed. | Slows | S |
| F16 | Migration wave | 3.2 | `/o/ecc-production/accounts-payable/readiness` | Two thresholds with two names: the Readiness tab says "Wave threshold 75.0"; the wave's gate says "Every object at 85.0 or more". It is not said which one decides go. | One threshold word everywhere ("Gate: min score 85.0"), with the score band behind the verdict said separately. | Slows | S |
| F17 | Migration wave | 5.2 | `frontend/docs/guide/waves.md`, `persona-lead.md` | The guides say the certificate is "not yet (the signed certificate arrives in step 9)"; the product has **Issue the certificate**, signatures per owner and **Download PDF**. The panel still reads "Readiness certificate: not yet." | Update both guides and the panel line to the issued and signed certificate. | Polish | S |
| F18 | Migration wave | 5.3 | `/?view=waves&open=certificate:w-1`, **Issue the certificate** | Refused with a toast that lists every blocking object and rule in one run-on line ("The wave is not ready to certify. Asset accounting critical rules over tolerance AA003 AA004 Controlling ..."), gone after a few seconds, without links. | The refusal stays in the certificate inspector as a list of objects and rules, each a link. | Slows | S |
| F19 | Migration wave | 3.2 | `/o/ecc-production/accounts-payable/readiness` | For a no-go object with 3 blocking gaps, the waves table reads **Readiness** "—" and **Records blocked** 0. | Readiness and records blocked filled, or the columns hidden with the reason. | Polish | S |
| F20 | Basis operations | 1.1 | `/` as `sap_basis` | The next-step button is **Extract SuccessFactors** while SuccessFactors reads "Refused the credentials" (HTTP 401): the main action leads into a failure. | When a system's credentials are refused, the next step is **Fix the SuccessFactors sign-in**, opening Connection settings. | Slows | S |
| F21 | Basis operations | 2.1 to 2.6 | `/?open=job:dl-failed-sf` as `sap_basis` | For a 401 the job offers **Retry** (which fails the same way) and **Open SuccessFactors**; the credentials are two more clicks away (**Open SuccessFactors**, **Connection settings**), and after saving, **Retry** is three clicks back (Map, Landscape, the job). 8 clicks from the job to fixed and retried against a target of 3. | For a credential error the job inspector offers **Connection settings** directly, and the connection editor offers **Save and retry the failed job**. | Slows | S |
| F22 | Basis operations | 3.1 | `/` as `sap_basis`, **Authorisation errors** | The same refusal is listed twice: "OData refused credentials (HTTP 401)" from the connection test and "OData refused credentials (HTTP 401)." from the job. | One row per system and cause, with both sources named. | Polish | S |
| F23 | Basis operations | 5.1 | `/` as `sap_basis`, **Schedules** | The schedule rows are text, not links; "S/4HANA sandbox, Material master, Not scheduled" has no add action. Editing goes through the system inspector and **Schedule** (3 clicks). | Each row opens the schedule; a not-scheduled row offers **Add a schedule**. | Slows | S |
| F24 | Basis operations | 1.1 | `/` as `sap_basis` at 390 | The Basis home tables (Connections, Last extraction) are cut at the right edge: "Connected" reads "Con", and **Extraction path**, **Last check** and **What it said** are off screen behind a horizontal scroll ([screenshot](img/phone-05-basis-home_390.png)). | At phone width each row becomes a card with the state and what SAP said first. | Polish | M |
| F25 | Audit | 1.3 | `/admin/audit` as `auditor` | No **Who** filter: it shows only with manage users (`design/v2/admin/data.tsx`, `can("manage_users")`). The auditor guide says to filter by person and dates. The auditor exports everything and filters in Excel, outside Meridian. | **Who** for anyone with view audit (names only). | Slows | S |
| F26 | Audit | 3.2 | `/work?filter=exceptions` as `auditor`, **Share and export**, **Export to Excel** | The sentence says "48 records are signed off"; the grid shows "Showing 12 of 48" with no control to load the rest, and the export reads "Exported 12 rows to work.xlsx": the grid tools export the rows on screen (`design/v2/GridTools.tsx`). Evidence silently incomplete. | Exports from the grid tools fetch every row of the filter (with the count in the file and the toast), or say "12 of 48 rows on screen: export all 48". | Blocks | M |
| F27 | Audit | 2.1 | `/admin/audit` | In Administration the map is replaced by the admin index; Work, Runs and People are one more click away (**Back to the landscape**), and at 390 that link is inside the index sheet. | Keep Landscape, Work, Runs and People at the top of the admin index. | Polish | S |
| F28 | Find, fix, approve, send | 1.2 | `/work` as `data_steward` at 390 | The controls (chips, grouping, sort, views, object, as of run, three export and import buttons, show more) fill the first screen; the first row starts below the fold ([screenshot](img/phone-02-work_390.png)). | At phone width keep the chips and one **Filters** button above the rows. | Polish | M |
| F29 | Monthly governance | 4.1 | `/admin/digests` as `programme_lead` | **Digests** is not in the lead's Administration index; typed directly it reads "Managing digests needs the manage settings permission. Ask an administrator to grant it." with no way to ask from there. The person who reports to the committee cannot set up the committee's digest. | Digests by role or wave need a narrower permission the lead holds, or the refusal offers **Request access**, which notifies the administrators. | Slows | S |
| F30 | Monthly governance | 2.1 to 2.3 | `/people` as `programme_lead` | **Overdue** counts are not links; **Open their work** opens all their open work, not the overdue rows; there is no **Remind** action. | Overdue counts link to `/work?assigned={id}&due=overdue`; **Remind** sends the person a notice with the link. | Slows | S |
| F31 | Monthly governance | 1.1 to 1.3 | `/runs` | No score trend on the Landscape: a month-on-month view takes Runs, the run, **Compare with**, **Compare** (4 clicks), and the list of runs has no "a month ago" marker. | A trend line per object on the Landscape and **Compare with last month** on the run. | Polish | M |
| F32 | Monthly governance | 2.1 | `/people` and `/work` | People says "26,330 of the 26,600 open records are assigned to nobody"; Work says "25,712 records to fix". The two totals are not reconciled on screen. | Say what each counts (records to fix in the latest run, or open work items including waiting and proposed), with the same total where they mean the same. | Polish | S |
| F33 | All, at 390 | every page | any page as any role at 390 | The status strip (platform state, run, records, rules, cost model, licence, and the failed extraction line) stays pinned over the bottom 110 or so pixels of an 844 pixel screen on every page ([screenshot](img/phone-01-steward-start_390.png)). | At phone width, one line ("Degraded, 1 failed job") that opens the status page. | Polish | S |
| F34 | All, at 390 | inspector to canvas | any `?open=` at 390 | The inspector fills the screen; every move from the inspector back to the canvas or the map costs a **Close** and often a **Map** (measured: 1 to 3 extra clicks per journey). | Expected for a phone; keep the inspector's links going forward (for example **Open the system**) so the person rarely needs to go back. | Polish | M |
| F35 | Migration wave | 2.2 | `/?view=waves` as `programme_lead` at 390 | The Waves view at phone width shows one sentence of counts and the object list: no wave headings, no **Edit**, no gate state ([screenshot](img/phone-04-waves-no-edit_390.png)). The Migration waves panel is reachable only by typing `?open=waves`. | The wave headings with gate state, **Edit** and **Certificate** at every width. | Blocks | S |

## Top 15

Ranked by how often the journey runs, how many people it stops, and the severity.

| Rank | ID | Severity | Finding | Fix |
|---|---|---|---|---|
| 1 | F06 | Blocks | A batch waiting for approval notifies nobody; the owner finds out at the next sign-in | Notify the object owners (and deputies) in the inbox and by email when a batch starts waiting (M) |
| 2 | F08 | Blocks | **Send to SAP** only downloads a file, without confirmation, and marks the records **Sent to SAP** | **Export load file**, a confirmation, "Exported, waiting for the SAP load", a named loader (M) |
| 3 | F14 | Blocks | The lead's next step opens Work on every object, not the wave's three no-go objects | Filter Work by wave (S) |
| 4 | F26 | Blocks | The exceptions export holds 12 of 48 rows, silently | Export the full filter, with the count (M) |
| 5 | F35 | Blocks | At phone width the Waves view has no wave headings, **Edit** or gate | Show the wave headings at every width (S) |
| 6 | F07 | Slows | **Send back** and **Approve** do not tell the steward | Notify the steward on both (S) |
| 7 | F09 | Slows | The next run does not report back on the batch it verifies | "Verified on run ...: n fixed, m still failing" on the batch, with a notice (M) |
| 8 | F12 | Slows | Changes with no new value can be approved and sent | Hold them out of approval (S) |
| 9 | F21 | Slows | 8 clicks from a 401 job to fixed and retried; **Retry** offered for a credential error | **Connection settings** on the job; **Save and retry** in the editor (S) |
| 10 | F20 | Slows | Basis's next step is to extract a system whose credentials are refused | Next step: fix the sign-in (S) |
| 11 | F10 | Slows | No chip for Approved, Sent to SAP or Fixed records | Add the chips, grouped by batch (S) |
| 12 | F25 | Slows | No person filter in the audit log for the auditor | **Who** for view audit (S) |
| 13 | F29 | Slows | The lead cannot set up the executive digest and cannot ask for access from the refusal | A digest permission for the lead, or **Request access** (S) |
| 14 | F02 | Slows | **Connect a system** has no visible control once one system exists | Add it to the Basis home and the map (S) |
| 15 | F16 | Slows | "Wave threshold 75.0" and "Every object at 85.0 or more" for the same wave | One threshold, one word (S) |

## Dead ends, back paths, URLs to know, silent hand-offs, waits and leaving Meridian

- **Dead ends** (a step with no forward action): F29 (digests refusal), F26 (12 of 48 rows with no way to load more),
  F23 (schedule rows), F35 (phone Waves view).
- **Missing back paths**: F27 (Administration hides Work, Runs and People), F21 (after saving credentials, no way back
  to the failed job), F34 (phone inspector).
- **A URL or command the person must know**: F02 (`⌘K` or `/s/new`), F35 (`?open=waves` at phone width), F29
  (`/admin/digests` is not in the lead's index; typed, it refuses).
- **Hand-offs with no notification**: F06 (batch waiting), F07 (sent back, approved), F08 (the load file to the SAP
  team), F09 (the next run's verdict on a batch), the certificate signers (no notice is written when a certificate is
  issued, `api/routes/wave_certificates.py`), Basis to the programme lead when a system is back, and every invitation
  except the email itself.
- **Unclear labels**: F08 (**Send to SAP** for a file download), F16 (two thresholds), F11 (two next-step wordings),
  F32 (two totals), F13 (two key formats).
- **Waits** the product names: an extraction and its analysis (the job line; "2 min, high confidence" for one object
  in the fixture), a report build ("built by a worker and appears in the list when it is ready"), a scheduled run
  ("due runs start within 5 minutes"). None were measurable without a backend.
- **Leaving Meridian**: install, HTTPS, backups and updates (host shell); the SAP role and SU53 (SAP); SE16 counts and
  the reconciliation workbook (SAP and Excel); the Migration Cockpit load (SAP); the cost figures (a meeting with
  finance); the audit evidence folder (downloads); asking for access, a digest or a person filter (email).

## Reproduce

1. `cd frontend && NEXT_PUBLIC_MERIDIAN_DEMO=1 npm run build && PORT=3300 npm run start:standalone`.
2. Open `http://localhost:3300/?fixture=1&role=<key>` with the role of the finding, set the cookie `mn_session=1` if
   the gate sends you to sign in (the e2e specs do the same), and follow the steps in the finding's row.
3. Keep `&role=<key>` on the address after each link, or the page falls back to the fixture's default permissions.

## Screenshots

1440 wide, one per measured step, named `<journey>-<nn>-<step>_1440.png`; 390 wide, the phone findings, named `phone-<nn>-<screen>_390.png`.

- [audit-01-audit-log_1440](img/audit-01-audit-log_1440.png)
- [audit-02-approvals_1440](img/audit-02-approvals_1440.png)
- [audit-03-exceptions_1440](img/audit-03-exceptions_1440.png)
- [audit-04-policy_1440](img/audit-04-policy_1440.png)
- [audit-05-activity_1440](img/audit-05-activity_1440.png)
- [basis-operations-01-home_1440](img/basis-operations-01-home_1440.png)
- [basis-operations-02-failed-job_1440](img/basis-operations-02-failed-job_1440.png)
- [basis-operations-03-connection_1440](img/basis-operations-03-connection_1440.png)
- [basis-operations-04-schedules_1440](img/basis-operations-04-schedules_1440.png)
- [find-fix-approve-send-01-start_1440](img/find-fix-approve-send-01-start_1440.png)
- [find-fix-approve-send-02-work_1440](img/find-fix-approve-send-02-work_1440.png)
- [find-fix-approve-send-03-accepted_1440](img/find-fix-approve-send-03-accepted_1440.png)
- [find-fix-approve-send-04-batch_1440](img/find-fix-approve-send-04-batch_1440.png)
- [find-fix-approve-send-05-sent_1440](img/find-fix-approve-send-05-sent_1440.png)
- [find-fix-approve-send-06-verify_1440](img/find-fix-approve-send-06-verify_1440.png)
- [first-live-week-01-start_1440](img/first-live-week-01-start_1440.png)
- [first-live-week-02-licence_1440](img/first-live-week-02-licence_1440.png)
- [first-live-week-03-connect_1440](img/first-live-week-03-connect_1440.png)
- [first-live-week-04-dry-run_1440](img/first-live-week-04-dry-run_1440.png)
- [first-live-week-05-run_1440](img/first-live-week-05-run_1440.png)
- [first-live-week-06-prove_1440](img/first-live-week-06-prove_1440.png)
- [first-live-week-07-cost_1440](img/first-live-week-07-cost_1440.png)
- [first-live-week-08-invite_1440](img/first-live-week-08-invite_1440.png)
- [migration-wave-01-waves_1440](img/migration-wave-01-waves_1440.png)
- [migration-wave-02-gate_1440](img/migration-wave-02-gate_1440.png)
- [migration-wave-03-readiness_1440](img/migration-wave-03-readiness_1440.png)
- [migration-wave-04-simulate_1440](img/migration-wave-04-simulate_1440.png)
- [migration-wave-05-certificate_1440](img/migration-wave-05-certificate_1440.png)
- [monthly-governance-01-compare_1440](img/monthly-governance-01-compare_1440.png)
- [monthly-governance-02-people_1440](img/monthly-governance-02-people_1440.png)
- [monthly-governance-03-overdue_1440](img/monthly-governance-03-overdue_1440.png)
- [monthly-governance-04-schedule-report_1440](img/monthly-governance-04-schedule-report_1440.png)
- [monthly-governance-05-digests_1440](img/monthly-governance-05-digests_1440.png)
- [phone-01-steward-start_390](img/phone-01-steward-start_390.png)
- [phone-02-work_390](img/phone-02-work_390.png)
- [phone-03-batch_390](img/phone-03-batch_390.png)
- [phone-04-waves-no-edit_390](img/phone-04-waves-no-edit_390.png)
- [phone-05-basis-home_390](img/phone-05-basis-home_390.png)
- [phone-06-extract_390](img/phone-06-extract_390.png)
- [phone-07-audit-log_390](img/phone-07-audit-log_390.png)
- [phone-08-people_390](img/phone-08-people_390.png)
