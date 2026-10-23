# Insights

Insights turns the findings of your runs into answers for the people who decide: how good the data is, whether it is getting better, where the problems sit, what blocks a load and who owns the work. Programme leads, data owners and executives use it most.

## What you see

Select **Insights** in the index bar to open the overview (`/insights`). The views are grouped in the **More** menu under Insights, and each view has its own tabs under the page title:

- **Summary**: **Summary**, **Overview** and **Reports**.
- **Progress**: **Since baseline**, **Trends** and **Forecast**.
- **Explore**: **Rules**, **Value at risk**, **Lineage**, **Patterns** and **Duplicates**.
- **Readiness**: **Waves**, **Processes** and **Migration cockpit**.
- **Operate**: **Owners**, **Operations**, **Runs**, **Fix queue** and **Data contracts**.

Every Insights page is built the same way, top to bottom:

1. The header: the title, the scope line, and the action bar with **Run analysis** (if you may start a sync), **Auto clean**, **Report library**, **Present** and **Export**.
2. The four-sentence header: **Situation**, **What changed**, **Why it matters** and **Do next**, with one button for the next action. A sentence that is a link opens the page that explains it.
3. The cards: the ledger that ranks the work first, then the charts.

## Scope controls

- **Run.** Most views show one run. The scope line reads **One run**, then "As of" the run, with a **Showing run** picker of the other runs of the same system or upload and the latest run of every other one. **Back to latest** appears while you look at an older run. Without `?run=` in the address, the newest finished run is used.
- **Current state.** The overview alone can show every object at its latest run. The scope line then reads "Current state of N objects, latest run" and a date, and **Showing** lets you open one run instead. **Back to current state** returns.
- **Object.** Explore filters to one object, and the report library has an **Object** choice. An object filter shows the newest run that measured that object.
- **System.** Trends and process readiness offer a **System** choice when you have more than one system.
- **Window.** Trends offers **Last 6 runs**, **Last 12 runs** or **Last 24 runs**.

## Summary

The overview (`/insights`) leads with the score, its verdict (Ready to load, At risk or Not ready), any cap, and figures such as blocking gaps, auto-fixable records and the worst L1 process value at risk. Below are **Fix first** (the failing rules ranked by impact on the score), **Trend**, **Dimensions**, **Root causes**, **S/4 migration**, **Cleansing opportunity** and the **Object heatmap**. Select a heatmap cell to open that object, filtered to the dimension.

The executive summary (`/insights/exec`) leads with the score and **No-go cells**, **Largest L1 at risk**, **Owners improved** and **Owners slipped**. Its cards are **Fix first**, **Readiness by wave** (a heatmap of objects against waves, then the blocked cells), **Score movement** per L1 process, **Owners** and **Return on investment**. Return on investment appears once the subscription and cost per record are set.

**Reports** opens the report library. See [Reports](/docs?page=reports).

## Progress

### Since baseline

Progress (`/insights/progress`) compares the run with a baseline. Its figures are **DQS now**, **Records fixed**, **New failures** and **Still failing**.

- **Objects since baseline** lists each object's **Baseline** and **Now** score, the **Change** and a line of **All runs**, worst change first.
- **Rules that moved** lists up to 25 rules with records **Fixed**, **New** and **Still failing**. Only rules evaluated in both runs are listed; the rest are counted in the card's note.

### Trends

Trends (`/insights/trends`) follows one system's runs, or uploads of the same objects. Every run is re-weighted under your current scoring settings, so the line compares like with like. Markers show where a baseline was pinned or the scoring settings changed.

- **Composite score**: one point per run. Select a point to open that run.
- **Run by run**: the ledger, newest first. See below.
- **Rules that moved most**, then a chart per dimension, then **Change per run**: a heatmap of each dimension's change, in points, from the run before.

### Forecast

Forecast (`/insights/forecast`) reads every object's score history, not one run. It needs runs on at least three different days. **Predicted DQS** plots each object now and in 7, 30 and 90 days, with its trend and confidence. **Early warnings** lists each object's **Signal** (Red, Amber or Green), **Message** and **Recommended action**.

## Explore

**Rules** (`/insights/rules`) is one set of failing rules seen from any angle. Pick **Group by**: **Rule**, **Object**, **Field**, **Dimension**, **Severity** or **S/4 status**. Narrow it with **Severity**, **Dimension**, **Auto-fixable** and **S/4 blocking**. The ledger shows each rule's object, severity, dimension, **Failing records**, **Total**, **Pass rate**, **Impact**, **Auto-fix** share, **S/4** status, **Change** since the previous run, field and **Open records**. Impact is failing records times a severity weight: critical 8, high 4, medium 2, low 1. The **Impact by** chart below shows how few rules carry 80% of it. Select a group row to drill into it. **Views** saves the current filters under a name.

**Value at risk** (`/insights/impact`) lists **Features at risk**: each blocked SAP feature with its **Blocked records**, **Value at risk** and **Blocking rule**. Value at risk is the blocked records times the value of each, so it appears only once features are priced. **Proven cost findings** shows money measured on posted documents that broke a rule. Amounts are shown per L1 process and never added across processes.

**Lineage** (`/insights/lineage`) traces a field, rule or KPI up and downstream. Enter a node, pick **Direction** and **Depth**, and select **Trace**. **KPIs, processes and features at risk** ranks what the latest completed run's failing rules reach. Select a node to see the rules guarding it, or a rule's blast radius.

**Patterns** (`/insights/mining`) has three tabs: **Entity links**, **Mined dependencies** and **Patterns** (anomaly, drift, duplicate and PII). **Mine now** mines the run shown.

**Duplicates** (`/insights/duplicates`) has **Clusters**, **Mined duplicates**, **Anomalies** and **Relationships**. On **Clusters**, choose an **Object** and a **Record ID** to see its cluster. Pick the surviving record and select **Create merge proposal**; the proposals wait for review in the inbox.

## Readiness

**Waves** (`/insights/readiness`) shows **Blocked objects**: each object and wave with its **Readiness**, **Blocking gaps** and **Records blocked**, and **Fix** to open the blocking rules. **Which waves are blocked** is a heatmap of objects against waves. Without waves, blockers are listed by S/4 simplification area, and the grid reads **Readiness is not set up yet**. Readiness needs a wave: select **Open migration cockpit**, then **Create wave** to group the objects you move together and set the wave's **Minimum readiness %**. Creating a wave needs the analyse permission.

**Processes** (`/insights/process`) has two tabs. **Readiness** scores the L1 to L5 process of a procure to pay or order to cash object from the latest completed run: **Blocking findings**, **Gates** (Blocked, At risk or Ready at 90% and over), **Recommendations**, **Rules by step** and **SAP features at risk**. **Map** shows the process mined from the run, with **Failing steps** and **Variants**.

**Migration cockpit** opens the Migration page.

## Operate

**Owners** (`/insights/owners`) lists **Score by owner**, lowest first, with **Open items**, **Change** and **Fixed since baseline**, then a card per owner with open items by severity and their digest. **Schedule digests** opens Scoring and alerts.

**Operations** (`/insights/operations`) shows **Throughput and capacity**, **Queue age by stage**, a **Team member** picker, **Bottlenecks** and **Sprint plans**.

## How to read the Run by run ledger

Each row is one run, with **Baseline** or **This run** marked beside the name.

- **Score**: the composite score.
- **Change**: points against the run before. The first run of the window has nothing to compare with and reads "first run".
- **Critical** and **High**: failing rules at that severity.
- **Rules fixed**: rules that failed in the run before and pass in this one.
- **Newly failing**: rules that passed in the run before and fail in this one.
- **Failing records**: records affected across the failing rules.

Only rules that ran cleanly in both runs count as fixed or newly failing. A rule that errored in either run is left out. Select a row to open that run.

## How to drill into a finding

1. Select a row in **Fix first**, **Rules** or another rule ledger.
2. The finding opens in a side panel: **What failed**, **How many**, **Why**, **Impact**, **Samples** and **Fix**.
3. Select **Auto clean this rule**, **Open records** or **Open rule**.

Object names in the ledgers open the object on its Rules tab.

## How to compare with a baseline

1. Open **Progress**.
2. Under **Compare with**, pick a run, or leave **Pinned baseline or previous run**.
3. To make the run you are viewing the reference for later runs, select **Pin as baseline**.

## How to export

Select **Export** in the action bar. Every view scoped to a run offers **Failing records list (Excel)**; the overview in current state offers **Failing records list, current state (Excel)**. Some views add more:

- Overview: **Board pack (PDF)** and **Analyst workbook (Excel)**.
- Executive summary: the same two, plus **Run data (JSON)**.
- Progress: **Proof of progress (PDF)** and **Comparison workbook (Excel)**.

For every other report, open **Report library**.

## How to present

Select **Present**. The page shows its content only, without the action bar or tabs. Select **Exit presentation** to return.

## Who can do what

- Every role with the view permission sees Insights.
- **Export** needs the export permission.
- **Run analysis** needs the right to start a sync.
- **Pin as baseline** needs the analyse permission.
- **Create merge proposal** on Duplicates needs the approve permission.
- **Send digest now** and **Send digests to everyone** on Owners need the manage-rules permission.

## Good to know

- "Nothing to compare yet" on Progress means this is the first finished run of its system.
- Trends needs at least two finished runs of the same system or upload.
- "No feature is priced yet" on Value at risk means the cost model gives no feature a value. Set it under Admin, Settings.
- "No waves yet" on Waves means no wave exists. Create one in the migration cockpit.
- A card that fails to load shows its own error and **Retry**; the rest of the page still works.

## Related

- [Reports](/docs?page=reports)
- [Objects](/docs?page=objects)
- [Runs](/docs?page=runs)
- [Rules](/docs?page=rules)
- [Fix](/docs?page=fix)
- [Migration](/docs?page=migration)
