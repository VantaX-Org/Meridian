# Inbox

The inbox is the steward's queue: every open decision that needs a person, with the task closest to breaching its service level first. Stewards, data owners and leads work from it every day.

Open it from the **Inbox** pill in the index bar. The pill shows a live count of open work.

## What you see

The page header reads **Inbox**, with a count such as "42 open, 3 overdue". Under the title are five tabs:

- **Tasks**: stewardship tasks such as merge decisions, golden record reviews, write-back approvals, glossary reviews and value mapping matches.
- **Exceptions**: exceptions raised by exception rules on new findings.
- **Issues**: one row per failing SAP record, tracked across runs.
- **SAP monitor**: signals from live SAP, such as failed jobs and locked records.
- **Approvals**: live write-back requests waiting for a second person. You see this tab only if your role can approve.

You can link straight to the Exceptions tab as `/inbox?kind=exception`.

### Tasks

Above the list are the figures:

- **Overdue**: tasks past their due time. Select it to see only those.
- **Due today**: tasks due before midnight. Select it to see only those.
- **Tasks loaded**: shown only when the queue holds more tasks than the page loaded, for example "200 of 640".

If your role can assign work, a line underneath reads **Who holds the work across all queues**. It lists each owner with their open and breached items across every queue, not only this list, and the **Suggestion acceptance** rate: how often stewards accept the model's suggested decision.

The filter bar has view buttons, each with its count: **All open**, **Mine**, **Unassigned**, **SLA breached**, **Due today** and **Escalated**. Next to them are a **Type** list (**All types**, or one task type) and a **Search** box that matches the task id, record, object, type and assignee. When a view or type is active, a notice such as "Showing tasks due today only." offers **Show all**.

The workbench below has two panes. On the left is the ranked list. Each row shows the task type and object ("Merge decision in Business partner"), then the assignee, priority (`P1` is highest), record and age, and on the right an SLA pill such as "5h left" or "2d over". The coloured bar on each row's edge shows its SLA state: red when breached, amber when at risk. On the right is the selected task.

The task detail shows **Record**, **Object**, **Priority**, **Status**, **Assignee**, **Age**, **Raised** and **Due**. If the model has a view, it adds a line such as "Suggested decision: Approve, 92% confidence". **Open record** takes you to the record page under Objects. The buttons are **Approve**, **Reject**, **Escalate** and **Assign to me**.

### Exceptions

The **Exceptions** tab shows the **Overdue** figure and a search box. Rows are sorted by SLA deadline. Each shows the exception title, its category, status and assignee, and an SLA pill. The pill turns amber inside the last 24 hours and red once the deadline passes. The row's edge shows the exception's severity.

The detail shows **Severity**, **Status**, **Category**, **Assignee**, **Raised**, and where known **Source** and **Estimated impact**, then the description. The buttons are **Resolve**, **Escalate** and **Assign to me**.

### Issues

The **Issues** tab lists failing SAP records by rule. It shows the **Issues** count, a **Status** filter (Open, In progress, Waiting sap, Waiting requester, Accepted, Resolved, each with its count), a search box and an export of **Issues (.xlsx)**. Each row shows the rule ID and object, the record key, status, assignee, when it was last seen and an SLA pill (On track, At risk or Breached). The detail shows the message, the record and field, and the activity thread. Tick issues and select **Start work** or **Resolve** to change their status. If your role can run analyses, add a note under **Add a comment** and select **Post comment**.

### SAP monitor

The **SAP monitor** tab shows a count per category, then a table with **Signal**, **Category**, **Severity**, **Status**, **Source** and **Raised**. Select **Review** on a row to read its description.

### Approvals

The **Approvals** tab lists write-back requests with **Finding**, **Run**, **SAP host**, **Records**, **Requested by** and **Requested**. See [Fix](/docs?page=fix) for what write-back does.

## How to work a task

1. Open the **Tasks** tab and choose a view, for example **Mine** or **SLA breached**.
2. Select a task in the list, or move to it with `j` and `k`.
3. Read the detail. Select **Open record** if you need to see the record itself.
4. Select **Approve** to accept it, or **Reject** to turn it down with a reason.

What approval does depends on the task type:

- A merge decision merges the two master records. Meridian keeps the record with the higher confidence, fills its blank fields from the other, and marks the other as superseded.
- A rejected merge decision is recorded as "do not match", so the same pair is not proposed again.
- A golden record review promotes the record to golden. Rejecting it returns the record to candidate.
- An exception task resolves the exception.
- A write-back approval accepts the corrected value in Meridian, with a 72-hour window to roll it back. Nothing is written to SAP.
- A glossary review marks the term as reviewed.
- A value mapping match confirms the mapping. Rejecting it marks the mapping rejected.

Approving, rejecting and assigning need the approve permission (Admin, Manager, Steward and Approver). The AI Reviewer role cannot approve data actions.

## How to reject with a reason

1. Select the task and select **Reject**, or press `x`.
2. In the **Reject with reason** panel, type why in **Reason**. The button stays unavailable until you do.
3. Select **Reject**, or **Keep task open** to back out.

Meridian records your reason on the task and sends it back as feedback on the model's suggestion.

## How to act on several tasks

1. Tick the box on each row. A bar appears above the list with the number selected.
2. Choose **Approve**, **Reject with reason**, **Escalate** or **Assign to me**.

Bulk approval only approves tasks whose suggestion is at 85% confidence or higher, and only tasks that are still open or in progress. Meridian tells you how many it left for you to decide one at a time.

## How to assign and escalate

- **Assign to me** makes you the owner. It shows on a task only while it is unassigned.
- **Escalate** sets the task's status to Escalated and raises its priority by one step. Anyone who can open the inbox can escalate.
- On an exception, **Escalate** moves it up one tier and sets a new, shorter deadline. The button is unavailable once the exception already carries an escalation tier.

## How to resolve exceptions

1. Open the **Exceptions** tab and select an exception.
2. Select **Resolve**, or press `r`.
3. In the **Resolve exception** panel, write your notes in **Reason** and select **Resolve**. **Keep open** backs out.

To resolve several at once, tick them and select **Resolve with notes**. Resolving needs the approve permission. **Assign to me** on exceptions needs the assign permission (Admin, Manager and Steward).

## How to manage exception rules

Exception rules decide which new findings raise an exception. If your role can manage rules (Admin and Steward), the Exceptions tab shows **Manage exception rules**.

1. Select **Manage exception rules**. The **Exception rules** panel lists each rule with its object type and rule type.
2. Select **Disable** or **Enable** to switch a rule off or on.
3. To add one, fill in **Name**, **Rule type**, **Object type** and **Condition** under **New rule**, then select **Create rule**. Name and condition are required.

## Service levels and escalation

Each task has a due time, either set directly or worked out from its SLA hours after it was raised. A task without either shows "no SLA". A task is at risk once less than half of its window remains, and breached once the due time passes.

Meridian checks SLAs in the background. Each item sends at most one notification for each event: at risk, not acknowledged in time, and breached. When an item is not acknowledged in time or breaches, the notification also goes to the team lead, or to the fallback owner if the team has no lead. Teams, assignment rules, business hours and SLA policies are set in **Settings**, **Triage** (see [Administration](/docs?page=admin)).

## Keyboard use

The inbox works without a mouse. The keys do nothing while you are typing in a box.

- `j` and `k` move to the next or previous item.
- `Enter` opens the record behind the task.
- `a` assigns the item to you.
- `r` resolves the task by approving it. On an exception it opens the resolve panel.
- `x` rejects the task with a reason.
- `Escape` closes the open panel.

Press `?` to see every shortcut. In the inbox, the Inbox group is listed first. See [Keyboard shortcuts](/docs?page=shortcuts).

## Notifications

The bell in the index bar shows a badge with your unread count. It refreshes every minute and when a job finishes.

1. Select the bell to see your ten latest notifications. Each has a type, its age and a title.
2. Select a notification to mark it read and open the page it points to.
3. Select **Mark all read** to clear the badge, or **Open all** to go to the full list.

The full list at [/inbox/notifications](/inbox/notifications) has a **Type** filter, an **Unread only** switch and **Mark all read**. It loads 50 at a time; select **Show more** for the next 50. Types include Finding, Cleaning, Exception, Approval, Digest, Quality alert, Rule proposal, SLA at risk, SLA not acknowledged and SLA breached.

Where notifications are also sent outside Meridian, such as email or chat channels, is set in **Settings**, **Notifications**.

## Good to know

- "Inbox is clear" means no open tasks exist. Tasks arrive when findings are assigned or proposals need review.
- "No tasks in this view" means the current view or type hides them. Select **Show all**.
- "No exceptions" means no exception rule has fired yet.
- The list refreshes every minute. It loads up to 200 tasks per status.
- If an action fails, the list puts the task back and a red notice explains why.
- Without the manage users permission, assignees show as "You" or a short id.
- Notifications only ever link to pages inside Meridian.
- "You are all caught up" on the notifications page means you have no notifications. "No notifications match" means the filters hide them; select **Clear filters**.

## Related

- [Fix](/docs?page=fix)
- [Master data](/docs?page=mdm)
- [Roles and permissions](/docs?page=roles)
- [Keyboard shortcuts](/docs?page=shortcuts)
- [Administration](/docs?page=admin)
