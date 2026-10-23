# Processes

Processes shows how your business processes really run in SAP, mined from the documents in your system, and how ready each process step is given the quality of the data behind it. Process analysts run discovery; programme leads and process owners read the flows, variants and readiness.

The pages are in the **More** menu under **Process**: **As-is processes** and **Discovery runs**. Process readiness is under **Insights**, **Readiness**, on the **Processes** view.

## The L1 to L5 hierarchy

Every process in Meridian follows one five-level model:

- **L1**, end-to-end process, for example Procure to Pay (`PTP`) or Order to Cash (`OTC`).
- **L2**, process area, for example vendor management.
- **L3**, process.
- **L4**, sub-process: one BPMN diagram, usually one transaction code, for example `FK01`.
- **L5**, activity: one task in the diagram. An activity lists the SAP `TABLE.FIELD` points it touches, and the rule that checks each one.

The reference model holds SAP best-practice steps. Discovery measures what actually happened against it.

## As-is processes

[As-is processes](/process) is titled **Processes**, with the system's name. Choose the system with **System**. If your role can run discovery, **Run discovery** starts a new run.

The four sentences at the top say how many processes are discovered on the system, when the last run finished, which process has the lowest fitness, and what to do next.

The table lists one row per L1, lowest fitness first:

- **Process**: its name and L1 id.
- **Coverage**: **Discovered** (at least 50 cases of the main type and every table read in full), **Partial** (some cases, or a table read only in part) or **Reference, not discovered** (no cases found).
- **Fitness**: how closely cases follow the reference, as a pill. While a run is going it shows the current stage; after a failure, **See the error**.
- **Variants**, **Cases** and **Median duration**.
- **DQ defects**: failing findings from the system's latest data quality run on the objects this process touches. Select the number to see those failing objects. A dash means no data quality run or no mapping.
- **Last run** and **Open**.

Fitness is green at 80% or more, amber from 60% and red below.

"Connect a system to discover processes" means no system is connected yet.

## How to run discovery

1. Open [Discovery runs](/process/runs) and choose the **System**.
2. Select **New run**. The **New discovery run** dialog opens.
3. Under **Processes**, tick the L1 processes to mine. All are ticked at first.
4. Choose the **Mode**. **Incremental** reads from the last run, with a 14-day overlap; it is the default once a run has completed. **Full** reads everything again.
5. For a full run, set **Period start**, or leave it blank for the whole history.
6. Select **Start run**, or **Close without starting**.

If you started one process, its run page opens. Running discovery needs the run process discovery permission (Admin and Process analyst). If an extraction is running on the system, a notice says the runs start once it completes.

## Discovery runs

The runs table lists **System**, **L1**, **Mode**, **Status**, **Stage**, **Percent**, **Started**, **Duration**, **Cases**, **Coverage** and **Open**. It refreshes while a run is active.

A run page shows the process name, its status and coverage, and four sentences: the run's mode and state, when it finished, its cases, fitness and median duration, and what to do next. Below are:

- **Stages**: each stage of the job and its status.
- **Tables read**: each SAP table with its **Rows** and **State**: **Complete**, **Partial** or **Truncated**.

If the run failed, the error is shown with **Retry**, which starts a full run of the same process. A **Reference only, not discovered** notice explains why a process could not be mined on this system.

## How to read one process

Open a process from the catalogue. The header shows its cases, variants and fitness. The levels above the current step appear as a trail; select one to go back up.

The filters apply to every tab: **From** and **To** dates, **Document type**, **Case type** (when the run found more than one), and **Automation** (**Manual and automated**, **Automated only** or **Manual only**).

The tabs are:

- **Flow**: the steps between the children of the current level.
- **BPMN**: the diagram of a level-4 sub-process.
- **Variants**: the distinct paths cases take.
- **Conformance**: how cases differ from the reference.
- **Cases**: individual cases. You see this tab only with the export process permission (Admin, Manager and Process analyst).
- **Reference**: the SAP best-practice steps this process is measured against.

### Flow

Each box is a step; its size is the number of cases. Each arrow's width is the number of cases taking it, and its label is the median wait. Arrows carried by under a set share of cases are hidden, as in the Signavio export; select **Show all edges** to see them. The legend marks bottlenecks (the slowest tenth of arrows by median wait) and rework (a step that repeats or goes back to an earlier step).

1. Select a step to drill one level down, as far as L4.
2. At L4, a table lists each L5 activity with **Source** (Reference, Config or Discovered), **Cases**, **Share**, **Median**, **P90**, **Rework**, **Automation**, **Fitness**, **T-code** and **Fields**.
3. Select an activity to see its figures and the fields it touches, with which are mandatory.

**View as table** swaps the chart for tables of steps and arrows. The steps table includes **DQ defects** for each step.

### Variants

The table lists **Rank**, **Sequence**, **Cases**, **Share**, **Median**, **P90** and **Fitness**. Variants past the top are merged into one last row, "All other variants". Select a variant to see its steps in order and, with the export process permission, sample cases to open.

### Conformance

**Fitness** is the share of reference steps each case performs in order. **Happy path** is the share of cases on the most common variant that follows the reference exactly, with the steps of that variant. **Missing steps** and **Out-of-order steps** rank the worst steps. The table lists each **Step** with **Step fitness**, **Missing**, **Out of order** and **Rework**. Rework is not measured for SuccessFactors, because each application keeps only its latest status.

### Cases

The list shows **Case**, **First event**, **Last event** and **Events**, up to 200 at a time. Select a case to see its timeline: each step, when it happened, who did it, the document type and whether it was automated.

## How to export a process

1. Open a discovered process and select **Export**.
2. Choose the **Format**: **Signavio (BPMN 2.0)** or **PowerPoint (.pptx)**.
3. For Signavio, choose the **Scope**: the whole L1 package as a .zip with one .bpmn per process, or only the step you are on as one .bpmn.
4. If filters are set, choose **The filters of this view** or **Every case in the run**.
5. Select **Export**.

Arrows carried by fewer than 1% of cases are left out of the Signavio export. Each step keeps its case count, share and median time. The dialog lists the three steps to import the files into Signavio Process Manager, starting with the L1 file.

The PowerPoint deck holds the reference model only: a summary, one slide per L1 and one per L4. Discovered cases and filters are not part of it.

Exporting needs the export process permission (Admin, Manager and Process analyst).

## Process readiness

Process readiness answers "can we run this process on this data". Open **Insights**, **Readiness** and choose **Processes**. The page is titled **Process** and has two tabs: **Readiness** and **Map**. It reads the latest completed analysis, or the run in the address.

### How data quality enriches each step

Each L5 field is linked to the rule that checks it. Meridian colours the field from that rule's result in the run:

- Red when the linked rule's finding is critical or high, or its pass rate is under 70%.
- Amber when the pass rate is from 70% to under 95%, or the rule is medium.
- Green when it passes 95% or more, or no finding exists.

An activity takes the worst colour of its fields, a sub-process the worst of its activities, and so on up. A gate (an L3 process) is **Blocked** if any field is red, **Ready** if 90% or more of its fields are green, and **At risk** otherwise.

### Readiness tab

Choose the **Object**, the **Process** and, with more than one system, the **System**. The four sentences say how many gates are blocked and what share of fields pass. Below are:

- **Blocking findings**: the top ten red fields by records affected, with **Severity**, **Finding**, **Gate** and **Records**.
- **Gates**: each L3 with its state and score.
- **Recommendations**: what to clear in each gate that is not green.
- **Rules by step**: for each process area, how many rules apply and pass, the top failing rules, and which rules do not apply to the loaded configuration.
- **SAP features at risk**: features the findings block or degrade.

Readiness covers objects with an L1 to L5 definition: procure to pay (vendors, purchasing, materials, general ledger) and order to cash (customers, sales orders, receivables). For other objects, the page offers **Runs with a process definition** to switch run.

### Map tab

The map shows the steps mined from the chosen run for one object, with **Failing steps** (top eight, with **Status**, **Step** and **Records**) and **Variants**. Select a step to see its transaction code, affected records, findings and pass rate.

## The process designer

The process designer at [/insights/process/designer](/insights/process/designer) is where you build your own L1 to L5 model and see where the data behind it breaks. You can also reach it from **Open designer** on a step that is only in the discovered flow.

1. Choose the **Process model**. **Reference model** is shared and read-only.
2. To edit, select **New model**, name it and select **Create from reference** (or from the model you are on).
3. Use the tree on the left to add, rename, move and remove levels. At L4, the canvas offers **Add activity**, **Add gateway**, **Add event**, **Auto-layout**, **Connect mode** and **Delete selected**.
4. Select **Sub-process details**, or an activity, to edit its **Name**, **Description**, **T-code** and fields. Each field links to its finding with **Open finding**.
5. Type a note in **What changed** and select **Save**, or press Ctrl S (⌘S on a Mac). Each save is a new version.

**Versions** lists earlier versions. Viewing one shows **Restore as new version** and **Back to latest**. If someone saved while you edited, choose **Reload** or **Save as a copy**.

**Overlay** switches between **Latest analysis** and **None**. With the overlay on, the figures show **Activities**, **Blocked** (red) and **Degraded** (amber), plus **Discovered variants** and **Unmapped**: document types found in the data but on no sub-process. **Create L1 from discovered** turns them into a starting skeleton, and **Adopt** attaches one to a sub-process.

**Export to Signavio** and **Export to PowerPoint** download the model. Both are unavailable while you have unsaved changes.

Editing needs the analyse permission (Admin, Manager, Steward and Analyst). Exporting needs the export permission.

## Good to know

- "No completed discovery run yet" means the process has not been mined. Run discovery first.
- "Reference, not discovered" means the system has no source tables for this process. You can still read the reference model.
- "Pick a level-4 process to see its diagram" means the BPMN tab needs an L4 step.
- Case counts do not add up across processes.

## Related

- [Insights](/docs?page=insights)
- [Systems](/docs?page=systems)
- [Rules](/docs?page=rules)
- [Migration](/docs?page=migration)
- [Roles and permissions](/docs?page=roles)
