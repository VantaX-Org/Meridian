# Analysis

The **Analysis** section of the **More** menu holds the pages for understanding the data rather than cleaning it: the Home overview, the Insights views and their reports, What-if, Runs, and the as-is processes. Leads, analysts and data owners use them most. Every page follows the run in the scope bar.

## Home

**Home** answers how healthy your SAP data is and what to do next. Each role lands on its own version: the data lead page, the Basis page or the process page. Stewards land on Fix work instead, and can still open the steward Home with **View as**, **Steward**. **View as** changes the layout only, never your rights.

The page shows the score on its ruler with the verdict (**Go**, **At risk** or **No-go**) and any cap, the object map, the four sentences (**Situation**, **What changed**, **Why it matters**, **Do next**), the objects holding the score back, and your own work. On the data lead page, **Root causes**, **S/4 migration** and **Cleansing opportunity** follow, each for the same scope. They came from the old Insights overview, which repeated Home and now opens Home. **Run analysis** opens a panel to extract and analyse a system's objects, for roles that may start extractions. From anywhere, press Ctrl K (⌘K) and then Ctrl 1 (⌘1) to go Home.

## Insights

**Insights** turns findings into answers for the people who decide. Its views, listed under **Insights** in the **More** menu, each have tabs under the title:

- **Summary**: the **Executive summary** and **Reports**, the report library with the board pack, analyst workbook, run comparison, object and owner reports, each with a preview and **Download**.
- **Progress**: the burn-down page, which ends with a **Team** section (see [Progress](/docs?page=progress)), **Trends**, which re-scores one system's runs under today's weights so the line compares like with like, and **Forecast**, which projects each object's score 7, 30 and 90 days ahead once there are runs on three different days.
- **Explore**: **Failing rules** grouped by rule, object, field, dimension or severity and ranked by impact; **Value at risk** for priced SAP features; **Lineage**, which also lists the **Relationships** the miner found between fields; **Patterns**, whose **Anomalies** tab lists values far outside the usual range; and **Duplicates**, where you create merge proposals from a cluster.
- **Readiness**: **Waves**, a grid of objects against migration waves, and **Processes**, the readiness of each procure to pay or order to cash step.
- **Operate**: **Owners**, the score and open work per owner with their digest. How the cleaning team keeps up (capacity, queue age and bottlenecks) is the **Team** section of Progress.

Every Insights page has the same build: the header with **Export** and **Present**, the four sentences, then the ledger that ranks the work and the charts. Select a rule in a ledger to open the finding beside the page, with what failed, how many, why, the samples and the fix.

## What-if

**What-if** applies every rule fix to a copy of a run and compares the score before and after. Nothing is written anywhere. Choose the **Analysis run**, select **Run simulation**, and read **Score before**, **Score after**, **Findings resolved**, **Findings introduced**, **Cells changed** and **Records fixed**, then the rules the fixes change and their side effects. **Create fix batch from this simulation** turns the result into a draft batch. What-if appears for roles with apply or approve; simulating needs the analyse permission.

## Runs

**Runs** lists every run, newest first, with its status, score and critical and high findings, each against the previous run of its lineage. From here you can:

- Tick two runs and press `c`, or use **Compare with previous** on a run's page, to see which rules and records were fixed or newly fail.
- Open a run to read its objects, findings, steps and configuration. **Re-run analysis** checks the stored data again with today's rules.
- **Rename** a run, **Pin as baseline** (the reference that later runs of the object are compared with, see [Monitoring](/docs?page=monitoring)), and archive older runs.

Pinning and archiving need the analyse permission.

## As-is processes and discovery runs

**As-is processes** reconstructs your real processes from SAP documents, level 1 to level 5, and measures them against a reference. Each process shows its coverage, fitness, variants, cases, median duration and the data quality defects on the objects it touches. Open one to read its **Flow**, **BPMN** diagram, **Variants**, **Conformance** and **Reference**. **Discovery runs** lists each discovery job with its stages and the SAP tables it read. Running discovery and exporting models need the process permissions.

## Ask Meridian

The **Ask Meridian** button at the bottom right of every page answers short questions in plain words, such as "Which objects are weakest?" or "What changed since the last run?", from your run's figures, with a link to the page behind each answer.

## Related

- [Progress](/docs?page=progress)
- [Objects](/docs?page=objects)
- [Data in](/docs?page=data-in)
- [Glossary](/docs?page=glossary)
