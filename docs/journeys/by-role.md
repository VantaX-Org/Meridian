# Journeys by role

This file describes what each role does in Meridian, as built at v0.0.630 (`main`, merge b772a6107). Routes are those
of `frontend/app/(v2)`. Controls are named as they read on screen, in bold. Rights come from `api/services/rbac.py`.
The start screen and its next-step button come from `frontend/design/v2/screens/Landscape.tsx`.

Notes that apply to every role:

- Every role starts at `/` (Landscape). The next-step button under the title depends on the role.
- Every role can read: it holds `view`, `mdm.read` and `view_ai_confidence`.
- **Administration** shows in the menu only with one of `manage_users`, `manage_settings`, `manage_system`,
  `view_audit`, `manage_field_mappings` or `manage_systems`.
- A grant can be limited to one system or one object, and it can expire. Grants are set in `/admin/roles`.
- The inbox is the **Inbox** button in the top bar (`?open=inbox`). Hand-offs reach the next person there under
  "Next steps", and on their own start screen.
- `/o/_/{object}` opens an object on whichever system holds it. The object slug is the module key with `-` for `_`,
  for example `/o/_/material-master`.
- Nothing reaches SAP until a batch is approved by a second person and loaded. The text on `/work` says so: "Accepting
  or editing a value only proposes it. Nothing reaches SAP until it is approved and applied."

Legacy roles `admin`, `manager`, `steward`, `approver` and `ai_reviewer` still work for existing users. They show with
"(legacy)" and cannot be granted again. Custom roles are built in `/admin/roles` from resource and action pairs.

## Rights by role

Y means the role holds the right. Codes: PA platform_admin, PL programme_lead, DS data_steward, DO data_owner, SB
sap_basis, PrA process_analyst, An analyst, Au auditor, Vi viewer.

| Right (code) | What it allows | PA | PL | DS | DO | SB | PrA | An | Au | Vi |
|---|---|---|---|---|---|---|---|---|---|---|
| `analyse` (analyse) | Start an analysis, comment, open field maps | Y | Y | Y | | Y | | Y | | |
| `trigger_sync` (trigger sync) | Test, load configuration, extract | Y | Y | Y | | Y | | Y | | |
| `upload` (upload) | Upload extract files | Y | Y | Y | | Y | | Y | | |
| `apply` (apply) | Accept or edit suggested values, write to SAP from cleansing | Y | Y | Y | | | | | | |
| `approve` (approve) | Approve batches, requests, value maps, waves | Y | Y | Y | Y | | | | | |
| `assign` (assign) | Assign work, remind, balance work | Y | Y | Y | | | | | | |
| `export` (export) | Excel, CSV, load files, workbook export | Y | Y | Y | Y | Y | | Y | Y | |
| `manage_rules` (manage rules) | Edit rules, verified fixes, promotion, dry runs | Y | | Y | | | | | | |
| `review_ai_rules` (review AI rules) | Approve learned rules | Y | | Y | | | | | | |
| `mdm.write` (master data write) | New request, entry gate, mining, monitors | Y | Y | Y | | | | | | |
| `manage_triage` (manage triage) | Teams and routing rules | Y | Y | Y | | | | | | |
| `run_process_discovery` (run process discovery) | Run process discovery | Y | Y | Y | | Y | Y | | | |
| `export_process` (export process) | Export process models | Y | Y | | | | Y | | | |
| `handoff_rule` (hand off rule) | Hand a process rule to stewards | Y | Y | Y | | | Y | | | |
| `manage_systems` (manage systems) | Connect systems, mark loaded | Y | Y | | | Y | | | | |
| `manage_field_mappings` (manage field mappings) | Field mappings section | Y | | | | Y | | | | |
| `manage_digests` (manage digests) | Digest API | Y | Y | | | | | | | |
| `view_audit` (view audit) | Audit log | Y | Y | | | | | | Y | |
| `trigger_ai` (trigger AI) | Ask Aletheia | Y | Y | Y | | Y | | Y | | |
| `ai_feedback` (AI feedback) | Reject AI proposals with a reason | Y | Y | Y | | | | | | |

Only `platform_admin` holds `manage_users`, `manage_settings`, `manage_system`, `manage_llm` and `manage_workflows`.

---

## Platform admin (`platform_admin`, "Platform admin")

**Who.** The person who runs the tenant. Their work starts when the licence is bought, when someone joins or leaves,
or when a setting must change.

**Start screen.** `/` with **Open Administration** (goes to `/admin`).

**One-off: set up the tenant**

1. `/` and click **Open Administration**. `/admin` shows "Administration".
2. Open **Licence** (`/admin/licence`) to see what the licence covers.
3. Open **Single sign-on** (`/admin/sso`) and **Sign-in page** (`/admin/signin`).
4. Open **Users** (`/admin/users`) and invite people. They accept at `/accept-invite`.
5. Open **Roles and permissions** (`/admin/roles`) to grant roles, scope them by system or object, and set expiry.
6. Go to `/s` and click **Connect a system**. `/s/new` shows "Set up Meridian".
7. Open **Approval workflows** (`/admin/workflows`), **Stewardship** (`/admin/stewardship`), **Settings**
   (`/admin/settings`) and **Alerts** (`/admin/alerts`).

**Weekly**

1. `/admin/system` ("Platform and updates") to check the platform.
2. `/admin/audit` ("Audit log") to review changes.
3. `/admin/viewas` ("View as a role") to check what a role sees. The banner reads "Viewing as {role}." Leave with
   **Stop viewing as**. View as is read-only.

**Can.** Everything.

**Cannot.** Approve a batch they built (four-eyes, see Data owner).

**Hand-off.** An invite reaches the new user by email. Grants take effect on the user's next page load.

**Done.** Users can sign in, each has the role they need, and at least one system is connected.

---

## Programme lead (`programme_lead`, "Programme lead / CIO")

**Who.** Runs the data programme and the migration waves. Work starts with a wave date, a steering meeting or month
end.

**Start screen.** `/` with the nearest wave's next step:

- **Clear the {n} no-go objects in {wave}** (goes to `/work?verdict=no-go`), or
- **Review the {n} at-risk objects in {wave}** (goes to `/work?verdict=at-risk`), or
- **Open {wave}** (opens `?open=waves`).

With no wave, the button is **Open the no-go objects** (`/work?verdict=no-go`).

**Weekly: wave status**

1. `/?view=waves`. The matrix groups by wave. The toggle group is "Group the matrix".
2. Click a wave's **Readiness certificate of {wave}**, or **Edit {wave}** to change it.
3. `/migration` ("Migration") for per-object verdicts: "Ready to load", "Ready with conditions", "Not ready to load".
4. `/go-live` ("Go-live flight deck"), `/forecast` ("Sprint plan") and `/value` ("Cost avoided month by month").

**Weekly: who holds the work**

1. `/people` ("Owners and stewards"). Click **Open {name}'s overdue work** or **Open the work list**.
2. Click **Remind** on a person, or **Balance work**.

**Month end**

1. `/reports` ("Report delivery") to schedule a report.
2. `/value` and `/insights` for the steering pack.

**Can.** Analyse, extract, accept and approve, assign, export, manage systems, manage triage, run process
discovery, view the audit log.

**Cannot.**

- Edit rules or make a mined dependency a rule (`manage_rules` missing). `/fix-drafts` shows "Managing rules needs
  the manage rules permission."
- Invite users or change settings (`manage_users`, `manage_settings` missing).
- Sign off a wave they cannot approve for (four-eyes still applies to batches they built).

**Hand-off.** **Remind** puts a message in the person's inbox. Wave sign-off by **Sign off {wave}** on the waves
panel is visible on the certificate.

**Done.** Each wave object is "Ready to load" or has a named owner and a date.

---

## Data steward (`data_steward`, "Data steward")

**Who.** Fixes master data. Work starts when a run finishes, when the inbox shows new work, or when a monitor
reports records that failed again.

**Start screen.** `/` with **Accept {count} suggested values for {check}** (goes to `/work?rule={check}`), or
**Accept the suggested values** (goes to `/work`).

**Daily: find and fix**

1. `/` and click the next-step button. `/work` shows the accept bar.
2. Click **Accept {count} suggested values on {check}**. The values go into a draft batch.
3. For a single record, edit the value in the row, or click **Mark as not an issue** only if you also hold approve
   (stewards do).
4. Or work object by object: `/o/_/material-master/rules`, find the rule, click **Accept all**. The toast reads
   "{n} suggested values for {rule} are in your draft batch {batch}. Nothing reaches SAP until an owner approves."
5. Open the batch from its row on `/work` (`?open=batch:{id}`). The batch waits for a second person.

**Daily: after a clean**

1. `/work/monitor`: "{n} records failed a rule again since the last run."
2. Click **Open cleansing** or **Open the work list**.

**Weekly: rules**

1. `/o/_/{object}/profile`, section "Mined dependencies". Click **Make it a rule**. The toast reads "Rule {id} added.
   It runs from the next analysis."
2. `/o/_/{object}/rules`, segment **Learned**. Click **Approve** on a learned rule.
3. `/fix-drafts` ("Aletheia verified fixes"). Click **Draft and verify**, then **Approve** or **Reject**.
4. `/rule-dry-run`, `/rule-promotion`, `/anomaly-rules` for rule changes before they go live.

**Can.** Analyse, extract, accept and edit, approve (but not their own batch), assign, export, manage rules, review
AI rules, master data requests, triage.

**Cannot.**

- Connect a system (`manage_systems` missing). **Connect a system** is hidden on `/s`.
- Mark a batch "Loaded in SAP" (needs `approve` or `manage_systems`; stewards hold approve, so they can, but not on
  their own batch).
- Approve a batch they built: "You built this batch; a second person approves it."

**Hand-off.** The draft batch shows on the data owner's start screen as **Approve batch {label}** and in their inbox
under "Next steps" with **Decide**.

**Done.** The rule's failing count drops on the next run, and `/work/monitor` shows no records failing again.

---

## Data owner (`data_owner`, "Data owner / approver")

**Who.** Owns a data object and approves changes to it. Work starts when a batch or request waits for them.

**Start screen.** `/` with **Approve batch {label}** (opens `?open=batch:{id}`). Under the title: "{n} batches wait for
your approval". With nothing waiting, the button is **See who holds the work** (goes to `/people`).

**Daily: approve**

1. `/` and click **Approve batch {label}**. The batch inspector opens.
2. Click **Show records** to check the values (goes to `/work?batch={id}`).
3. Click **Approve** or **Send back**. If some records have no new value, the dialog "Some records have no new
   value" offers **Approve the others**.
4. On the approved batch, click **Export load file**. In "Export the load file", choose the format and "Who loads it
   in SAP". The default is "The SAP Basis people".
5. When SAP confirms, click **Loaded in SAP**. The batch shows "Sent to SAP".

Load file formats: `cockpit_xlsx` (Migration Cockpit Excel), `cockpit_csv` (Migration Cockpit CSV), `ltmc_xlsx`
(LTMC Excel), `mass_change_csv` (mass change CSV), `mass_maintenance_zip` (mass maintenance ZIP), `mdg_cr_json`
(MDG change request JSON).

**Daily: requests**

1. `/requests` ("Create and change master data with approval"). Choose the view **To approve**.
2. Click a row (`?open=request:{id}`). Click **Approve** or **Reject**.

**Can.** Approve, export.

**Cannot.**

- Accept suggested values (`apply` missing).
- Comment on an exception. **Add comment** shows on `/work/exceptions` but the API refuses without `analyse`.
- Remind a person. **Remind** shows on `/people` but the API refuses without `assign`.
- Choose a loader other than the default in the load file dialog (the list needs `assign`).
- Reject a cleansing proposal with a reason. The reason post needs `ai_feedback`; the failure is not shown.
- Open a migration field map or value map (`analyse` missing), so they cannot approve a value map.
- Sign a readiness certificate (needs `approve` and `view_audit`).

**Hand-off.** After approval, the export goes to the loader. The SAP team hears outside Meridian. The steward sees the
batch status change on `/work`.

**Done.** The batch shows "Sent to SAP" and the next run scores the records as fixed.

---

## SAP Basis (`sap_basis`, "SAP Basis / integration admin")

**Who.** Runs the connections to SAP. Work starts each morning, with a failed job, or with a refused sign-in.

**Start screen.** `/` with:

- **Fix the {system} sign-in** (opens `?open=connection:{id}`) when SAP refused the credentials, else
- **Extract {system}** or **Run analysis on {system}** (opens `?open=system:{id}`).

Below it the Basis home shows connections, extractions, failed jobs and schedules.

**One-off: connect a system**

1. `/s` ("Systems") and click **Connect a system**. `/s/new` shows "Set up Meridian" and "Setup only reads from SAP.
   Nothing is written to SAP until an approved batch is sent."
2. Open the system (`/s/{id}`). Tabs: Overview, Extractions, Configuration, Configuration changes, Schedules, Custom
   objects, Source design.

**Daily: extract and analyse**

1. `/` and click **Extract {system}**, or **Extract** in the task list when another system's sign-in needs fixing first. The system inspector opens.
2. Click **Test connection**, then **Load configuration**, then **Extract**.
3. In the picker, tick "Analyse straight after extracting". Optionally tick "Changes only since last full download"
   and fill "Run label (optional)". Click **Extract {n} objects**.
4. Or later click **Run analysis on {system}**. The toast reads "Analysis started".
5. Click **Schedule** to set a schedule (goes to `/s/{id}?tab=schedules`).
6. `/runs?view=jobs` to check jobs.

**Can.** Analyse, extract, upload, export, manage systems, field mappings (`/admin/mappings`), database sources
(`/admin/externaldb`), run process discovery, ask Aletheia.

**Cannot.**

- Accept values or approve (`apply`, `approve` missing).
- Use the entry gate, mining or monitors (`mdm.write` missing).
- Edit the migration field map. Their `manage_field_mappings` right is not used there; it needs `analyse` to read
  and the map is confirmed by anyone with `analyse`.

**Hand-off.** A finished analysis updates every user's start screen and the object scores. The SAP load of an
approved batch comes to Basis outside Meridian; they or the owner click **Loaded in SAP**.

**Done.** Each system has a fresh run and no failed jobs.

---

## Process analyst (`process_analyst`, "Process analyst")

**Who.** Maps the as-is business processes. Work starts when a run finishes or a process step is blocked.

**Start screen.** `/` with **Open {process} step {n}** (goes to `/o/{system}/{object}/processes?open=step:{ref}`), or
**Open the process readiness** (goes to the first object's Processes tab).

**Weekly**

1. `/processes` ("Process discovery"). Run discovery.
2. `/o/_/{object}/processes` and `/o/_/{object}/processes/design` ("Process designer").
3. Export the process model.
4. Hand a rule to stewards from a blocked step.

**Can.** Run process discovery, export processes, hand off rules.

**Cannot.**

- Export findings or grids (`export` missing). **Export findings** on `/run/{id}` shows but the API refuses.
- Analyse, accept or approve.

**Hand-off.** A handed-off rule reaches stewards as work on `/work`.

**Done.** Each process step has a reading and blocked steps have an owner.

---

## Analyst (`analyst`, "Analyst")

**Who.** Reads scores and digs into causes. Work starts with a question about a number.

**Start screen.** `/` with the wave next step or **Open the no-go objects**, like the programme lead.

**Daily**

1. `/objects` ("Objects"). Click an object (`/o/{system}/{object}`).
2. Tab **Trend** ("Why the score moved"). Use "Compare two runs".
3. `/runs` and click **Compare with previous** (goes to `/run/{a}/vs/{b}`).
4. `/score` ("Score lens"), `/insights`, `/mining`.
5. Export with **Share and export**, then **Export to Excel** or **Export to CSV**.

**Can.** Analyse, extract, upload, export, ask Aletheia, comment.

**Cannot.** Accept, approve, assign, master data write (so no entry gate, mining runs or monitor acknowledgements).

**Hand-off.** **Share this page as a link...** creates a share link. The reader sees "Shared view." and "Read-only, as a
viewer."

**Done.** The question has an answer backed by an exported sheet or a shared link.

---

## Auditor (`auditor`, "Auditor")

**Who.** Tests controls. Work starts with an audit request or a quarterly test.

**Start screen.** `/` with **Open the rules library** (goes to `/rules`).

**Quarterly**

1. `/rules` ("Rules"). Click a rule (`/r/{id}`): "One rule and what it finds in the newest run."
2. `/admin/audit` ("Audit log").
3. `/admin/policypacks` ("Policy packs").
4. `/work` and open a batch (`?open=batch:{id}`) to check who built and who approved it.
5. Export grids with **Export to Excel**.

**Can.** Read everything, export, view the audit log.

**Cannot.** Change anything. **Add comment** on `/work/exceptions` shows but the API refuses.

**Hand-off.** Evidence leaves as an export. Nothing in Meridian notifies anyone.

**Done.** The evidence set is exported.

---

## Viewer (`viewer`, "Viewer")

**Who.** Reads scores. Also the role behind every share link.

**Start screen.** `/` with **Open the no-go objects** or the wave next step.

**Daily**

1. `/objects`, then an object.
2. `/runs`, then a run.

**Can.** Read.

**Cannot.** Export. **Export findings** on `/run/{id}` shows but the API refuses. **Add comment** on exceptions shows
but the API refuses.

**Done.** Not applicable. The viewer reads.
