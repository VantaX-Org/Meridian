# An object and its tabs

An object is one area of SAP data scored as a whole on one system, such as Material master on ECC production. The object canvas is where you read its score with the receipt that proves it, and where every view of the object lives as a tab: Rules, Records, Fixes, Runs, Readiness, Processes, Lineage, Glossary and Golden records. Open it from a cell on the landscape, from an object row in the map, or by typing its name in the command line. Its address is `/v2/o/{system}/{object}`, for example `/v2/o/ecc-production/material-master`.

## The header

- **Watch**: "You hear about runs, score drops, new critical breaches and comments on Material master." Watching is per person; what reaches you is set under Preferences, What you hear about.
- **Data contracts**: the contracts that name this object.
- **Related objects**: each related object with its relation, **upstream** or **downstream**. Fix the upstream object first: records there fail before this object can pass.
- **The facts line**: the run, records checked, rules measured, records to fix, value at risk, S/4 features blocked and the wave verdict, for example "Run 16 Oct 2026, 05:17, 61,816 records checked, 913 rules measured, 25,712 to fix, ZAR 4.2 m at risk, 3 features blocked, No-go for wave 1".

## The ruler and the receipt

The large ruler has the 0 to 100 axis with the 60 critical, 75 at risk and 90 go marks, and two cap lines, **cap 1 critical** (85) and **cap 2 or more** (70). Each of the six segments is filled to its dimension score, which is printed under it. The tick is the measured score; the number beside it is the score shown, with **capped** when a cap applies.

Under it the receipt says it in words, exactly as the product states it: "Measured 71.8, the tick on the ruler. Capped at 70 by MM014 and MM031, two critical rules over tolerance."

The receipt table then adds the score up: one row per dimension with its weight, score, points, rules measured, records checked and coverage; then **Weighted**, **Measured**, **Cap, 2 critical rules over tolerance** and **Score shown**. The formula line under it is the full rule: the six weights, "severity weights critical 4, high 3, medium 2, low 1; tolerance 10% of rows or 25 rows, as set on each rule; cap rule: 85 at one critical rule over tolerance, 70 at two or more." Every row has an **i** that explains the figure from the run itself.

**Critical rules over tolerance** lists the rules behind the cap with their failing records and share, for example "MM014 Base unit of measure not valid, 3,640 failing, 5.89%".

## The tabs

- **Rules**: every rule of the object, ranked by value at risk, with field, dimension, severity, tolerance, over tolerance, failing rows, failing %, coverage and value at risk. Each rule says what goes wrong in SAP while it fails, for example "Goods movements and MRP cannot post for a material whose base unit is not an ISO unit." Where suggested values exist, **Accept all** accepts them for that rule. Pivot the list **By rule**, **By field**, **By dimension**, **By severity** or **By S/4 feature**; **Learned** and **Drafts** list rules waiting for review. The line under it reads "Ranked by value at risk; total ZAR 4.2 m across 913 rules measured. Failing % is of 61,816 records checked."
- **Records**: the Work ledger scoped to this object. See the Work ledger chapter.
- **Fixes**: the fix batches of this object. "No fix batches for Material master yet. A batch starts when a steward accepts suggested values or imports a filled fix sheet."
- **Runs**: the measured score over the last eight runs with the cap line and the baseline, a table of measured and shown scores per run ("Scores are as stored with each run; the measured score is before the cap, the shown score after it."), **Compare with** to open two runs side by side, and **Why the score moved** against the baseline: rules newly failing, fixed, worse and better.
- **Readiness**: the migration waves this object belongs to with the verdict, blocking gaps, score, readiness and records blocked, and "What the failing rules do in S/4HANA": the features blocked and degraded, each with the rules behind it.
- **Processes**, **Lineage**, **Glossary**, **Golden records**: each has its own chapter.

## What you can do, by role

- **Everyone**: watch the object, read every tab, export any grid with **Share and export**, comment on a rule in its inspector.
- **Data steward**: **Accept all** suggested values on a rule (needs apply), open the records to fix.
- **Data owner**: apply the steward template to objects you own, from the object's steward template action.
- **Programme lead**: share the page as a link, compare runs.
- **Process analyst**: the Processes tab and its what-if simulation.

## Keyboard

- In every tab table, `j` and `k` move, `Enter` opens the row in the inspector, `x` selects.
- `[` and `]` step to the previous or next row while the inspector is open.
- `Esc` closes the inspector.

## When something is wrong

- **"No run yet"** and an empty ruler: this object has never been analysed on this system. Ask SAP Basis to extract and analyse it.
- **The measured and shown scores are the same, but the receipt names a critical rule**: "A critical rule is over tolerance, but the score is already below its cap."
- **The Records tab says the ledger could not be loaded**: open Work from the link under the message; the ledger reads the latest run of each object.
- **Low confidence**: fewer than 70% of the rules attempted produced a result. The receipt row **Coverage** shows which dimension is short. SAP Basis can widen the extraction.
- **A figure looks wrong**: open its **i**. If the arithmetic there does not match, copy the diagnostics from help and send them to your administrator.
