# An object and its tabs

An object is one area of SAP data scored as a whole on one system, such as Material master on ECC production. The object canvas is where you read its score with the receipt that proves it, and where every view of the object lives as a tab: Rules, Records, Fixes, Runs, Readiness, Processes, Lineage, Glossary and Golden records. Open it from a cell on the landscape, from an object row in the map, or by typing its name in the command line. Its address is `/o/{system}/{object}`, for example `/o/ecc-production/material-master`.

## The header

The tabs sit under the title: **Rules** (with its count), **Records** (with the records to fix), **Fixes**, **Runs**, **Readiness**, **Processes**, **Lineage**, **Glossary** and **Golden records**. The object opens on Rules, which carries the ruler and the receipt.


- **Watch**: "You hear about runs, score drops, new critical breaches and comments on Material master." Watching is per person; what reaches you is set under Preferences, What you hear about.
- **Data contracts**: the contracts that name this object.
- **Related objects**: each related object with its relation, **upstream** or **downstream**. Fix the upstream object first: records there fail before this object can pass.
- **The facts line**: the run, records checked, rules measured, records to fix, value at risk, S/4 features blocked and the wave verdict, for example "Run 16 Oct 2026, 05:17, 61,816 records checked, 80 rules measured, 25,712 to fix, ZAR 4.2 m est. at risk, estimated from your cost model, 3 features blocked, No-go for wave 1". While the tenant has not saved its own cost model the amount reads **default estimate** and links to the cost model in Administration.

## The ruler and the receipt

The large ruler has the 0 to 100 axis with the 60 critical, 75 at risk and 90 go marks, and two cap lines, **cap 1 critical** (85) and **cap 2 or more** (70). Each of the six segments is filled to its dimension score, which is printed under it. The tick is the measured score; the number beside it is the score shown, with **capped** and the measured score when a cap applies: "70.0 capped, 71.8 measured". Each segment is named by the formula's letter (C, A, Cs, T, U, V), with the full name on hover.

Under it the receipt says it in words, exactly as the product states it: "Measured 71.8, the tick on the ruler. Capped at 70 by MM003 and MM035, two critical rules over tolerance."

The receipt table then adds the score up: one row per dimension with its weight, score, points, rules measured, records checked and coverage; then **Weighted**, **Measured**, **Cap, 2 critical rules over tolerance** and **Score shown**. The formula line under it is the full rule: the six weights, "severity weights critical 4, high 3, medium 2, low 1; tolerance 10% of rows or 25 rows, as set on each rule; cap rule: 85 at one critical rule over tolerance, 70 at two or more." Every row has an **i** that explains the figure from the run itself.

**Policy classes breached** follows when an applied policy pack's class has a failing critical rule of this object: the class, its authority and the rules. A filled shield beside the score says the same on the ruler and the landscape cell; the diamond beside it is a data contract.

**As of** in the run menu shows the object as it stood when an earlier run finished: a band says so, the ruler and the rules are that run's, and **Back to today** returns.

**Top failing rules**, on the Rules tab under the ruler, lists the five failing rules with the highest value at risk: each with its severity, id and name, its failing rows and a small trend of its failing rows over its last runs. Select a rule id to open the rule.

**Critical rules over tolerance** lists the rules behind the cap with their failing records and share, for example "MM003 Material type is mandatory - determines procurement and storage behaviour, 2,904 failing, 4.7%" and "MM035 Valuation class is mandatory for FI account determination, 1,420 failing, 2.3%".

## The tabs

- **Rules**: every rule of the object, ranked by value at risk, with field, dimension, severity, tolerance, over tolerance, failing rows, failing %, coverage and value at risk. Each rule says what goes wrong in SAP while it fails, for example "Goods movements and MRP cannot post for a material whose base unit is not an ISO unit." Where suggested values exist, **Accept all** accepts them for that rule. Pivot the list **By rule**, **By field**, **By dimension**, **By severity** or **By S/4 feature**; **Learned** and **Drafts** list rules waiting for review. The line under it reads "Ranked by value at risk; total ZAR 4.2 m across 80 rules measured. Failing % is of 61,816 records checked." Where the tab shows only part of the object's rules, the last cell ("and 905 more rules") opens the rules library filtered to the object.
- **Records**: the Work ledger scoped to this object. See the Work ledger chapter.
- **Fixes**: the fix batches of this object. "No fix batches for Material master yet. A batch starts when a steward accepts suggested values or imports a filled fix sheet."
- **Runs**: the measured score over the last eight runs with the cap line and the baseline, a table of measured and shown scores per run ("Scores are as stored with each run; the measured score is before the cap, the shown score after it."), **Compare with** to open two runs side by side, and **Why the score moved** against the baseline: rules newly failing, fixed, worse and better.
- **Readiness**: the migration waves this object belongs to with the verdict, blocking gaps, score, readiness and records blocked, and "What the failing rules do in S/4HANA": the features blocked and degraded, each with the rules behind it. **Blockers** turns that round: one row per rule of this object behind a blocked or degraded feature, with its severity, the features it holds back and its failing rows, most failing first. **Readiness by object** lists every object in the same waves with its ruler, verdict and blocking gaps, the most blocked first, with this object marked; select one to open it.
- **Lineage**: the drawing from source table to S/4 feature. Select a node to pin its facts, with its **Upstream** and **Downstream** nodes listed under them; select one of those to move to it. See the Lineage chapter.
- **Processes**, **Glossary**, **Golden records**: each has its own chapter.

## The numbers and where they come from

- **Top failing rules** are ranked by value at risk among the rules with failing rows in the run; the trend is read from each rule's own history.
- **Blockers** comes from the feature impact of the run: the failing rows of each rule that blocks or degrades a feature.
- **Readiness by object** takes the verdict and blocking gaps from the waves' readiness and the ruler from the run in the top bar.

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

- **"... has no object called ..."**: the address names an object Meridian does not know; the page says so instead of showing a real-looking page. Open the landscape and choose an object from the map. A record key that is not in the latest run says so the same way.
- **"No run yet"** and an empty ruler: this object has never been analysed on this system. Ask SAP Basis to extract and analyse it.
- **The measured and shown scores are the same, but the receipt names a critical rule**: "A critical rule is over tolerance, but the score is already below its cap."
- **The Records tab says the ledger could not be loaded**: open Work from the link under the message; the ledger reads the latest run of each object.
- **Low confidence**: fewer than 70% of the rules attempted produced a result. The receipt row **Coverage** shows which dimension is short. SAP Basis can widen the extraction.
- **A figure looks wrong**: open its **i**. If the arithmetic there does not match, copy the diagnostics from help and send them to your administrator.
