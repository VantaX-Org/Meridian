# Home

Home answers one question: how healthy is your SAP data, and what should you do next? Every role lands on its own version of the page, built from the same scores, so a data lead, a steward and an SAP Basis administrator each see the work that is theirs first.

## Which home you land on

Select **Home** in the index bar, or open `/home`, and Meridian sends you to the home for your role:

- `/home/lead` for programme leads, platform admins, managers, admins, analysts, auditors, AI reviewers and viewers.
- `/home/steward` for data stewards, data owners, stewards and approvers.
- `/home/basis` for SAP Basis and integration administrators.
- `/home/process` for process analysts.

On the lead, steward and Basis homes, the **View as** menu in the page header switches between **Data lead**, **Steward**, **Basis** and **Process owner**. Switching only changes the layout you see. It does not change what you are allowed to do.

## What you see

The lead, steward and Basis homes share one layout, from top to bottom.

### The page header

The header reads **Home**, followed by a line that says what the numbers belong to. Without a run in the address it reads, for example, "Current state of 12 objects, latest run 16 Oct 2026". In the current state, each object is shown at the latest finished run of its own system or upload, so one stale object never hides another's progress. When the address pins one run with `?run=`, the line names that run instead.

On the right of the header:

- **Run analysis** opens a panel where you choose a system and its objects, then extract and analyse them. You see it only if your role can start extractions.
- **View as** switches the persona, as described above.
- The export menu offers **Executive report, latest run (PDF)**, or **Executive report (PDF)** when a run is pinned. On the steward home it also offers **My failing records (Excel)**. You see the menu only if your role can export.

### The score and the verdict

The large ruler on the left is the data quality score (DQS) of everything in scope. Beside it is the change since the run before. Without a pinned run the change is labelled "vs before the latest run". On the first run of an object there is nothing to compare with, so it says "First run of" and names the object instead.

Under the score is the verdict sentence, such as "3 of 12 objects are not ready for go-live." or "All 12 objects are ready for go-live." Under that is one button with the next action for your role:

- Data lead: **Open objects not ready**, or **Open objects** when none are failing.
- Steward: **Open worst object**.
- Basis: **Open failed system** when an active system is failing, else **Open systems**.

### The cap

A critical rule that fails beyond its tolerance caps the score. One such rule caps it at 85. Two or more cap it at 70. When a cap applies, a line under the verdict names it, for example "Capped at 70 by 3 critical rules: `MM003`, `BP014` and 1 more". Each rule ID is a link to that rule's failing records. When only some objects are capped, the line reads "2 of 12 objects capped by critical rules" instead. Fix the named rules to lift the cap.

### The object map and dimensions

To the right of the score is the object map. It shows one tile per object. A tile's size is the object's record count, its colour is the verdict (green for Go, amber for At risk, red for No-go), and its number is the score. Select a tile to open that object.

Under the map, **Dimensions** shows the six quality dimensions as bars. Select a bar to open the objects list filtered to that dimension.

### The four sentences

Under the score sheet is a row of four short sentences:

- **Situation**: the score now, with the number of findings and records affected.
- **What changed**: the movement since the previous run, such as "Up 2.4 points", and how many objects moved.
- **Why it matters**: how many critical findings are capping the score, and the cost at risk when your administrator has set a cost model.
- **Do next**: the object to start with, with an **Open object** button.

Each sentence is a link to the page behind it. When AI is enabled for your installation, a written summary replaces the four sentences, so the same facts are never shown twice. You can rate the summary to send feedback.

### What moves the score

The ledger **What moves the score** lists up to eight objects, ranked by records affected. On the steward home it lists only objects with failing checks. The columns are:

- **Object**
- **Blocking rule**: the rule holding the object back, with its description. Select the rule ID to open its failing records.
- **Records affected**
- **DQS**
- **Verdict**: Go, At risk or No-go, or Not analysed.
- An action link: **Fix** when a correction can be proposed for the blocking rule's records, else **Open**.

Select a row to open the object. The link under the table, **All 12 objects**, opens the full objects list. The Basis home has no ledger.

### Your work row

A row of figures shows the work for your role. Each figure is a link.

- Data lead: **Objects not ready**, **Blocking findings** (failing critical and high checks) and **Open inbox**.
- Steward: **Open inbox**, **Cleaning proposals** and **Worst object**.
- Basis: **Systems unhealthy**, **Configuration missing** and **Jobs running**. Selecting **Jobs running** opens the jobs tray.

### Trend and heatmap

**Score over runs** draws the score across runs. Select a point to open that run. The trend starts with the second run. **Dimensions by object** is a grid of the worst objects against the six dimensions, each cell printing its score. Select a cell to open that object's rules for that dimension. The Basis home shows the trend but not the heatmap.

### Basis lists

The Basis home ends with two more lists. **Systems** shows each system's health (Healthy, Degraded, Unreachable, Sign-in refused, Not tested or Inactive) and when it was last extracted. **Jobs running** lists live jobs with their progress. These lists show even before the first run has finished.

## The process home

The process home at `/home/process` is built for process discovery. Its header names the system and the number of processes, with a system picker on the right. Two figures show **Processes discovered** and **Median fitness**. The **Processes** table lists each process with its coverage, fitness, variants, cases and last run, and a **Run discovery** button where your role allows it. **Latest runs** lists the most recent discovery runs. See [Process](/docs?page=process).

## How to get set up on day one

Until a run has finished, Home shows **Get to your first score** in place of the score. It reads "No analysis yet. Connect a system and run the first extraction." and draws four stations: **System connected**, **Configuration loaded**, **Data extracted** and **First score**. Under the stations is the one step to take now, with its button:

1. **Connect a system**: add an SAP system, or import a file if you have an export.
2. **Load configuration**: tells rules which checks apply to this system.
3. **Run an extraction**: creates the first run and starts analysis.
4. **Analysis is running**: the score appears when it finishes. If the run fails, the step reads **The last run failed** and links to the run.

If your role cannot take a step, the step says "Ask an administrator to" followed by the step, and has no button.

### The setup checklist

People who can manage systems also see a compact **Get set up** row with a count such as "2 of 5 done". It names the next two open items and links to each:

- **Connect a system**
- **Complete a first run**
- **Create a first fix batch**
- **Invite your team**
- **Set an alert channel**

Each item ticks itself when the work is done. An item you cannot see the data for is left out rather than shown as undone. Select **Dismiss** to hide the row.

The same row offers a first-run tour: "New here? A short tour shows where things are", with **Take the tour** and **Not now**. You can start a tour later from the help menu (?) with **Tour this page**.

## Good to know

- Every number on Home is a link to the records or list behind it.
- Without `?run=`, Home shows the current state. A link that carries `?run=` pins one run, and the header names it.
- A user limited to certain modules sees only those objects, scores and counts.
- "The trend starts with the second run" means only one run has been scored so far.
- If the page cannot load, it shows an error with a retry button. Your data is not affected.

## Related

- [Objects](/docs?page=objects)
- [Runs](/docs?page=runs)
- [Systems](/docs?page=systems)
- [Insights](/docs?page=insights)
- [Roles](/docs?page=roles)
- [Concepts](/docs?page=concepts)
