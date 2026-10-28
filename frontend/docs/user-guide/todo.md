# To do

The To do list is the one place that says what needs a person now. It gathers failed connections, late checks, rules that started failing, work waiting for approval, overdue records and the admin chores that pile up, ranks them, and gives each one a single button that opens the page where it is fixed. You do not have to know which page to check: open the list and work down it.

## Where it appears

- **The flag in the index bar.** Next to the notification bell sits a flag labelled **To do**. Its badge counts the items that need a person soon: the critical and the high ones. The badge turns red when any of them is critical and is grey otherwise. It is absent while the number loads and when it is zero, so it never shows a number you may not act on. Select the flag to open the full list.
- **Your home page.** A **To do** card shows your five top items, each with its action, and **All** followed by the number opens the full list. The main button on the home page opens the top item when it is blocked work, a regression or a freshness problem; otherwise the home page keeps its usual button. When nothing waits, the card says so.
- **An object page.** A **To do** card under the header lists only the items about that object, and stays out of the way when there are none. **All** opens the list filtered to the object.
- **The [To do](/attention) page.** The whole list: severity, what needs a person, the object and system, how long it has been waiting, a count and the action.

The list is built once a minute for your organisation and filtered for you, and the page prints the time it was built. After you fix something, the item may stay a few seconds until the next build.

## How items are ranked

Items are ordered by five priority tiers, then by severity within a tier, then by how many records or things are affected, then by how long they have waited. There are no weights to tune.

1. **Blocked work.** Something stops other people working: a system that cannot connect, or fix batches waiting for approval.
2. **Data regressions.** A rule that passed now fails, or a process fits its expected flow worse than before.
3. **Freshness.** An object is stale, a schedule failed or missed its slot, a job failed, or a process needs to be mined again.
4. **Hygiene.** Overdue records, inbox items past their time, objects with a No-go verdict, configuration that is missing or has drifted, rules waiting for review and data contracts that were breached.
5. **Admin.** Access requests, invitations nobody accepted, seats running out, grants about to expire, people who have not signed in for a long time and licence reminders.

The page has two filter rows. **Priority** shows one tier. **Kind** shows one sort of item, such as **Regressions** or **Failed schedules**; it appears when more than one kind is present. The filters are part of the address, so you can share a link to a filtered list.

## What you see depends on your role and scope

Every item needs a particular permission to act on, and you see an item only when you hold that permission where the item is.

- A **data steward** sees regressions and overdue records on their own objects, and work they can fix.
- A **data owner** or approver sees the approvals waiting for them.
- A **programme lead** or **analyst** sees data items across everything they may reach, and the checks they can re-run.
- **SAP Basis** sees failed connections, failed or missed schedules, missing configuration and failed process discovery.
- A **process analyst** sees process items: fitness drops, stale discovery and failed runs.
- Admin items, such as access requests and seats, need the permission to manage users across the whole organisation.
- A **viewer** or **auditor** sees items to read, but nothing they cannot act on.

If you hold access only to one system or one object, your list shows only that slice. An empty list says "Nothing in your scope needs a person now" and names your scope, for example "Material master on one system". If you expected an item, check that your grant covers it under [Roles and access](/docs?page=roles).

## Every item opens its fix

The button at the end of each row is the action, and it opens the exact page where the problem is solved, already filtered.

- **Review records** opens Fix work on the records that started failing since the baseline.
- **Re-check now**, **Retry** and **Open job** act on the check or the job that is late or failed.
- **Open schedules** and **Open system** go to the system's schedules or health.
- **Review approvals** opens the approvals in the Inbox.
- **Fix overdue records** opens the overdue records in Fix work.
- **Review requests**, **Review invitations**, **Open licence**, **Review grants** and **Review users** open the matching admin page.

A row also opens when you select anywhere on it. Every item has exactly one button, and an item you have no permission to act on is not in your list.

## What leaves the list

An item disappears when its cause is gone: the connection works, the check ran, the rule passes, the batch was approved. A paused schedule never creates an item, because a pause is a decision. Items you cannot act on are never hidden behind a count; they are not in your list at all.

## Related

- [Monitoring](/docs?page=monitoring)
- [Fix work](/docs?page=fix)
- [Inbox](/docs?page=inbox)
- [Roles and access](/docs?page=roles)
