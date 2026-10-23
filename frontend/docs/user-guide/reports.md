# Reports

Reports turn a run into documents you can share: a board pack for the steering committee, a workbook for analysts, and focused PDFs for one object, one record or the rule set. Programme leads, analysts and auditors use them most. Every report is built inside your Meridian installation from the runs stored there.

## What you see

Open the report library from the **Reports** tab of the Insights Summary view (`/insights/reports`), or with **Report library** in the action bar of any Insights page.

- The header names the scope: the run, the comparison run and the object, for example "Scope: PRD ECC weekly, no comparison run, every object in the run". The run follows the page's run picker; without one, the newest finished run is used.
- Two choices sit in the action bar: **Compare with** (**No comparison** or an earlier run of the same system or upload) and **Object** (**All objects** or one object in the run).
- The four-sentence header says how many runs are available, what you are comparing with and how many reports the library holds.
- **Available reports** lists every report with its format and a one-line description. Use the arrow keys to move through it.
- **Preview** shows the selected report: what it covers, about how many pages, the scope, its sections, the run's key figures, and what it still needs before it can be built. Below are **Download** and **Copy link**.
- **Recent exports** lists the last five exports, with when and by whom. It shows only if you can read the audit log.

## The reports

Each report is a PDF unless stated otherwise. Unless a report says it needs something else, choosing a run is enough.

### Board pack

About 12 pages for a board audience. Sections: Headline, What to do next, Quality by dimension, Trend, Blockers, Root causes, Impact by L1, Cleansing funnel, Modules with commentary, Rule appendix and Methodology. Pick **Compare with** to show changes against that run. Also on the **Export** menu of the Insights overview and the executive summary.

### Analyst workbook

An Excel workbook with every module, rule and finding, with filters and conditional formats. Pick **Object** to limit it to one object, and **Compare with** to set the run it compares against. Also on the **Export** menu of the overview and executive summary, and as **Comparison workbook (Excel)** on Progress.

### Executive summary

About 4 pages: Summary, What to do next, Scores, Readiness, Management overview and Methodology. Also on the Home page as **Executive report (PDF)**.

### Analysis report

About 6 pages: Scores, What to do next, What to fix first, Readiness, Failing checks and Methodology. Also on a run's page and on Objects as **Analysis report (PDF)**.

### Extraction report

About 3 pages on the tables read from the source system: Tables read, Row counts, Timings and Issues.

### Cleaning and fixes

About 3 pages of cleaning work: Queue, Fixes by status and Owners. A fix batch page offers it as **PDF cleaning report (all batches)**.

### Run comparison

About 4 pages: Score change, Module changes and Rule changes. It compares the run with the **Compare with** run, or else with the baseline or previous run. Progress offers it as **Proof of progress (PDF)**.

### Full report

The report stored when the run's analysis finished. The preview shows when it was last built. A run's page offers it as **Narrative report (PDF)** once the run's AI enrichment has finished.

### Run data

The stored report as JSON, for other tools. Also **Run data (JSON)** on the executive summary.

### Object report

About 3 pages on one object: Score, Rules, Top findings and Record samples. Needs an **Object**. An object's page offers it as **PDF analysis**.

### Trend report

About 6 pages on the last 12 runs of this system: Score over time, Scores by dimension, Objects that moved most, Rules that started failing, Rules that were fixed and Methodology.

### Owner workload

About 4 pages: each owner's score, open items and objects, then the objects with no owner, and Methodology.

### Rule catalogue

One object's rules, with severity, dimension and SAP field: Contents and Rules by object. Needs an **Object**.

### Data dictionary

The SAP tables and fields Meridian reads, by table and by object: Contents and Fields by table. Pick an **Object** to limit it to the tables that object reads.

### Record fix sheet

One page for one material: its failing rules by view, with the actual values and the fixes. Enter the material number under **Record key**. A record's page offers it as **Fix sheet (PDF)**.

## Commentary and "What to do next"

The board pack, executive summary, analysis report, object report, trend report, owner workload, run comparison, cleaning and extraction reports print short paragraphs of plain speech under their tables. Each one says what a number is, what it means for the data and what to do about it. For example, a weak completeness score reads as required fields left empty, with the advice to fill them at source, starting with the fields the blocking rules name.

The board pack, executive summary, analysis report and object report also carry a **What to do next** box: up to five actions in the order to take them. They can include fixing the highest-impact rule first, clearing critical failures to lift the cap on the score, working the blocking rules, deciding pending fix proposals, supplying the tables behind checks that could not run, assigning owners, and re-running to close the gap to the target.

The commentary is written from the figures alone. No language model is involved, so it is as repeatable as the tables it explains. When a run carries an AI summary, the board pack shows it in a separate box labelled "AI-generated summary. Figures in this report are computed, this text is not".

## The analyst workbook's sheets

- **Summary**: the headline metrics with the previous value and the change.
- **Commentary**: the board pack's commentary, one row per section (score, dimensions, root causes, blockers, migration waves, cleansing funnel, modules), then one row per module and one per next step.
- **Modules**: each module's score, previous score, change, tier, failing rules by severity, checks and cap reason.
- **Objects**: each module's score per dimension, with coverage and tier, laid out for pivot tables.
- **Rules**: every failing rule, highest impact first, with field, pass rate, impact, auto-fix share, S/4 status and change in affected records.
- **Findings**: every rule result, passing and failing, with the remediation text.
- **Records sample**: up to 9 failing records per rule, with the invalid and suggested value.
- **Readiness**: migration wave verdicts, with the S/4 area each module fails most in.
- **Trend**: the last 24 runs, re-weighted under your current scoring settings, with each dimension, critical and high counts, blockers, failing records, rules fixed and rules newly failing against the run before.

## The methodology section

The board pack, executive summary, analysis report, trend report and owner workload end with **Methodology**. It states that every figure comes from deterministic checks, explains how dimension, module and overall scores are built, lists your dimension weights and score bands, describes the critical cap, gives the severity weights behind impact, and names the sources. Times are in South African Standard Time.

## How to download a report

1. Open the report library.
2. Pick the run with the run picker if you want one other than the newest.
3. Set **Compare with** and **Object** if the report uses them.
4. Select the report under **Available reports** and check the preview.
5. Select **Download**. A PDF is built on the server first; the button reads "Rendering" until the download starts.

## How to get a record fix sheet

1. In the library, select **Record fix sheet**.
2. Type the material number under **Record key**.
3. Select **Download**.

## How to send the board pack by email on a schedule

1. Open **More** and, under Admin, select **Notifications** (`/admin/notifications`).
2. Select **Add channel**, set **Type** to email, enter the **Address**, and choose **Board pack: weekly** or **Board pack: monthly**. For an existing email channel, change the **Board pack** column instead.
3. Select **Add channel**.

Weekly packs go out on Monday at 07:00 and monthly packs on the 1st at 07:00, South African time. Each email carries the board pack and, when it can be built, the analyst workbook for the latest finished run, and names the run, its score and up to three of the biggest blockers. A "Board pack sent" notification is recorded in the inbox. A channel receives one pack per period; a failed send is tried again at the next scheduled time. Only email channels can receive the board pack.

The daily digest, weekly summary and monthly report under **Reports by email and Teams** in Rules, Scoring and alerts are separate messages.

## Who can do what

- The report library needs the export permission (administrator, manager, data steward, analyst, approver and auditor). Without it the page reads "Export needs the auditor or analyst role."
- **Recent exports** needs audit access.
- Setting a board pack schedule needs the manage-settings permission (administrator).

## Good to know

- Reports are built in your installation from your stored runs. They leave it only when you download them or a scheduled email sends them.
- "No completed run yet" means no run has finished; reports are built from a finished run.
- **Download** stays disabled while a report needs something you have not given, such as an object or a record key.
- The full report fails when no report was stored for the run. Re-run the analysis, or use another report.
- The rule catalogue needs an object because the full catalogue would run to hundreds of pages.
- Downloads of the board pack, workbook, trend report, owner workload, rule catalogue and data dictionary are written to the audit log.

## Related

- [Insights](/docs?page=insights)
- [Runs](/docs?page=runs)
- [Objects](/docs?page=objects)
- [Rules](/docs?page=rules)
- [Administration](/docs?page=admin)
