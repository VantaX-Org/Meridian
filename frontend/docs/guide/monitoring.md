# Post-clean monitoring

Cleaning a record is not the end of the job. Monitoring, under Work, shows whether records that a batch fixed stay fixed, and which rules keep pulling them back. Open it from the Monitor tab at the top of the Work ledger, or from **Open monitoring** on the **Cleaned and watched** card of the landscape and Work.

## Cleansing

The Cleansing page, under Cleansing in the map, shows what the cleaning engine did. The banner gives the records cleansed in SAP and rolled back at the latest weekly snapshot. Under it:

- **Proposals to decide.** The proposals waiting for a decision, grouped by object and fix, with the number of records, the average confidence and how many are at 85% confidence or more. Users who may approve can approve the confident ones of a group in one step, or open a group and approve or reject each proposal. A rejection needs a reason, which is kept in the audit trail and sent back to the AI as feedback. **Review the proposals** in the banner jumps here.
- **Duplicate records to merge.** Each pair of records the cleaning engine found to be the same, with the object, the fields that matched and the match score. Open a pair to compare the two records field by field, with the value the merge would keep. Users who may approve choose the record to keep, give a reason and press **Merge**; the reason is kept in the audit trail.
- **Approved, waiting to be written to SAP.** Each approved proposal with the change it makes. Users who may apply fixes press **Write to SAP**; the change then appears under the changes you can still undo.
- **Where every proposal stands.** One bar split by status: waiting for a decision, approved, cleansed in SAP, rolled back and rejected.
- **Records cleansed, week by week.** The cleansed count at each weekly snapshot. The snapshots are counts at a point in time, so the weeks are never added together.
- **Cleansed by object.** Records in SAP per object, with the share of that object's proposals.
- **Applied changes you can still undo.** Each change applied to SAP, with the fields it changed (before and after) and the deadline. Users who may apply fixes can roll a change back for 72 hours; after that the button is disabled.
- **Audit trail.** The last 25 decisions with who made them. Roles without the export permission see a dash instead.

## Data mining

The Data mining page, under Data mining in the map, shows what the mining tasks found by comparing records and values rather than by running the rules. Every list keeps each object at its latest complete run, so it is the current state. The banner counts the likely duplicate pairs and outliers, with the patterns of the last 30 days, the share of analysed objects mined and the runs mined beside it. Under it:

- **Findings by object.** Duplicate pairs and outliers per object, most first.
- **Patterns.** The outliers grouped by field and the duplicates grouped by object, with severity, how often each was found and the confidence.
- **Likely duplicates.** Each pair of records with the match score and the fields whose values are the same, each with its description.
- **Outliers.** Each value far from the rest of its field, with the usual range or how many standard deviations it sits from the average, and how it was found.
- **Fields that depend on each other.** Pairs of fields whose values move together or where one decides the other, strongest first. These are candidates for a cross-field rule.

Users who may change master data can press **Mine the latest runs** to mine the latest run of every object again. A role that cannot read the mining results sees a dash in each list.

## MDM health

The MDM health page, under MDM health in the map, shows the daily snapshot of how well master data is governed. The banner gives the health score out of 100 and its change over the last 90 days, with the golden records, the open stewardship items and the share of systems synced beside it. Under it:

- **What makes the score.** The four shares the score is built from, each with its weight and the points it adds: golden record coverage (40%), match confidence (30%), steward SLA (20%) and source consistency (10%). The points add up to the score. A small line beside each share shows its last 90 days.
- **Health score, day by day.** The score at each daily snapshot on a 0 to 100 scale.
- **Stewardship backlog, day by day.** The open stewardship items at each snapshot.

The snapshot runs once a day. Until the first one has run the page says so, and the charts need two days of snapshots before they draw a line. Viewers and process analysts see no figures.

## Record links

The Record links page, under Record links in the map, shows which records are linked across objects: a business partner and the customer it is, a material and its plants, a vendor and its company codes. Relationship discovery reads these links from the SAP link tables at each sync, and the AI impact scorer adds links it infers. The banner counts the links, with the link types in use, the objects they join and the share that was inferred rather than read from SAP. Under it:

- **Find the links of one record.** Pick an object and type a record key to see every link to and from that record. Tick **Include ended links** to see links that no longer exist in SAP.
- **Links by type.** How many links of each type, most first. The list holds the latest 200 links; when there are more, the bars cover only those, and the banner says so.
- **Links.** Each link with the record on each side, what the link means, the SAP table it was read from (or the confidence of an inferred link) and the day it was found.
- **Link types SAP defines.** The link types with the SAP tables on each side.

Roles without permission to see AI confidence see a dash instead of the confidence of an inferred link.

## Record issues

The Issues page, under Issues in the map, is the steward work list. Each issue is one record failing one rule, carried from run to run with its status, the person it is assigned to, its due date and its history. The banner counts the issues still to close, with those in progress, those waiting on SAP or on the requester, and those closed. Under it:

- **Where the issues stand.** How many issues are in each status.
- **Status buttons and filter.** Show one status or all of them, then narrow by severity, by who the issue is assigned to (you, no one or anyone) and by record key. Users with the export permission can export the list to Excel with the same filters.
- **Issues.** Each issue with the record, the rule and the field it failed on, the severity, the status, the assignee, the due date with whether it is on time, and how often it has been reopened. The list is ordered most severe first, a hundred to a page.
- **Change the selected issues.** Tick issues to move them to another status, assign them or add a note. Accepting an issue needs the approve permission and a resolution (risk accepted or false positive); a false positive needs a reason. Resolving needs the resolution fixed in the source. Other moves and assignments need the assign permission.
- **One issue.** Open a record to see the runs that found it failing or clean, and who did what to it. Users who may analyse can add a comment.

## Action centre

The Action centre, second in the map, lists everything that needs you, most urgent first: fixes waiting for your approval, systems that cannot be reached, records failing again, overdue stewardship items, failed jobs, rules waiting for review and, for administrators, access requests and expiring keys. You see only what your role can act on. The banner counts the items by severity and says when the list was last checked; it refreshes every minute. Under it:

- **Filter.** Narrow the list to one kind or one system. The choice stays in the address, so a link to it opens the same view.
- **What needs attention, by kind.** How many items of each kind.
- **Act on these.** Each item with what happened, its severity, the system and object, when it started and how many records or items it covers. The button opens the screen where you resolve it.

## Material 360

The Material 360 page, under Material 360 in the map, shows one material across every view and organisational level. Type a material number; leading zeros may be left off. The banner gives the description, the material type, group and base unit, with the rules it fails, the views missing and the plants phasing it out beside it. Under it:

- **Views by level.** A grid of the material views (basic data, sales, purchasing, MRP, storage, accounting and the rest) against each level that carries them: client, plant, sales area, valuation area and storage location. Each cell says whether the view is maintained, missing or not needed there, and marks it failing when a rule fails on that view at that level. A view the material type does not expect says so.
- **Rules failing, by view.** Each failing rule with its description, the view and level, the field, the value found, the severity and a link to its issue when one is open.
- **Follow-up chain.** For each plant phasing the material out, the chain of follow-up materials with their MRP type and discontinuation date, and what is wrong with each link: a successor that does not exist, is blocked or not planned, a loop or a dead end. Under it, the bills of material that still use the material.
- **Materials that look like it.** Other materials whose description, EAN or attributes match, with the match score. Open one to see it the same way.

If the material is not in the material master, or no run has data yet, the page says so.

## Work analytics

The Analytics tab, third at the top of the Work ledger, shows how fast the steward work list is being worked down. Every figure covers each object at its latest complete run. The banner counts the issues still open, with the records that carry an open issue, the issues closed in the last seven days and the pace closed a day. Its sentence says when the list will be clear at that pace, or that it is not getting shorter. Under it:

- **Open issues, day by day.** The open issues at the end of each day, with those found and those closed.
- **What the latest run changed.** Per object, the issues the latest run found new, fixed and still failing against the run before, with the rules newly failing and the rules recovered.
- **Time to fix.** From found to fixed over the last 180 days: the median and the slowest tenth, by severity, by object and for the slowest rules.
- **Decisions per person.** Each steward's decisions over the last weeks, split by kind, with a small line for each day. Under it, the open work per assignee with the critical and overdue items.
- **Issues that came back.** The rules and the systems whose issues reopen most after they were closed, with the rate.
- **Where the failing records sit.** The records with an open issue by organisational unit, such as plant or company code, with the share of each value.
- **How good the proposals are.** For each source of proposals (rules, the cleaning engine, steward edits and simulations), how many were approved and how many were still fixed at the next run. A source with nothing proposed shows a dash.

A role that cannot read a list sees a short note in its place.

## What is on it

- **The banner.** One sentence at the top: how many records failed a rule again since the last run and how many were fixed, with both figures beside it. Aletheia is docked on the right, as on every main screen.
- **Per system.** One row per connected system with the score then (the run before the clean), the score now, the change, how many records have failed again and how many were fixed since.
- **Failing again after a clean, by week.** A weekly bar chart over the last twelve weeks: records that failed again after a batch fixed them, set against records that were fixed again.
- **Drift by rule.** The rules whose records fail again most often, with the count for each. Open a rule to see which records came back and why.
- **Still clean, by batch.** Each approved batch with the records it fixed, how many are still clean and how many have failed again.

## The numbers and where they come from

Every figure comes from the record issue history that each run writes, joined to the remediation items of approved batches. A record counts as failing again when a run after its batch finds the same rule failing on it. Nothing is estimated: if no run has followed a batch yet, the screen says there is nothing to monitor.

## What you can do, by role

- **Data stewards and owners** open the drifting rules and send the records back to the ledger.
- **Programme leads** watch the weekly chart to see whether cleaning holds before a wave gate.
- **Auditors** read the still-clean table as evidence that approved fixes persisted.

## Keyboard

- `⌘K`, then "monitor", opens this tab.
- `Tab` moves between the tables; `Enter` on a rule or a batch opens it.

## When something is wrong

- **"Nothing to monitor yet."** No run has finished since a cleaning batch was loaded. Run the system once the load is in SAP.
- **A rule keeps coming back**: the source process creates the bad value again. Fix the process or the interface that writes the field, not only the records.
- **"The monitor could not be read."** The API did not answer. Check the system health, then reload.
