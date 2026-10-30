# Run and Compare

The **run canvas** shows one run: what it scored, object by object, and the jobs that made it. **Compare** puts two runs side by side and explains why each score moved. Open a run from the timeline or the Runs table (`/run/{id}`); open a comparison with **Compare with** on a run or an object's Runs tab (`/run/{earlier}/vs/{later}`).

## One run

- **The title**: "Run 16 Oct 2026, 05:17" and the system.
- **The facts line**: the system, records checked, rules measured, scoring time and trigger, for example "ECC production, 400,662 records checked, 794 rules measured, scored in 11 m 42 s, trigger scheduled".
- **The sentence**: "15 objects scored: 2 go, 2 at risk, 11 no-go."
- **Actions**: **Show scores from this run** (sets the run in the top bar so every canvas reads it), **Pin as baseline**, **Archive the 8 older runs**, **Download report**, **Compare with**.
- **By object**: "Measured score, then the score shown after the cap". Each object with its measured score, shown score (with **capped**), verdict, records checked, rules and open work.
- **Jobs**: "The extraction and analysis that made this run", with state, start and duration.

## Compare

The title names both runs, for example "Run 16 Oct 2026, 05:17 vs baseline 2 Oct 2026". The sentence sums it up: "12 of 15 objects scored higher and 3 lower. 14 rules started failing and 37 stopped. 12 objects are still capped by a critical rule, so the shown score hides part of it."

The method is stated under it, exactly as the product states it: "Rules are compared on the common set: the 5167 rules that ran cleanly in both runs. 11 rules added since the baseline of 2 Oct 2026 are excluded. A rule counts as changed when it flips between failing no records and some, or fails at least 10% and 10 records more or fewer. Coverage is the share of records a rule could evaluate."

- **By object**: measured before and after, the change in points, shown before and after, records checked, coverage, and the counts of rules new, fixed, worse and better. The total row adds them.
- **What changed**: "Rule counts match the table above." Four lists: **Newly failing rules**, **Fixed rules**, **Worse** and **Better**, each rule with its object and its failing records before and after, for example "MM201 Base unit of measure not in the check table, Material master, 0 to 316 records failing".

On an object's Runs tab the same comparison appears as **Why the score moved**, and ends with what the cap did, for example "The shown score moved only 69.8 to 70.0, because the cap holds it at 70.0."

## The numbers and where they come from

- Measured and shown scores are as stored with each run; nothing is recomputed when rules change later.
- Only the common set of rules is compared, so a rule added later never shows as "newly failing".
- The change threshold (10% and 10 records) stops noise from counting as a change.

## What you can do, by role

- **Everyone**: open runs, compare any two, export the tables.
- **Anyone with analyse** (programme lead, analyst, SAP Basis, admin): pin the baseline, archive older runs.
- **Anyone with export**: download the run's report.

## Keyboard

- `j` and `k` move through the tables, `Enter` opens an object or rule.
- `g` then `r` returns to Runs.

## When something is wrong

- **The shown score did not move although many records were fixed**: the cap holds it. Read the measured score, and fix the critical rules over tolerance to release it.
- **A comparison says few rules were compared**: one of the runs ran fewer rules cleanly (a failed extraction or a narrower scope). Compare runs of the same scope.
- **Pin as baseline or Archive is missing**: changing a run needs the analyse permission; archived runs stay readable from **Show archived runs** on Runs.
- **"This run could not be read. It may belong to another tenant or have been removed."** Check the link, or open the run from the Runs table.
