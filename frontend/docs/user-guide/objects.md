# Objects

An object is one area of SAP data Meridian scores as a whole, such as Business partner, Material master or an FI general ledger. The Objects pages show which objects are ready, what holds each one back, and every record that fails. Stewards use them to work one object at a time; leads use them to see readiness.

Open **Objects** with its pill in the index bar.

## The objects list

The header reads **Objects**, followed by what the list belongs to. With **Latest run** chosen in the scope bar, the list is the current state: each object at the newest finished run of its own system or upload, for example "Current state of 12 objects, latest run 16 Oct 2026". With an older run chosen, it is that run's objects, and the header names the run.

At the top is the object map: one tile per object, sized by records affected, coloured by verdict, with the score on it. Under it are the figures **Go**, **At risk** and **No-go** (select one to filter the list), **Failing rules** and **Critical and high failing rules**. Filter chips for **View**, **Freshness**, **Readiness**, **Dimension** and **Owner** narrow the map and the table together.

The table lists each object with:

- **Blocking rule**: the rule holding the object back, with its description.
- **Records**: records affected.
- **To fix**, **Critical**, **With a suggestion** and **Overdue**: the object's open work from the run's work list. Each number opens the object's records to fix with that filter.
- **Score** and **Verdict**: the score on its ruler, and Go, At risk or No-go.
- **Freshness**: a pill that says whether the object has been checked as often as its cadence promises. See [Monitoring](/docs?page=monitoring).

Choose **Monitoring** under **View** (or open `/objects?view=monitoring`) to swap the work columns for **Checked**, **Cadence**, **Freshness** and **Change** beside the score and verdict. **Change** is the number of newly failing rules since the baseline, with the records in a tooltip. Use the **Freshness** chips to list only the stale, failed or manual objects.

Select a row, or **Open**, to open the object on its **Records to fix** tab, worst record first. The export menu offers the objects as Excel and the analysis report as PDF.

## The object page

The header shows the object's name, its score and verdict, the run it belongs to, the failing checks and records affected, the **Owner** and **Steward** pickers and the export menu. A line under it reads "Records of" the object "that fail a check in this run, worst first. Pick one and fix it."

Under it sits the object's monitor, a row of tiles: **Checked**, **Cadence**, **Next check**, **Freshness**, **Baseline** and what changed since the baseline. **Re-check now** starts a new check of the object, and **Pin this run as baseline** makes this run the reference for later comparisons. The tiles are explained in [Monitoring](/docs?page=monitoring).

If anything about this object needs a person, a **To do** card follows, with the item and its button; it is absent when nothing waits. See [To do](/docs?page=todo).

A strip of figures then counts the object's work: **Records to fix**, **Critical records**, **With a suggested value** and **Overdue records**. Each opens the records to fix with that filter. On the **Records to fix** tab the queue's own tiles say the same, so the strip steps aside.

The tabs are **Records to fix**, **Overview**, **Rules**, **Fields**, **Records by rule**, then **Related**, **History** and **Audit**. Press `1` to `5` to jump between the first five.

## Records to fix

Every object opens here. It is the object's own slice of [Fix work](/docs?page=fix): the same records, statuses and record panel, for this object only.

1. Narrow the list with **Search by name or key**, the **Issue** list (**All issues**, or one rule with its open count), the **Severity** chips, **Status**, and the **Show** chips **Assigned to me**, **Has a suggestion** and **Overdue**.
2. Pick a record. Each row shows its name or key, its status, the main problem and "and N more issues", the field, its suggestions, an overdue pill and the assignee.
3. Decide in the record panel: accept the suggestion, enter a value, mark it not an issue or accept the risk, take it or release it. The decisions go into your draft fix batch, as in Fix work.
4. Press `j` and `k` to move between records, and `Enter` to open the full record. **Load more** shows the next records.

When every record passes, the tab reads **Every record passes**. If the run's work list is not built yet, a notice offers to build it; see [Troubleshooting](/docs?page=troubleshooting).

## Overview, Rules and Fields

- **Overview** starts with **Processes this object feeds**: one tile for each business process that reads this object's fields, such as Procure to pay or Order to cash, with its verdict and how many steps this run blocks. Select a tile to open that process's data readiness for this object and run. Under it are the figures **Failing rules**, **Critical and high failing rules**, **Rule failures** and **Auto-fixable**, the list of failing rules ranked by impact, and the **Score by dimension**. Select a failing rule to read its failing records with the grain it judges at.
- **Rules** lists every rule that ran for the object, with its severity, dimension and records failing. Filter by **Severity**, **Dimension** or **Critical and high**. Select a rule to open its page, with the records, the root cause and the context of the finding.
- **Fields** profiles each table's fields: how often they are filled, their distinct values, and whether a field is masked.
- **Records by rule** lists the failing records of one rule, chosen on the Rules tab.
- **History** draws the object's score over time from the second scored run.

## The full record

**Full record** in the record panel, or `Enter` in a list, opens the record's own page at `/objects/<object>/records/<key>`. It shows whether the record passes or fails, its identity fields, every failing rule, every field it holds, and, for materials, how complete each view is and any possible duplicates. The record panel sits on the page too, so you can decide here as well. The export menu offers the record's **Fix sheet (PDF)**.

## How to assign an owner

1. In the header, choose a person under **Owner**.
2. Choose a person under **Steward**. **Not set** clears either one.

Owners appear in the **Owners** view of Insights, under **More**, **Analysis**, and receive their own digest.

## Related

- [Fix work](/docs?page=fix)
- [Key concepts](/docs?page=concepts)
- [Rules](/docs?page=rules)
- [Progress](/docs?page=progress)
