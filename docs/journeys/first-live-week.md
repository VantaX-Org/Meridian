# Journey: first live week

From an empty Linux host to a first run whose numbers the customer's SAP team has proved by hand, a cost model the
finance owner agreed, and every named person signed in once. It follows `docs/live-deployment-checklist.md` and adds
the screens, the controls and the hand-offs.

- **Roles**: the administrator (A), SAP Basis (B), the SAP team that proves the numbers (S, signed in as auditor or
  analyst), the vendor's deployment engineer on a call (V, never with access to SAP data).
- **Trigger**: the licence is bought, a host meets `docs/prerequisites.md`, the read-only SAP role exists.
- **Done**: the run is on `/runs`; three rules are reconciled in SE16 and the reconciliation workbook is filed with
  the go-live records; Administration, Settings no longer reads **default estimate**; each invited person has signed
  in and landed on their own start screen; a schedule exists for the next extractions.
- **Target**: 5 working days elapsed, under 2 hours of it in Meridian, 30 clicks in Meridian (measured: see the
  [friction audit](friction-audit.md#measured-clicks-against-targets)).

## Day 0: before the week (leaves Meridian)

| # | Who | Where | What |
|---|---|---|---|
| 0.1 | A | Host shell | `sudo bash scripts/preflight.sh` passes. |
| 0.2 | B | SAP (PFCG, SU01) | The read-only role from `docs/sap/authorisation-role-template.md` assigned to a system or communication user. |
| 0.3 | A | Meridian HQ email | The licence key, or the offline token for an air-gapped host. |

## Day 1: install and sign in

| # | Who | Address | Control | Result |
|---|---|---|---|---|
| 1.1 | A | Host shell (leaves Meridian) | `sudo bash scripts/meridian-deploy.sh`; answer server name, LLM tier, SSL mode, first administrator | Stack running; `curl -s https://<server>/health` prints `"status": "ok"` |
| 1.2 | A | `/sign-in` | Email, password, **Sign in**; then the forced new password (12 characters or more) | Lands on `/`, the administrator's Landscape |
| 1.3 | A | `/` | **Open Administration** (the next-step button) | `/admin` |
| 1.4 | A | `/admin/licence` | **Licence** in the index, then **Check with Meridian HQ now** | Reads **Valid** with tier, seats, expiry and modules |
| 1.5 | A | `/admin/users` | **Invite a user** (`?open=user:new`): email, name, first role **SAP Basis**; **Send the invitation**. Repeat for the SAP team (auditor or analyst) | "Invitation sent to ... They get a link that works for seven days." |
| 1.6 | A | `/admin/sso` (optional) | Connect the identity provider, **Test sign-in** | Password sign-in stays as the way in |

**Hand-off A to B and S**: the invitation email (seven-day link to `/accept-invite`). Invite them on day 1 even
though the checklist lists users in section 10: Basis connects the system on day 1 and needs an account to do it
([F01](friction-audit.md#findings)).

**Decision**: single sign-on now or later. With SSO, keep the administrator's password sign-in as the way in if the
provider is down.

## Day 1: connect SAP

| # | Who | Address | Control | Result |
|---|---|---|---|---|
| 2.1 | B | `/accept-invite` | Set a password | Lands on `/`, the Basis home |
| 2.2 | B | `/s/new` | On an empty tenant: **Connect a system** under "Three steps to your first scores". Once any system exists: `⌘K` (or `/`), type "Connect a system", `Enter` ([F02](friction-audit.md#findings)) | The connect form |
| 2.3 | B | `/s/new` | **Name**, **System type**, **Environment**, **Host**, **Client**, **Instance number**, optional **User**, **Extraction path**, **Table reader**, **Password** | Fields complete |
| 2.4 | B | `/s/new` | **Test connection** | "RFC connection succeeded (client 100, 41 ms)", or the missing authorisation by name (SU53 in SAP shows the check) |
| 2.5 | B | `/s/new` | **Connect system** | `/s/{id}?open=system:{id}` |

**Decision**: the table reader. If the Basis team refuses `RFC_READ_TABLE`, choose `/BODS/RFC_READ_TABLE2`,
`BBP_RFC_READ_TABLE`, **ODP, table reader for the rest**, or on S/4HANA on premise **OData through the SAP Gateway**.

## Day 1: first extraction and run

| # | Who | Address | Control | Result |
|---|---|---|---|---|
| 3.1 | B | `/?open=system:{id}` | **Extract** in the system inspector | "Objects to extract" |
| 3.2 | B | same | Tick the objects of the first run (for example **Material master**, **Accounts payable**); tick **Analyse straight after extracting**; leave **Changes only since last full download** off | The prediction: duration, records, cost, queue |
| 3.3 | B | same | **Dry run** | "What an extraction of 2 objects would read, without reading it": rows per table and a duration |
| 3.4 | B | same | **Extract 2 objects** | "Extraction started ... analysed straight after. Open the job"; the job line under the top bar |
| 3.5 | B, A | `/runs` | **Runs** in the map, then the run's date | `/run/{id}`: records, rules, score range |

**Wait**: the extraction and the analysis run on the workers; the job line shows progress. Nothing to click.

**Hand-off B to A and S**: the inbox notice "Analysis finished on ECC production ..." (`?open=inbox`). People who do
not watch the object hear nothing; tell the SAP team by email that the run is ready (leaves Meridian).

## Day 2: prove three rules in SE16

Within a day of the extraction, so SAP has not moved far from what Meridian read.

| # | Who | Address | Control | Result |
|---|---|---|---|---|
| 4.1 | S | `/o/{system}/{object}` | The object in the map | The object canvas and its receipt |
| 4.2 | S | `/o/{system}/{object}?open=rule:{id}` | A rule id (for example `MM142`) under **Critical rules over tolerance** or in the rules list | The rule inspector |
| 4.3 | S | same, section **Prove in SAP** (or `/r/{id}?tab=prove`) | Read the SE16 selection: table, **Population** and **Failing** rows, "What SE16 cannot express", five failing keys | The selection to type into SE16N or SE16H |
| 4.4 | S | SAP, SE16N or SE16H (leaves Meridian) | Enter the table and the selection; count; compare with **Population** and **Failing**; look up the five keys | Match or mismatch |
| 4.5 | S | same inspector | **Download the reconciliation workbook** | `meridian-reconciliation.xlsx`, the ten rules with most failing records, with empty **SE16 count** and **Match** columns |
| 4.6 | S | Excel (leaves Meridian) | Fill **SE16 count** and **Match** for the three rules | The workbook, filed with the go-live records |

Repeat 4.2 to 4.4 for three rules: one completeness rule ("One SE16N selection ... gives the failing count"), one
value-list rule (a check-table lookup, such as `MM142` against T006) and one rule with a join or a condition SE16
cannot express. Choosing the three is by reading each rule's **Prove in SAP**; there is no filter for it yet
([F03](friction-audit.md#findings), [F04](friction-audit.md#findings)).

**Decision**: a mismatch. Rerun the extraction and the rule and count again within the hour; if it still differs,
send the vendor the rule id, the run id, both Meridian counts, the SE16 count and the selection used, never record
keys or values.

## Day 2 to 3: cost model and scoring settings

| # | Who | Address | Control | Result |
|---|---|---|---|---|
| 5.1 | A | `/admin/settings` | **Settings** in the Administration index | One page of blocks |
| 5.2 | A | block **Cost model and currency** | **Currency**, **Cost per failing record** by severity, **Save cost model** | "Cost model saved. It applies from the next analysis or re-analysis." |
| 5.3 | A | blocks **Dimension weights**, **Score bands**, **Cap rule and tolerance** | **Save weights**, **Save bands**, **Save tolerance** (or keep the DAMA defaults) | Weights add up to 100 |

**Hand-off A to finance owner and back**: the cost figures are agreed outside Meridian (a meeting or an email).

## Day 3 to 5: everyone else, schedules, operations

| # | Who | Address | Control | Result |
|---|---|---|---|---|
| 6.1 | A | `/admin/users` | **Invite a user** for each steward, owner and the auditor, scoped to systems or objects where needed; or SCIM under **Provisioning (SCIM)** | The seat meter stays within the licence |
| 6.2 | Each person | `/accept-invite`, then `/` | Set a password | Their own start screen |
| 6.3 | A | `/admin/stewardship` | Owner per object, stewards per slice; **Check what applying does**, **Apply** | Every object has an owner, so approvals have someone to go to |
| 6.4 | B | `/s/{id}?tab=schedules` | **Schedule** in the system inspector; add a schedule per object: weekdays **Changes only**, weekly **Full extraction** | The Basis home lists them under **Schedules** |
| 6.5 | A | Host shell (leaves Meridian) | `scripts/backup.sh`, a restore drill, `scripts/update.sh --version <release>` | Backups scheduled; a pinned release |
| 6.6 | A | `/admin/system` | **Download diagnostics bundle** | Sent to the vendor with the ticked checklist; no SAP data |

## Hand-offs at a glance

| From | To | What | How they hear |
|---|---|---|---|
| A | B, S | An account | Invitation email |
| B | A, S | The first run is ready | Inbox notice for watchers of the object; otherwise an email outside Meridian |
| S | A | Three rules reconciled | The workbook, outside Meridian |
| A | everyone | An account and a role | Invitation email |
| A | owners, stewards | Their objects | The stewardship template; their start screen on next sign-in |
