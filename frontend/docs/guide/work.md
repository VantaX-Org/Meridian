# The Work ledger

Work is the one list of everything that needs a person: every failing record and field, with its current value, the values the rule accepts, a suggested value, a New value cell and the decision, on one row. The row is the fix. Open it from **Work** at the top of the map, with `g` then `w`, or at `/work`. On an object, the **Records** tab is the same ledger scoped to that object.

## What is on it

- **The title and scope**: "Work" and the objects in scope, such as "All objects". Click an object in the map to scope the ledger to it.
- **The sentence**: what the current filter holds, for example "25,712 records to fix, ranked by value at risk." and, under it, "Rows are read from the latest run of each object. Value at risk is from cost model ZAR."
- **The state chips**: **To fix**, **Fix proposed**, **Waiting for approval** and **Exceptions**, each with its count. The chips are the filter.
- **The Policy chip**: narrows the ledger to the records failing a rule that evidences an applied policy pack or one of its classes, for example "Policy: Vendor bank data (SOX financial controls)" (`policy=sox:vendor_bank`).
- **The controls**: **Flat** or **By rule** grouping; **Sort** by value at risk, due, age or owner; **Compact** or **Standard** rows; **Views** (saved and shared views); the object filter; **Export fix sheet** (`e`) and **Import filled sheet**.
- **The rows**: by default the record key (for example Material number and Plant), name, rule, severity, **Current value**, **Suggested value**, **New value** and **Decision** beside the rule, then SAP field (`MARA-MEINS`, written TABLE-FIELD as in SAP), problem, owner and value at risk with its **est.** marker. The field description, possible values, first seen and days open are in **Columns**. Numeric record keys show as SAP shows them (`100` for `000000000000000100`), the full key on hover.
- **The fix-order hint**: where an upstream object still fails, a line says so first, for example "Fix Material master first: 3,640 upstream failures. Records there fail before this object can pass."

**As of run** reads the ledger as it stood when an earlier run finished: each object at its newest run up to then. A band says "As it stood at run 2 Oct 2026, 05:09; statuses are today's." with **Back to today**. Grouping by rule and the fix sheet read today's rows only, so they are off while a policy or a past run narrows the ledger.

The ledger loads 100 rows at a time ("Showing 100 of 25,712. Sorted by value at risk within the rows loaded.") with **Show 100 more**.

## The numbers and where they come from

- **The chip counts** are distinct records in each state in the latest run of each object in scope, whatever the rows loaded.
- **Value at risk** is the cost-model estimate of what the failing value costs, in the tenant currency, marked **est.** (or **default estimate** while the shipped assumptions are in use).
- **Possible values** are the values the rule accepts; open the row for the full list with meanings.
- **Suggested value** is the value the rules propose. "Blank when no single value is right."
- **Days open** counts from the day the oldest failing issue of the row was first seen.

## Editing a row

Type in **New value** and press `Enter`; until you do the cell reads "Not saved yet: press Enter". Or choose a **Decision**: **fix** (accept the suggested or entered value), **not an issue** or **accept risk**. A record in the inspector shows every failing field with the same cells, plus its facts, feature impact, provenance and history. Its **History** tab lists every run that measured the record with the values of its failing fields in that run, then every decision on it in order, with who and when, each linked to its run. On a phone, editing happens in the inspector.

Every change shows a notice at the bottom of the screen, such as "Accepted 1 suggested value", with **Undo**. `⌘Z` takes the last change back while focus is not in a field: "Undone: accepted 1 suggested value". The chip counts move at once.

## Working in bulk

- **More than 25 rows at once**: a change of more than 25 rows, from a key (`a`, `n`, `r`) or an **Accept all** button, waits on a confirmation bar with the count, for example "Accept 112 suggested values for MM142? Enter confirms, Escape keeps the rows as they are."
- **Select rows** with the checkboxes, `x`, or `Shift+J` and `Shift+K` to extend. The bulk bar offers **Value for all selected rows**, accept the suggested values, not an issue, accept risk and **Assign…**.
- **Fill down**: select the rows, then press `⌘D` in the New value you want to copy: "Filled EA down 12 rows".
- **Paste a column** of values from Excel into a New value cell to fill the selected rows.
- **Accept all suggested** in a rule group, or the next-step button "Accept the 112 suggested values".
- **By rule** groups the rows to fix under their rule, so you can decide a whole rule at once.

Accepted and entered values go into your draft fix batch. They wait there for a second person: see the Approvals and exceptions chapter.

## Export and import

**Export fix sheet** (`e`) saves the rows on screen as an Excel sheet with the same columns, in business words. Fill in New value and the decision offline, then use **Import filled sheet**: "Drop the filled fix sheet here, or choose a file (.xlsx). Meridian checks keys, SAP fields and values before anything changes." The result lists what was accepted and what was refused, row by row.

**Share and export**, above every grid, also offers **Export to Excel** (the visible columns, as a branded workbook), **Save these columns as a view** (shared with everyone if you choose) and **Share this page as a link** (read-only, for people of your tenant, until it expires).

## What you can do, by role

- **Data steward** (apply): edit values, accept suggestions, bulk actions, import, assign to yourself.
- **Data owner** (approve): sign records off as not an issue or accept risk, approve batches.
- **Programme lead** (assign): assign rows, balance work from People.
- **Auditor, viewer, analyst**: read and export; the ledger says "Read-only for your role".

## Keyboard

- `j` or `↓`, `k` or `↑` move; `Shift+J` and `Shift+K` extend the selection; `x` selects; `Enter` opens the row.
- `a` accepts the suggested value on the selected rows; `n` marks them not an issue; `r` accepts the risk.
- `e` exports the fix sheet of what is on screen; `f` moves to the filter chips.
- `⌘D` fills down; `⌘Z` undoes; `[` and `]` step through rows in the inspector.

## When something is wrong

- **"Sandbox mode is on: decisions apply to the sandbox run only."**: the tenant is in sandbox mode and the row belongs to the real run. Exit the sandbox under Administration, Settings, or decide on the sandbox copy.

- **"The work list of the latest run is not built yet, so no rows can be listed. It is built after each run finishes."** Wait for the analysis to finish, or ask whoever started it.
- **"No rows in this view."** The filters exclude everything. **Reset to the default view** from Views.
- **"Select rows first: x selects the highlighted row, Shift+J extends the selection."** A bulk key was pressed with nothing selected.
- **"The file could not be read as a fix sheet."** Export a fresh sheet and keep its columns and key fields unchanged.
- **A value you typed is refused**: it still fails the rule. Pick one of the possible values.
- **A record you fixed is back in To fix**: the next run still found it failing after it was sent to SAP. Check the load reached the right client, then decide again.
