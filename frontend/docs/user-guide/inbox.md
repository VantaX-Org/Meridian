# Inbox

The inbox holds the decisions that need a person but are not a record to clean: merge decisions, golden record reviews, glossary reviews, value mapping matches, business exceptions, live SAP signals and write-back requests. Fix work is where you clean failing records; the inbox is where you answer everything else, closest to its deadline first.

Open it with the **Inbox** pill. The pill shows the number of open stewardship tasks.

## The tabs

The page reads **Inbox** and has five tabs, each with a line that says what it holds:

- **Tasks**: fixes and matches waiting for a steward. Claim one, check it, then approve or reject it.
- **Exceptions**: business exceptions raised by your exception rules. Assign, escalate or resolve each one.
- **Issues**: each row is one SAP record that fails a rule. Claim it, fix it in SAP, then mark it resolved.
- **SAP monitor**: live signals from SAP, such as failed jobs and locked records.
- **Approvals**: changes to SAP that wait for a second person. Approve the ones you did not request.

You can link straight to exceptions as `/inbox?kind=exception`; it is also listed as **Inbox**, **Exceptions** for roles that approve or assign.

## Tasks

The **When** filter shows how many tasks are **Overdue** and **Due in 24 hours**. When the queue holds more than the page loaded, a notice says how many are loaded. To see who holds the work across all queues, open **Insights › Operate**.

Filter the list with:

- **Who**: **Everyone**, **Mine** or **Unassigned**, each with its count.
- **When**: **Any time**, **Overdue**, **Due in 24 hours** or **Escalated**.
- **Type**: one task type, or **All types**.
- **Priority**, when the tasks differ. Priority 1 is the highest.
- **Search**: the task, record, object, type or assignee.

The list is on the left, with an SLA pill on each row such as "Due in 5h" or "2d overdue". The selected task is on the right: the record, object, priority, status, assignee, age and due time, any suggested decision with its confidence, and **Open record**.

### How to work a task

1. Pick a view, for example **Mine**, or **Overdue** under **When**.
2. Select a task, or move with `j` and `k`.
3. Read the detail, and select **Open record** if you need the record itself.
4. Select **Approve**, or **Reject** and write why in **Reason**. **Keep task open** backs out. The reason is kept on the task and helps Meridian suggest better next time.
5. **Claim** makes the task yours. **Escalate** raises its priority and marks it escalated.

What approval does depends on the type: a merge decision merges the two master records, a golden record review promotes the record, a glossary review marks the term reviewed, and a value mapping match confirms the mapping. A rejected merge is recorded as "do not match" and not proposed again.

To act on several, tick them and choose **Claim**, **Approve**, **Reject with reason** or **Escalate**. Approving and rejecting need the approve permission.

## Exceptions

Exceptions are sorted by deadline. Each shows its title, category, status, assignee and severity. Select one to read its source and estimated impact, then **Resolve** (with notes on what was done), **Claim** or **Escalate**. Escalating moves it up one tier with a shorter deadline. Tick several to **Claim**, **Escalate** or **Resolve with notes** together. Roles that manage rules see **Manage exception rules**, where each rule is switched on or off and new ones are added.

## Issues

The **Issues** tab tracks each failing SAP record by rule across runs, for work done straight in SAP. Filter by **Who**, **When**, **Status**, **Severity** and **Search** (a record key), and export **Issues (.xlsx)**. The detail shows the message, the record and field, and the activity thread, with **Add a comment**. Tick issues to **Claim**, **Release**, **Reassign to** a colleague, **Start work** or mark them **Fixed in SAP**. For records you can correct in Meridian, Fix work is the faster route.

## SAP monitor and approvals

**SAP monitor** lists signals by category, severity, status, source and time raised; select **Review** to read one. **Approvals** lists live write-back requests with the records, who requested them and when. You cannot approve a request you made. When live write-back is off for the deployment, the tab says so: export fixes from a batch and load them in SAP instead (see [Approvals and export](/docs?page=approvals)).

## Service levels

Each item has a due time, set directly or worked out from its SLA hours. It is at risk once less than half its window remains and overdue once the time passes. Meridian sends one notification for each event (at risk, not acknowledged, breached), and copies the team lead on the last two. Teams and SLA policies are set under **Settings**, **Triage** (see [Administration](/docs?page=admin)).

## Keys and notifications

On the list, `j` and `k` move, `Enter` opens the record, `a` claims the item, `r` approves (or opens resolve on an exception), `x` rejects with a reason, and `Escape` closes the panel. The bell in the index bar shows your unread notifications; **Open all** goes to the full list at [/inbox/notifications](/inbox/notifications).

## Related

- [Fix work](/docs?page=fix)
- [Master data](/docs?page=mdm)
- [Keyboard shortcuts and search](/docs?page=shortcuts)
- [Administration](/docs?page=admin)
