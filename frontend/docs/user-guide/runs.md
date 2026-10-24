# Runs

A run is one analysis of your data: an extraction from a system, or an imported file, followed by the checks. Every score and finding in Meridian belongs to a run. Runs is where you see the history, compare two runs, name and pin runs, and keep the list tidy.

## Runs and their lineage

Runs of the same system belong to one lineage. Imported files share a lineage when they carry the same objects. Meridian only ever compares a run with an earlier run of its own lineage, so one object is never measured against another.

Most pages show the newest finished run unless the address names one with `?run=`. When a page shows an older run, its header reads "As of" and names it, with **Back to latest** to return.

## What you see

Open **Runs** from the index bar. The header reads **Runs**. On the right:

- The export menu, which downloads up to 100 runs as Excel, for the filtered system if you chose one.
- **Archive older runs**, or **Restore archived runs** while archived runs are shown. You see these if your role can run analyses.
- **Run analysis**, which opens the first connected system so you can extract. With no system connected, the button is disabled and its tooltip reads "Connect a system first".

### The score chart and figures

**Score per run** draws the score of each finished run of one system: the system you filter on, else the system of the newest run. Select a point to open that run. With fewer than two runs it reads "Trend appears after two runs".

Under the chart are figures:

- **Latest DQS**: the newest run's score, with its change "vs previous", or "No earlier run".
- **Runs**: how many runs there are.
- **Failed runs**: shown only when runs in the newest 100 failed. Select it to list only failed runs.

### Filters

- **System** narrows the list to one system. Imported files have no system, so they are not offered.
- **Show archived** adds archived runs to the list.

Each active filter shows as a chip, such as "System: PRD ECC" or "Status: failed". Select a chip to remove it.

### The runs table

Runs are listed newest first and grouped by day. The columns are:

- **Day**: the date, shown on the first run of each day.
- **Run**: the run's name, or its date and time when it has none. A **Baseline** pill marks the pinned baseline, and an **Archived** pill marks an archived run.
- **Lineage**: a sparkline of the scores of up to twelve runs in the same lineage, ending at this one.
- **Status**: Queued, Running, Done or Failed. A run still being analysed shows a progress bar with its percentage and step.
- **DQS**: the score, with the change from the previous run of the lineage.
- **Critical** and **High**: findings of that severity, with the change from the previous run. A fall is good.
- **Open**, and **Delete permanently** on archived runs for administrators.

Select a row to open the run. The table shows 100 runs per page.

## How to compare two runs

1. On Runs, tick the boxes of two runs. Press space or `x` to tick the row your cursor is on.
2. Select **Compare** in the bar above the table, or press `c`.
3. Meridian opens `/runs/<newer>/vs/<older>`, always the newer run against the older.

Ticking rows needs a role that can change data. On a run's page, **Compare with previous** and **Compare with baseline** open the same view without selecting.

### The comparison page

The header names both runs, such as "Pre-migration vs Baseline load", with their dates. Then:

- An **Object** picker narrows the comparison to one object.
- A few sentences say what changed.
- Three figures show the score of each run and the **Delta**.
- A table lists each rule that changed, with **Rule**, **Object**, **Records before**, **Records after** and **Delta**.

Select a rule to see its detail. A rule marked **Newly failing** lists the records that newly fail, with a filter for record keys and **Create fix batch**. A rule marked **Fixed** says how many records failed before. To batch several rules at once, tick them and select **Create fix batches**. Creating batches needs the permission to apply fixes. The export menu downloads the comparison as PDF.

"No differences" means the two runs have identical results. "No earlier run to compare" means the run has no earlier finished run in its lineage.

## The run page

Select a run to open `/runs/<run>`. The header shows the run's name, its status and a **Baseline** pill if it is the baseline. The line under it gives the start time, the system and the duration, with a picker for the other runs of the lineage. The buttons are:

- **Compare with previous** and **Compare with baseline**, when such runs exist.
- **Rename** and **Pin as baseline**, or **Unpin baseline**.
- **Re-run analysis**: checks the run's stored data again with the current rules. Findings are replaced; the name, baseline and history stay.
- The export menu: the run's steps as Excel, **Analysis report (PDF)**, and **Narrative report (PDF)** when the run has an AI narrative.

Renaming, pinning and re-running need a role that can run analyses. While analysis runs, a progress bar shows the step and the rows processed. You can leave the page; the work carries on.

### Overview

- The score on its ruler, with the change from the previous run. When a critical rule caps the score, the ruler shows the cap and the measured value beyond it.
- **Blocking findings**, **Affected records** and, when a cost rate is set, **Cost at risk**.
- **Score by dimension**: one bar per dimension the run measured. Select a bar to list its findings.
- **Objects in this run**: each object with its **Score**, **Blocking rule**, **Critical**, **High** and **Records**, ranked by records affected.
- **Next actions**: up to five actions ranked by impact per hour of effort.
- **Composite over runs**: the score across the lineage. "This run" marks this run, and "Score fell" marks any run that dropped five points or more. Select a point to open that run.

### Objects

Each object with its **Composite** score, **Readiness**, **Failing checks**, **Affected records** and a **Trend**. Select **Open** to open the object in this run.

### Findings

Every failing rule in the run, worst severity first. Filter by **Severity** and **Dimension**. The columns are **Severity**, **Rule**, **Object**, **Dimension**, **Records** (such as "120 of 4,000") and **Message**. Select the record count to open the failing records.

Select a finding to open its drawer: **What failed**, **How many**, **Impact**, **Samples** and **Root cause**, with **Open records** and **Open rule**. If your role can apply fixes, **Create fix batch** creates a fix batch, or **Open fix batch** opens the one that exists.

### Steps

Each stage of the run with its **Status**, **Started**, **Duration** and **Error**. Select a step to read its error in full. Use this tab to see where a failed run stopped and why.

### Configuration

Where the system's live configuration disagrees with a standard rule. Each match shows the **Check**, **Record**, **Field**, **Actual** value, what the **Standard expects**, a **Classification**, the **Recommended action**, the **T-code** and a **Priority**. "No config matches yet" means the analysis did not include the configuration engine; **Re-run analysis** checks the run again (analyse permission).

### Audit

Every logged action on the run.

## How to name a run

1. Open the run and select **Rename**.
2. Type a **Name**, such as "Pre-migration baseline".
3. Select **Save name**, or press Enter. **Keep** leaves the name as it was.

You can also name a run before it starts, in **Run label** when you extract.

## How to pin a baseline

1. Open the run you want later runs compared with.
2. Select **Pin as baseline**.

Each lineage has one baseline. Pinning a new one replaces the old. The baseline shows a **Baseline** pill on Runs and in Trends, and **Compare with baseline** appears on later runs. Select **Unpin baseline** to remove it.

## How to archive and restore runs

Archiving hides older runs from every list. Nothing is deleted.

1. On Runs, select **Archive older runs**.
2. In **Keep the newest**, enter how many of the newest finished runs to keep, from 0 to 100. The dialog says how many runs will be archived.
3. Select **Archive**.

The count is across the whole workspace, not per system. To bring runs back, select **Show archived**, then **Restore archived runs**. This restores every archived run.

## How to delete a run permanently

Only administrators can delete a run, and only an archived one.

1. Select **Show archived** on Runs.
2. Find the run and select **Delete permanently**.
3. Type the run's name, or its ID if it has no name, to confirm.
4. Select **Delete permanently**.

Every finding, record, profile, report and fix of the run is removed. This cannot be undone. Meridian refuses the delete, and says why, while the run still has:

- stewardship items not resolved
- cleaning items not finished
- write-back requests pending or approved
- open record issues seen only in this run

## Run by run on Insights

**Insights**, then **Trends**, at `/insights/trends`, shows the runs of one lineage side by side. Choose a **Window** of **Last 6 runs**, **Last 12 runs** or **Last 24 runs**, and a **System** when you have more than one.

The **Run by run** table lists each run newest first, with a **Baseline** or **This run** pill where it applies:

- **Score**
- **Change** from the run before, or "first run"
- **Critical** and **High**
- **Rules fixed** since the run before
- **Newly failing** rules
- **Failing records**

Select a row to open the run. The same page draws the composite score, each dimension, and a grid of dimension changes per run.

## Good to know

- "Run not found" on a run page may mean the run was archived.
- "No runs yet" means nothing has been extracted or imported. The page offers the next setup step.
- "No runs match" means the filters hide every run. Select **Clear filters**.
- A failed run keeps its steps, so the **Steps** tab still shows what went wrong.

## Related

- [Systems](/docs?page=systems)
- [Objects](/docs?page=objects)
- [Insights](/docs?page=insights)
- [Fix](/docs?page=fix)
- [Admin](/docs?page=admin)
- [Shortcuts](/docs?page=shortcuts)
