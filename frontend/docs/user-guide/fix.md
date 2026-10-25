# Fix work

Fix work is where failing records get cleaned. It lists every record that fails a check in the chosen run, worst first, says what is wrong with each one and what the value should be, and puts your decisions into a fix batch that a second person approves before anything goes to SAP. Data stewards start here every day; data owners use it to sign records off and approve batches.

Open it with the **Fix work** pill in the index bar. The page is titled **Fix** and has five tabs: **Records to fix**, **Cleaning proposals**, **Approvals and export**, **Monitor** and **Duplicates**. This chapter covers **Records to fix** and the cleaning proposals; the other tabs are in [Approvals and export](/docs?page=approvals).

## Step 1: pick the run

The list belongs to one run. Use **Run** in the scope bar: **Latest run** follows the newest finished run, or pick an older one. Your choice stays as you move to Objects, Progress and back.

If no run has finished yet the page reads **No finished run yet**. If the run has no work list, a notice reads **This run's work list is not built yet**; see [Troubleshooting](/docs?page=troubleshooting).

## Step 2: find your records

Four figures sit at the top. Each one filters the list when you select it:

- **Records to fix**: open records, with how many issues across how many objects.
- **Critical**: records with a critical issue. These block SAP processes.
- **With a suggested value**: records you can accept in one step.
- **Overdue**: records past their due date.

Under them are the filters: **Object**, **Severity**, **Status** (**Still open** by default, or one of the six statuses), the **Mine** switch for records assigned to you, the **Has a suggestion** switch, and **Find a record by key or name** (type, then press Enter). Every active filter shows as a chip; select a chip to remove it, or **Clear filters**.

The screen then has three panes:

1. **Issues**, on the left: **Every issue**, then one row per rule that fails, worst first, with its message, the number of open records, the object and field, and how many have a suggested value. Pick one to work a single problem.
2. **Records to fix**, in the middle: the records, worst first, 50 at a time (**Show 50 more**). Each row shows the name or key, the main problem and "and N more issues", the status, the number of suggested values, an **Overdue** or **Due today** pill, the assignee and the object.
3. The record panel, on the right, for the record you picked. The first record is picked for you.

## Step 3: read the record panel

The panel heads with the record's name and key, its object, how many checks it fails and its status. **Full record** opens the record's page under Objects.

For each issue it shows the message, the field and rule ID, the status, then:

- **Now**: the value the record holds. An empty value reads "blank"; a field the record lacks reads "missing".
- **Suggested**: the proposed value and where it comes from, with its confidence.
- **Decided**: a value already chosen, and the batch it waits in.
- The rule's instruction, and **Why it matters**, with what goes wrong in SAP.

At the foot are the assignee, **Add a note for the team** with **Add comment**, **History** (every status change, assignment and comment, with who and when) and **Fields the checks read**.

## Step 4: decide

On each issue, choose one:

- **Accept** the suggested value. It goes into your draft fix batch and the issue becomes **Fix proposed**.
- **Enter value**, type the right value and select **Save value**. **Keep as is** backs out. On a proposed issue the button reads **Change value**.
- **Not an issue** when the record is right as it is, or **Accept risk** when it is wrong but acceptable. Both ask for a reason, which is kept in the record's history, and both need the approve permission.
- **Undo** takes a proposed value back out of your draft. **Withdraw sign-off** reopens a record marked not an issue.

When a record has more than one suggestion, **Accept all N** at the top accepts them together. After each decision the next record comes up by itself.

## Step 5: take and release

**Take it** assigns the record to you, so colleagues see it is being worked; **Release** hands it back. Switch on **Mine** to see only your records. Taking needs the assign permission.

## Bulk actions

Tick the box on each record you want, and a bar appears with **Accept suggestions**, **Take them**, **Release**, **Not an issue** (one reason for all of them), **Undo** and **Clear**.

## A whole issue at once

Pick an issue in the **Issues** pane. Two buttons appear above its records:

- **Accept N suggested** gives every open record of the issue its suggested value, in your draft batch. Confirm with **Accept them**.
- **Set one value** gives every open record the same value. **Only records where the field is blank** is on by default, so filled values are left alone. Select **Set value**.

Either action covers up to 50,000 records. If a check failed on more than 100,000 records, the run kept the first 100,000; fix those and the next run lists the rest.

## The fix sheet round trip

To work offline or share the work with SAP experts:

1. Filter the list, then select **Download fix sheet**. You get an `.xlsx` workbook with a **Fix sheet** tab: one row per record and failing check, with **Object**, **Record**, **Name**, **Check**, **Severity**, **Issue**, **Field**, **Current value** and **Suggested value**, up to 100,000 rows.
2. Fill in **New value**, or a **Decision**: `fix` (take the suggested value), `not an issue` or `accept risk`, each sign-off with a **Reason**. Leave the other columns as they are.
3. Select **Import fix sheet** and choose the file. Meridian reports how many rows it imported and lists the rows it skipped, such as a sign-off without a reason or a record that no longer fails.

Downloading needs the export permission and importing the apply permission. A file holds at most 5,000 decisions and 25 MB.

## Keyboard

The keys work while you are not typing in a box: `j` and `k` (or the arrow keys) move, `a` accepts the record's suggestions, `t` takes it, `u` undoes, and `Enter` opens the full record.

## Cleaning proposals

The **Cleaning proposals** tab lists values the cleaning engine proposes, grouped by object and kind, with their confidence and how many are at 85% or higher. Select **Review** on a group to approve or reject each proposal, or **Accept N at 85% or higher**, then draft a fix batch from the approved ones. Approving needs the approve permission.

## Related

- [Approvals and export](/docs?page=approvals)
- [Objects](/docs?page=objects)
- [Key concepts](/docs?page=concepts)
- [Keyboard shortcuts and search](/docs?page=shortcuts)
