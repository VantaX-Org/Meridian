# People and inbox

**People** lists the owners and stewards with their open work, approvals waiting, overdue records and SLA, and is where work is balanced, contracts are read and out of office is set. The **inbox** holds what Meridian tells you: approvals, SLA warnings, breaches, finished runs, mentions and digests. Open People from the map, with `g` then `p`, or at `/people`. Open the inbox from **Inbox** and its count in the top bar.

## People

The sentence sums the team up, for example "4 of 6 people hold open work: 270 records, 34 overdue. 2 batches wait for your approval." and "Counts are read from the work assigned in the latest state."

The table: person and role, objects (owned or stewarded), open work, approvals waiting, overdue, **SLA met**, breaches this month and last action. Your own row reads "you".

Above it: **Triage and SLA**, **Balance work**, **Data contracts** and **Out of office**.

### The person inspector

Open a person for their facts (role, objects, open work, approvals waiting, overdue, SLA met, the SLA, breaches this month, last action), **Their objects**, **Open work by object**, what waits for their approval, **Open their work**, **Reassign…** and **Activity**: their own audit trail. Your own activity is always visible to you; another person's needs view audit or manage users.

### Balance work

"An assignment plan, applied with undo." Choose how to balance:

- **Even counts**: "Every person ends within one record of the others."
- **Whole objects**: "A person keeps all of one object's records together."
- **By the assignment template**: "Each record goes to the steward named for its object and plant, company code or organisation."

**Propose a plan** shows the moves before and after. Applying moves the records; the notice that follows has **Undo**. Balancing needs the assign permission.

### Data contracts

"What each consumer is promised." Each contract names a producer object, a consumer and a promise, such as "Score at 85 or more", with its compliance (**Breached** or met), when it was last checked, its **Versions** and **Breaches**. Owners and rule maintainers create drafts with **New contract**; a data owner approves a contract, never their own; **Revise as a new version** starts the next version as a draft.

### Out of office

"Your approvals, SLA breaches, mentions and assigned work are copied to them between these days. Four eyes still holds: nobody approves their own batch." Choose who covers, the first and last day and an optional reason, then **Set out of office**. **You cover for** lists whom you deputise for, with **End it**.

### Triage and SLA

SLA days to resolve by severity (by default critical 1 day, high 3, medium 7, low 14), when to escalate, and the **Escalation chain**: "After a breach the assignee and the team lead hear first. Each level below notifies once more when an item stays past due that long." Changing SLA days and the chain needs the manage triage permission; anyone can choose their own digest here.

## The numbers and where they come from

- **Open work** counts the records assigned to the person in the latest state of the work list.
- **Overdue** counts their open records past the due date their SLA gives them.
- **SLA met** is the share of their open work still within its SLA days; a dash means they hold no open work.
- **Breaches this month** counts the records that passed their SLA this calendar month.
- **Approvals waiting** counts the batches waiting for that person to approve.

## The inbox

The inbox panel says how many items are unread and how many mentions, groups items under **Today** and **Earlier**, and gives each one its kind, time, sentence and one action: **Approval** ("Batch B-241 waits for your approval. 328 records of Material master, ZAR 412,600 at risk."), **SLA at risk**, **SLA breached**, **Notice** (a finished run), **Data quality** (a rule that rose), **Exception**, **Digest**, **Report**, **Monitor**, **Cleaning**. **Mark read** and **Mark all read** clear them. **Notification settings** opens your preferences.

Comments with an `@` mention of you count as unread mentions until you open them.

## What you can do, by role

- **Everyone**: read the inbox, set out of office, choose a digest, read People and contracts, see their own activity.
- **Programme lead and steward with assign**: balance work, reassign a person's work.
- **Data owner**: approve contracts, receive escalations, set a deputy for approvals.
- **Administrator and triage managers**: SLA days and the escalation chain.
- **Auditor**: a person's activity trail.

## Keyboard

- `g` then `p` opens People.
- In the inbox and the People table, `j` and `k` move and `Enter` opens.
- `Esc` closes the panel.

## When something is wrong

- **SLA met shows a dash**: the person has no open work to measure.
- **"Reassigning needs the assign permission, which your role does not hold."** Ask your lead.
- **A deputy cannot approve**: the deputy needs the approve permission themselves, and cannot approve a batch they built.
- **You hear about too much or too little**: Preferences, What you hear about, and per object or rule the **Watch** button.
