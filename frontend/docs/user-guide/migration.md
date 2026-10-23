# Migration

Migration tells you whether your data is ready to move to S/4HANA, wave by wave and object by object, and what is stopping it. Programme leads use it to plan cutovers; stewards use it to find and fix the records that would be rejected.

Open it from the **More** menu: **Migration** is listed under **Systems**. It shows to roles that can run analyses (Admin, Manager, Steward and Analyst). The **Readiness** view under **Insights** also links to it as **Migration cockpit**.

## Waves

A wave is the set of objects you move together in one cutover. It has a source system, a target, a list of modules, a target date, a stage and a minimum readiness.

The [Migration](/migration) page header shows the number of waves and **Create wave**. The figures are **Waves**, **Go**, **At risk** and **No-go**. Select a verdict to show only those waves; **Clear filter** shows all again.

The table lists **Wave**, **Stage**, **Target date**, **Verdict**, **Readiness**, **Trend**, and the actions **Run now**, **Dry run (S/4 load)** and **Open**. Waves that need a hand come first: no-go, then at risk, then go, and within each the lowest readiness. A wave that has not been run shows **Not run**.

## How to create a wave

1. Select **Create wave**.
2. Fill in **Name**.
3. Choose the **Source system**, or leave **None yet**.
4. Choose the **Target system**, or leave **S/4HANA standard**.
5. Under **Modules**, type the module ids separated by commas, for example `material_master, accounts_payable`.
6. Set the **Target date** and the **Stage**: **Plan**, **Mock 1**, **Mock 2**, **Dress rehearsal** or **Cutover**.
7. Set **Minimum readiness %**. It starts at 95.
8. Select **Save wave**.

Creating, running and changing waves needs the analyse permission.

## How to run a wave

1. In the waves table, select **Run now**.
2. Meridian queues the run and says that readiness updates when it completes.

A wave needs a source system and at least one module before it can run.

## How verdicts are worked out

Each run scores every module of the wave from its records:

- **Readiness** is the share of records that would load. A record is blocked when it has a critical or high gap against the target.
- A module is **Go** when no record is blocked and nothing structural is critical.
- A module is **At risk** (conditional) when some records are blocked but readiness is 90% or more and nothing structural is critical.
- A module is **No-go** otherwise, or when the run has no result for it.

The wave's minimum then applies. A module that would be go but sits below the wave's minimum readiness becomes **At risk**. If the wave also carries a minimum DQS, a module whose DQS is below it becomes **At risk** too.

The wave's verdict is the worst of its modules. One no-go module makes the whole wave no-go.

## One wave

Open a wave to see its cockpit. The header shows the wave name, its verdict, its stage, its target date and whether it has been signed off.

Three figures follow:

- **Readiness**: the wave's score, with a mark at the minimum and "minimum N%" beside it.
- **Records blocked**: blocked records "of" the total.
- **Trend**: readiness across the wave's runs.

The tabs are:

- **Overview**: one row per object with **Object**, **Verdict**, **Readiness**, **Records**, **Records blocked**, **Blocking gaps** and **DQS**, objects with the most blocked records first. The numbers open the object at the wave's run. A bar chart counts objects by verdict.
- **Blockers**: the critical and high gaps from the latest run, with **Object**, **Gap**, **Field**, **Severity** and **Records**. Select a row to list the affected records with their **Record**, **Source value** and **Detail**.
- **Mapping**: how source fields map to the target, per module.
- **S/4 areas**: what the S/4HANA simplification checks object to.
- **Related**, **History** and **Audit**.

## How to fix blockers

1. Open the **Blockers** tab.
2. Select a row to see the records behind it.
3. Select **Create fix batch**. Meridian drafts a fix batch for that object, gap and field.
4. Review and export the batch under [Fix](/docs?page=fix), **Batches**.
5. Load the corrections in your source system and run the wave again. The verdict updates with the next run.

Creating a fix batch needs the apply permission (Admin, Manager and Steward).

## How to check the field and value mapping

1. Open the **Mapping** tab and choose a **Module**.
2. The table lists each **Source field**, its **Target field** (or "Not migrated") and its **Origin**.
3. Tick **Confirmed** once you have checked a mapping.
4. Where a field has a value map, select **Value map** to see each **Source value** and **Target value**.
5. To add an entry, type a source value and a target value and select **Add mapping**.

"No field map for this module yet" means the wave has not run; running it seeds one. Confirming and adding mappings need the analyse permission.

## S/4HANA readiness by area

The **S/4 areas** tab groups the run's findings by S/4HANA simplification area, such as Business Partner or Material Ledger. Its rules come from the S/4HANA readiness pack and from existing rules that a conversion depends on. A failing rule marked as blocking always counts against the area.

The figures are **Ready** (go or no-go), **Blocking areas** and **Failing records**. The table lists each **Area** with its **Status**, **Rules**, **Failing rules**, **Blocking** and **Failing records**, and two actions: **Open findings** and **Create fix batch**, which drafts a batch for the area's first failing check and opens it on the **Batches** tab of [Fix](/fix?tab=batches).

Select an area to open its panel: the counts of failing, blocking and warning rules, each failing check with its impact and failing records, and **How to fix it**, which gives the rule's message, its SAP impact and how to correct a record, for up to five checks.

## How to sign off a wave

When a wave's verdict is **Go**, the header shows **Sign off**.

1. Select **Sign off**.
2. Meridian records who signed off and when, in the audit log, and shows it in the header.

Only a go wave can be signed off, and only once. Signing off needs the approve permission (Admin, Manager, Steward and Approver). Without it, the button is greyed out and its tooltip names the role you need, with a **Request access** link.

## How to export wave reports

If your role can export, the wave header has an export menu:

- **Readiness report (PDF)** and **Readiness report (Excel)**.
- After a run: **Gap list (Excel)**, **Realignment (Excel)**, **Realignment (PDF)**, **Load files (Excel)** and **Load files (CSV)**.

## The dry run

A dry run applies the target system's load checks to your source records and reports which would fail to load and why. Nothing is written to SAP. Run one before each wave, so problems at load time become a fix list days earlier.

1. In the waves table, select **Dry run (S/4 load)** on a wave. The wave needs a source system.
2. Meridian queues the dry run and opens its page.
3. The page, titled **S/4 load dry run**, names the target release and says how many of the records would fail to load.
4. The figures are **Blocked** and **Total**, followed by each module with its verdict.
5. The table lists each failing record with **Module**, **Source table**, **Record**, **Status** (Load fail) and **Reasons**. **Open** takes you to the object's records.
6. Select **Export Excel** or **Export PDF** to share the result.

The page keeps the dry run in its address, so you can bookmark it and come back. Opened without a dry run, or with a run that is not one, the page lists every dry run, newest first, with its objects, target release, status and the records that would fail. Select one to open it.

## How waves feed readiness and the board pack

Every wave's latest run feeds the views that ask "can we load":

- **Insights**, **Readiness** has three views: **Waves**, **Processes** and **Migration cockpit**. **Waves** shows **Which waves are blocked**: a grid with one cell per wave and object, coloured by verdict. Select a cell to open that object's blocking rules for the wave. See [Insights](/docs?page=insights).
- **Insights**, **Summary** shows **Readiness by wave** and the count of no-go cells.
- The **Board pack (PDF)** has a **Migration readiness** section. It lists the modules of each wave with their score and blocking rules, and charts blocking rules and warnings by S/4HANA area. See [Reports](/docs?page=reports).

Without any wave, the readiness view lists the S/4HANA simplification areas whose rules fail, so you can still see what would block a load.

## Good to know

- "No migration waves yet. Create one to track readiness." means none exist.
- "Add modules to this wave to see its objects." means the wave has no modules.
- "Run this wave to see its blockers." means it has not been run.
- "The latest run found no critical or high gaps." means nothing blocks the wave.
- A wave with **Not run** has no verdict. It counts in no verdict figure.
- Verdict colours use the same scale as everywhere in Meridian: green for go, amber for at risk, red for no-go.

## Related

- [Fix](/docs?page=fix)
- [Insights](/docs?page=insights)
- [Reports](/docs?page=reports)
- [Systems](/docs?page=systems)
- [Rules](/docs?page=rules)
