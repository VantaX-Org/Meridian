# Waves and gates

A migration wave is a set of objects moved together in one cutover, with a target date, a stage and a gate: the conditions every object must meet before the wave may go. The landscape's **Waves** view shows each wave with its verdict counts and gate state; the **Migration waves** panel is where the programme lead plans waves and sets gates. Open the view with **Waves** on the landscape (`/?view=waves`) and the panel with **Edit** on a wave (`?open=waves:{id}`), which opens that wave first with its gate on top and the other waves collapsed.

## The Waves view

Each wave heading reads, for example, "Wave 1: finance foundations, due 16 Nov 2026, 1 go, 0 at risk, 3 no-go, Gate not passed, 2 of 3 not met", with **Edit** and **Certificate**. At phone width the heading stays above each wave's objects, with the same gate state and both links. Under it, the wave's objects with their ruler, score, verdict, records and rules. The programme lead's next-step button follows the nearest wave: "Clear the 3 no-go objects in Wave 1: finance foundations" with "Wave 1: finance foundations: due 16 Nov 2026, in 17 days. 1 go, 0 at risk, 3 no-go."

An object's own **Readiness** tab lists its waves with the verdict, blocking gaps, score, readiness and records blocked, and the gate's threshold in the same words as the gate ("Gate: min score 85.0"). An object no run has scored yet for its wave shows no readiness or records blocked; the tab says so instead of showing zeros.

## The Migration waves panel

For each wave: **Name**, **Target date**, **Stage** (Plan, Mock load 1, Mock load 2, Dress rehearsal, Cutover) and its sign-off state ("Not signed off.").

**Gate**: up to three conditions, each with what fails it now:

- **Min score**: "Gate: min score 85.0", with the objects below it. The same words appear on the Readiness tab and the Waves view.
- **Zero criticals**: "No critical rule over tolerance", with the objects capped by a critical rule.
- **Contracts met**: "Data contracts met", or "No active contract names these objects."

**Save the gate** stores it. "No gate yet: a wave without one moves on its verdict alone."

**Readiness certificate**: the latest issued version and its state, for example "Version 2, waiting for signatures" or "Version 2, signed", or "Not issued". **Open the certificate** opens it: issue a new version, sign it, or download the PDF. When the gate refuses an issue, the certificate lists each object in the way, linked to its page, with the rules that stop it.

**Add a wave** creates one; **Objects** assigns each object to a wave or to none; **Save changes** or **Discard**. **Delete** removes a wave.

## The numbers and where they come from

- **Go, at risk, no-go** counts are the verdicts of the wave's objects in the run in the top bar, from the score bands.
- **Gate state** checks each condition against the same run: the shown scores, the critical rules over tolerance, and the active contracts that name the objects.
- **Due in N days** counts from today to the target date.

## Go-live flight deck

The flight deck at `/go-live` reads the next wave with a go-live date against the forecast of every object in it. Open it from **Open the flight deck** on the landscape banner.

- **Runway**: one row per object. The grey line is its daily score history; the blue line is the forecast to go-live with its 95% band shaded; the dashed red line is the wave's minimum score. A row whose forecast lands under the line is short.
- **Line meets target** is the day the slowest object's forecast crosses the minimum; it shows a dash while any object has too little history to forecast.
- **Cost of waiting** is the value at risk the wave's failing records carry today.
- **What if**: pick an object, tick the top fixes, and read the score, gates and verdict it would reach if those rules passed. Nothing is changed in SAP.
- Forecasts need three daily scores; an object with fewer shows **Forecast unavailable** instead of a guessed line.

## Migration analysis

The Migration analysis page, the Migration item on the rail, shows how ready the source data is to load into the target system. The banner gives the verdict of the latest finished analysis (ready to load, ready with conditions or not ready to load), with the readiness score, the critical gaps and the records that will not load beside it. Under it:

- **Start an analysis.** Users who may analyse choose the kind of analysis (a dry run against S/4HANA, source to target, or source to source), the systems and the objects, then press **Start**. The analysis runs in the background and appears in the list when it finishes.
- **Analyses.** Each analysis with its kind, objects, verdict, score, critical gaps and records blocked. Press **Open** to see one; the latest finished analysis opens by default.
- **Gaps by kind.** The gaps of the open analysis grouped by kind and severity: values with no target value, values longer than the target field, fields the target no longer has, keys that collide, values outside a check table and fields not yet mapped.
- **Field-level gaps.** Each gap with the record, the source field and value, the target field and value, the severity and why it will not load. Filter by object, kind, severity or text; the object filter stays in the address. Users with the export permission can export the list to Excel with the same filters.
- **Records.** The records that will not load, with the reasons, and the records that are ready to load.
- **Field map.** For each object, each source field as it was read, the S/4HANA field it loads into and both descriptions. The source and target definitions (type, length, decimals, check table) stand side by side, and the **Delta** column says what changes between them: a type change, a field shortened or lengthened, a decimals change, a different check table, or a field not carried to the target. The **Transformation** column shows the note that bridges the change, whether a value map translates the values, and where the mapping came from (same field name, SAP standard conversion or a steward). A change that can lose or reject data with no transformation yet is marked **Needs a transformation**. Bars above the table count the fields that load as read, those whose definition changes, those still without a transformation, those translated by a value map, those not carried and those not confirmed. Users who may analyse can propose the map from the source, confirm a mapping or remove it. A field that needs a value map has a **Values** button: it lists the source values found in the latest analysis with how many records carry each, and the target value saved for each one.

Every gap comes from the target data dictionary or configuration; a gap that is not grounded in either says so. Nothing is estimated: an analysis that has not finished shows a dash.

## Workbook from the new system

When SuccessFactors is being migrated, the new system's workbook sets the load format. The Workbook from the new system panel on the Migration analysis page fills that workbook from a finished SuccessFactors run. It appears only with the export permission and a SuccessFactors system.

1. **Choose the run and workbook.** Pick the run, then choose the `.xlsx` workbook, up to 25 MB.
2. **Check what fits.** **Check the workbook** reads the workbook and stores nothing. It shows the rows ready, the rows held back, how many columns each sheet can fill, and any required column with no data in this run. Open **Rows held back** to see each record, column and reason.
3. **Export the data.** **Export as Excel** gives one workbook; **Export as CSV files** gives a zip. Ready rows are in the workbook's own columns. Held rows are on a Held back tab. The export is recorded in the audit log.

A row is held back when a required value is empty, a value is longer than the workbook allows, a date or yes or no value is not valid, or a value is not in the workbook's list. A column with no source in the run stays empty and does not hold a row back, so check **Required columns with no data** before loading: the new system refuses those rows until the columns are filled.

## S/4HANA readiness

The S/4HANA readiness page, under Migration, groups the conversion-readiness rules by SAP simplification area, such as Business Partner / CVI, Material master or the Universal Journal, over every object at its latest run. The banner says whether the landscape is ready to convert, with the areas ready, the blocking and warning rules failing and the records to fix beside it. Under it:

- **Simplification areas.** Each area with the SAP simplification item it answers, its status, how many of its rules ran, the blocking and warning rules failing and the records to fix, worst first. An area none of whose rules ran shows as not measured, never as ready.
- **What stands in the way.** Every failing rule with its name, its area, whether it blocks the conversion or only needs cleansing, the records it affects and its pass rate, blocking rules first.

A failing blocking rule always makes its area red, whatever its pass rate.

## What you can do, by role

- **Programme lead** (analyse): plan waves, set gates, assign objects.
- **Data owner**: read the gate state of their objects' waves.
- **Everyone**: read the Waves view.
- **Sign off** (approve): on each wave in the Migration waves panel, once its verdict is go. The panel shows who signed it off and when; any later change to the wave clears the sign-off.

## Keyboard

- `g` then `h`, then the **Waves** view switch.
- `Esc` closes the panel.

## When something is wrong

- **A wave shows every object no-go but scores look close to target**: the cap holds them. The gate's **Zero criticals** line names the objects; clear their critical rules first.
- **Contracts met says no contract names the objects**: create one in People, Data contracts, or remove the condition.
- **The certificate says "Not issued"**: no version is issued yet. Open the certificate and issue one once the gate passes; if it refuses, the list under the button names the objects and rules to clear.
