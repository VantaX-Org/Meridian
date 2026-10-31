# Processes and the designer

The **Processes** tab of an object shows which business process steps its data blocks: Procure to Pay, Plan to Produce, Order to Cash and the others, down to the step, the transaction and the field. The **process designer** is where the process model is edited. Open the tab from the object's tabs (`/o/{system}/{object}/processes`) and the designer with **Open the designer** (`.../processes/design`).

## What is on the Processes tab

- **The sentence**: "2 of 4 process steps are blocked by Material master: PTP step 3, PP step 1."
- **Each process**: its name and code ("Procure to Pay PTP"), its state ("Blocked, 1 of 3 steps blocked"), its description and its steps. Each step names the transaction (`ME51N`, `ME21N`, `MIGO`), its state (**Ready** or **Blocked**) and, when blocked, the activities and fields behind it with status, pass rate and failing records, for example "Enter Quantity and Unit: `MARA-MEINS` Base unit of measure, Blocked, 94.1%, 3,640".
- The rule under it, as the product states it: "A step is blocked when a field it writes fails a critical or high rule, or passes under 70%. Failing counts are records, and a record can fail several rules."
- **What if these rules were fixed** (simulation): "Tick the rules to fix. The steps of Material master are read again without their failures; nothing is changed and no data is read." Each rule shows "3,640 records at least, in 1 step". The result shows which steps would be ready.
- **Process designer** with **Open the designer**.

## The step inspector

Open a step for its transaction, its activities and fields, the rules failing on them and **Hand off**, which hands a blocking rule to a steward with a note.

## The process designer

"Process designer, Material master", with the model's state, for example "Draft, version 1, updated 12 Oct 2026".

- **Model**: choose a model, **Create a model** (start from the reference model or the group model), **Publish model**, **Rename model**, **Delete model**.
- **The tree**: levels L1 to L4 (for example Procure to pay, Sourcing, Purchase order, Create purchase order with its activities), each with **Up**, **Down** and **Delete**, and **Add a process at the top level**.
- **The model panel**: "Choose an item in the tree to rename it, reorder it, add what sits under it, or map fields to its activities."
- **What changed**, **Save as a new version**, **Discard changes**, and **Versions**.
- The rule at the foot: "A step is blocked in process readiness when a field it reads fails a critical or high rule. Map the fields each activity reads here, and the Processes tab shows them on the next run."

## The numbers and where they come from

- Step states come from the fields mapped to each activity and the rules that failed on those fields in the run.
- The what-if simulation is computed in the browser over the process document and the receipt; it reads no data and changes nothing.

## What you can do, by role

- **Process analyst**: read readiness, run what-if, hand off a blocking rule (handoff rule), export the as-is process (export process), edit and publish the model.
- **Data steward**: receive handed-off rules in Work.
- **Everyone**: read.

## Keyboard

- `j` and `k` move through steps, `Enter` opens a step.
- In the designer tree, `Tab` moves between items.

## When something is wrong

- **"Choose at least one rule."** The simulation needs a ticked rule.
- **Every step is Ready but the object is No-go**: the failing rules are on fields no activity reads. Map them in the designer.
- **Your edits do not show on the Processes tab**: they show on the next run, and only once the model is published.

## Configuration

**Configuration** (`/config`, in the map under Requests and in the command line) shows the SAP configuration Meridian reads back out of the transactions of the latest run. Nothing on it is typed in by hand: every setting, step and finding comes from the stored config run.

- **The headline**: "14 configuration findings, R 2.1m at stake", with the average health across the areas, the critical and high findings, and the share of settings that carry transactions.
- **Processes**: each end-to-end flow (Procure-to-pay `PTP`, Order-to-cash `OTC`, Record-to-report `RTR` and the others) as a chain of steps. Each step is sized by the documents that reached it and names its SAP table; the red share is its exceptions, the step with the most exceptions is marked, and the days are the wait before the next step. A step the system never ran is drawn hollow and reads "Not found".
- **Health by area**: 100 less 3 per critical, 2 per high, 1 per medium and half per low finding, per area such as Finance `FI` or Materials management `MM`.
- **Settings in use**: the share of each area's configured values that carry at least one transaction. Low shares are settings that were configured and never used.
- **Findings**: worst first, each with its severity, what was found, the fix, the area, the settings it touches and the amount at stake.
- **Changes since the last run**: settings added, removed or changed between the last two config runs.
- **Read the configuration again** (analysts and above) queues a new config run on the latest analysed version; the figures change when it ends.

When no config run exists yet, the page says "Run an analysis on an SAP system to read its configuration."
