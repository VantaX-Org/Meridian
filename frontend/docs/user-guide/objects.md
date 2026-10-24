# Objects

An object is a business entity Meridian scores, such as a business partner, a material or a GL account. Objects is where you see which objects are ready, what holds each one back, and which records fail. Data leads use it to track readiness, and stewards use it to work through failing records.

## What you see

Open **Objects** from the index bar. The header reads **Objects**, followed by what the list belongs to:

- Without a run in the address, the list is the current state: each object at the latest finished run of its own system or upload. The line reads, for example, "Current state of 12 objects, latest run 16 Oct 2026".
- With `?run=` in the address, the list is that one run's objects. The line reads "As of" and names the run. When it is not the newest run, **Back to latest** returns to the current state.

The export menu on the right downloads the objects as Excel and the analysis report as PDF. Without a pinned run, both are the newest run's, and their labels say so.

### The object map

At the top is the object map. It has one tile per object in the list. A tile's size is its records affected, its colour is the verdict, and its number is the score. Large tiles also name the blocking rule. Select a tile to open the object with its blocking rule selected.

### Figures and filters

Under the map are figures for **Go**, **At risk** and **Not ready**, then **Failing checks** and **Blocking findings** (failing critical and high checks). Select a verdict figure to filter the list.

Filter chips sit under the figures:

- **Readiness**: **No-go**, **At risk** or **Go**.
- **Dimension**: the object's worst dimension, shown when the objects differ.
- **Owner**: shown when more than one owner is set.

Select a chip again to clear it. The map follows the same filters as the table.

### The objects table

The table is ranked by blocking findings, then records affected, then lowest score. The columns are:

- **Object**: the object's name and domain.
- **Blocking rule**: the rule holding the object back, with its description. Select the rule ID to open its failing records.
- **Records**: records affected.
- **DQS**: the score on its ruler.
- **Verdict**: **Go**, **At risk** or **No-go**.
- **Trend**: a sparkline of the object's recent scores, or "1 run" for its first scored run.
- **Action**: **Open**.

Select a row to open the object on its **Rules** tab. Select **Open** to open its workbench with the blocking rule selected.

### What the verdict means

The verdict compares the score with your workspace's thresholds. By default an object at 90 or above is Go and one at 75 or above is At risk. Below that it is No-go. Administrators change the thresholds and weights under Rules.

## The object page

Select an object to open `/objects/<object>`. The header shows:

- The object's name.
- The score ring and the verdict. Select the ring to open **Score breakdown**: each dimension with its weight, score and contribution, the **Rules costing the most**, and a **Score history** link.
- An **As of** line naming the run, with a picker when other runs can be shown, and the failing checks and records affected.
- **Owner** and **Steward** pickers, described below.
- The export menu, with the object as Excel and **PDF analysis**.

The tabs are **Overview**, **Rules**, **Fields**, **Records**, **Related**, **History** and **Audit**. Press `1`, `2`, `3` or `4` to jump to the first four. **History** draws the object's score over time and lists each run with its score and change, from the second scored run on. **Audit** lists every logged action on the object.

## How to work an object in the workbench

The **Overview** tab is a workbench. It opens with four figures: **Failing checks**, **Blocking rules**, **Records affected** and **Auto-fixable**, the records a fix can be proposed for automatically. Under them the page splits in two.

1. On the left, **Failing rules** lists every rule that fails for this object, ranked by records failing. Each row shows the severity, the rule ID, its name, the record count, a bar sized to that count, and the field and dimension.
2. Select a rule. It is highlighted, and the right pane shows its failing records. With no rule chosen, the blocking rule is selected, else the worst critical rule, else the worst rule.
3. The right pane names the rule and shows the records affected, the rule ID, the field, the dimension and the severity. When the records sit at more than one grain, **Grain** chips filter them.
4. Read the records table. It shows **Record**, **Grain**, **Module**, one column per field the rule read, and **Open fix sheet**. Records come 50 to a page. Press `f` to open the fix sheet of the row your cursor is on.
5. Select a record, or **Open fix sheet**, to open its record page. **Propose fix** opens the first failing record. **Rule details** opens the rule on the **Records** tab.

Under the rule list, **Score by dimension** shows the object's dimension bars. Select a bar to show only the rules of that dimension. Select it again, or **clear filter**, to show them all.

## How to read the rules

The **Rules** tab lists every rule that ran on this object, ranked by records failing. Filter with:

- **Severity**: **Critical**, **High**, **Medium** or **Low**.
- **Dimension**: shown when the rules cover more than one.
- **Show**: **Blocking only**, the critical and high rules.

The columns are **Severity**, **Rule**, **Dimension**, **Records failing**, **Pass rate**, **Trend** (the change in pass rate since the previous run) and **Open records**. Select a row to open that rule's records.

## How to read the fields

The **Fields** tab profiles each SAP table the object reads. For every field it shows the **Type**, **Blank** count and share, **Distinct** values, **Top shape** and **Top values**. Values that may be sensitive show **Masked** instead.

## The rule's records

The **Records** tab shows the failing records for one rule. Open it from any rule ID, record count or **Open records** link. Older links to `/objects/<object>/rules/<rule>` land here too.

- **Configuration context** appears when the rule checks configured values. It says how many source values are not configured in the target and lists them.
- The records card names the rule and the record count, with **Open fix sheet** and an Excel export of every failing record.
- **Root cause** shows where the failing records came from in SAP, from its change documents: **Interface / batch**, **Dialog user**, **Migration load** or **No change document**, with the user, the transaction, the records and the share. Root cause is worked out after the analysis of a live SAP download.

When no rule is chosen, the tab reads "No rule selected" and offers **Open rules**.

## The record page

A record page at `/objects/<object>/records/<key>` shows one record from one run. It is also called the fix sheet. The header shows the record key, the object, a **passing** or **failing** pill and the run it was read from. The export menu downloads **Fix sheet (PDF)**.

Every object has a record page. For a material, two figures show **Missing fields** and **Views**, and the **Overview** tab shows:

- **Identity**: the description, material type, material group and base unit.
- **View completeness**: each view with how many of its fields are maintained.
- **Findings** (the failing rules by view), **Supersession** (the supersession chain at each plant) and **Possible duplicates** (candidates with the fields they match on and a score).

For any other object, two figures show **Failing rules** and **Fields with a value**, and the **Overview** tab shows:

- **Identity**: the record's name where it has one, the SAP table it was read from and its key fields.
- **Failing rules**: each rule the record fails in this run, with its severity, its message and the field it reads. Select a rule to open it.
- **Fields**: every field of the record that has a value, as it was read in this run.

The **Related**, **History** and **Audit** tabs follow.

## How to assign an owner

1. Open the object.
2. In the header, choose a person in **Owner**, and another in **Steward** if you want one.
3. Meridian saves the choice at once and confirms it.

Choose **Not set** to clear either. Assigning needs the assign permission, which managers, stewards and administrators have. Without it, the header reads "Owner: … Steward: …" or "No owner set." The **Owner** filter on the objects list uses these assignments.

## How to drill from a number to records

Every number in Meridian is a link to what lies behind it.

1. Select a record count or rule ID anywhere: on Home, in a run's findings, or in the objects table.
2. Meridian opens the object on the **Records** tab with that rule chosen, in the same run.
3. A dimension score opens the object's **Rules** tab filtered to that dimension.

## How to export

- **Objects list**: the export menu downloads the objects as Excel and the analysis report as PDF.
- **One object**: the export menu downloads the object as Excel and **PDF analysis**.
- **One rule's records**: the export button on the records card or the workbench pane downloads every failing record as Excel.
- **One record**: **Fix sheet (PDF)**.

## Good to know

- "No objects measured yet" means no run has finished. The page offers the next setup step.
- "Material master is not in this run" means the run in the link did not measure that object. Select **Show latest run of** to open its own latest run.
- "No run has measured this object" means no finished run includes it.
- "All records pass this rule" means the rule found nothing to fix in this run.
- "Record not found in this run" on a record page means the run you are viewing does not hold that record. Choose another run in the header.
- If your access is limited to certain modules, you see only those objects.

## Related

- [Home](/docs?page=home)
- [Runs](/docs?page=runs)
- [Rules](/docs?page=rules)
- [Fix](/docs?page=fix)
- [Inbox](/docs?page=inbox)
- [Concepts](/docs?page=concepts)
