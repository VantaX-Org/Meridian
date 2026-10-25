# Objects

An object is one area of SAP data Meridian scores as a whole, such as Business partner, Material master or an FI general ledger. The Objects pages show which objects are ready, what holds each one back, and every record that fails. Stewards use them to work one object at a time; leads use them to see readiness.

Open **Objects** with its pill in the index bar.

## The objects list

The header reads **Objects**, followed by what the list belongs to. With **Latest run** chosen in the scope bar, the list is the current state: each object at the newest finished run of its own system or upload, for example "Current state of 12 objects, latest run 16 Oct 2026". With an older run chosen, it is that run's objects, and the header names the run.

At the top is the object map: one tile per object, sized by records affected, coloured by verdict, with the score on it. Under it are the figures **Go**, **At risk** and **Not ready** (select one to filter the list), **Failing checks** and **Blocking findings**. Filter chips for **Readiness**, **Dimension** and **Owner** narrow the map and the table together.

The table lists each object with:

- **Blocking rule**: the rule holding the object back, with its description.
- **Records**: records affected.
- **To fix**, **Critical**, **With a suggestion** and **Overdue**: the object's open work from the run's work list. Each number opens the object's records to fix with that filter.
- **DQS**: the score on its ruler, and the verdict.

Select a row, or **Open**, to open the object on its **Records to fix** tab, worst record first. The export menu offers the objects as Excel and the analysis report as PDF.

## The object page

The header shows the object's name, its score and verdict, the run it belongs to, the failing checks and records affected, the **Owner** and **Steward** pickers and the export menu. A line under it reads "Records of" the object "that fail a check in this run, worst first. Pick one and fix it."

A strip of four figures follows: **DQS**, **Records failing**, **Critical** and **With a suggestion**. Each opens the records to fix with that filter.

The tabs are **Records to fix**, **Overview**, **Rules**, **Fields**, **Records by rule**, then **Related**, **History** and **Audit**. Press `1` to `5` to jump between the first five.

## Records to fix

Every object opens here. It is the object's own slice of [Fix work](/docs?page=fix): the same records, statuses and record panel, for this object only.

1. Narrow the list with **Search by name or key**, the **Issue** list (**All issues**, or one rule with its open count), the **Severity** chips, **Status**, and the **Show** chips **Assigned to me**, **Has a suggestion** and **Overdue**.
2. Pick a record. Each row shows its name or key, its status, the main problem and "and N more issues", the field, its suggestions, an overdue pill and the assignee.
3. Decide in the record panel: accept the suggestion, enter a value, mark it not an issue or accept the risk, take it or release it. The decisions go into your draft fix batch, as in Fix work.
4. Press `j` and `k` to move between records, and `Enter` to open the full record. **Load more** shows the next records.

When every record passes, the tab reads **Every record passes**. If the run's work list is not built yet, a notice offers to build it; see [Troubleshooting](/docs?page=troubleshooting).

## Overview, Rules and Fields

- **Overview** shows **Failing checks**, **Blocking rules**, **Records affected** and **Auto-fixable**, the **Failing rules** ranked by impact, and the **Score by dimension**. Select a failing rule to read its failing records with the grain it judges at.
- **Rules** lists every rule that ran for the object, with its severity, dimension and records failing. Filter by **Severity**, **Dimension** or **Blocking only**. Select a rule to open its page, with the records, the root cause and the context of the finding.
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
