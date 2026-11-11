# Post-clean monitoring

Cleaning a record is not the end of the job. Monitoring, under Work, shows whether records that a batch fixed stay fixed, and which rules keep pulling them back. Open it from the Monitor tab at the top of the Work ledger, or from **Open monitoring** on the **Cleaned and watched** card of the landscape and Work.

## Cleansing

The Cleansing page, under Fix, Cleansing, shows what the cleaning engine did. The banner gives the records cleansed in SAP and rolled back at the latest weekly snapshot. Under it:

- **Proposals to decide.** The proposals waiting for a decision, grouped by object and fix, with the number of records, the average confidence and how many are at 85% confidence or more. Users who may approve can approve the confident ones of a group in one step, or open a group and approve or reject each proposal. A rejection needs a reason, which is kept in the audit trail and sent back to the AI as feedback. **Review the proposals** in the banner jumps here.
- **Would SAP accept the new values.** Each new value of a waiting proposal checked against the SAP dictionary of the target system, the way SAP checks it at save: the field's type and length, its decimals, the zero padding of an all-digit key, upper case where the field stores no lower case, the domain's fixed values and the check table. The check table is read from the system's live configuration when Meridian has read it, and otherwise from the SAP-standard values, and the evidence says which. The banner counts the values that are safe, the ones SAP would reject and the ones that could not be checked because the value names no single SAP field. Each row shows the field's text, data element, domain and check table, why SAP would reject the value, and the nearest valid codes. A proposal in a group shows its worst verdict beside its confidence. The check is a fixed calculation and no language model sees the values.
- **Duplicate records to merge.** Each pair of records the cleaning engine found to be the same, with the object, the fields that matched and the match score. Open a pair to compare the two records field by field, with the value the merge would keep. Users who may approve choose the record to keep, give a reason and press **Merge**; the reason is kept in the audit trail.
- **Approved, waiting to be written to SAP.** Each approved proposal with the change it makes. Users who may apply fixes press **Write to SAP**; the change then appears under the changes you can still undo.
- **Where every proposal stands.** One bar split by status: waiting for a decision, approved, cleansed in SAP, rolled back and rejected.
- **Records cleansed, week by week.** The cleansed count at each weekly snapshot. The snapshots are counts at a point in time, so the weeks are never added together.
- **Cleansed by object.** Records in SAP per object, with the share of that object's proposals.
- **Applied changes you can still undo.** Each change applied to SAP, with the fields it changed (before and after) and the deadline. Users who may apply fixes can roll a change back for 72 hours; after that the button is disabled.
- **Audit trail.** The last 25 decisions with who made them. Roles without the export permission see a dash instead.

## Data mining

The Data mining page, under Master data, Data mining, shows what the mining tasks found by comparing records and values rather than by running the rules. Every list keeps each object at its latest complete run, so it is the current state. The banner counts the likely duplicate pairs and outliers, with the patterns of the last 30 days, the share of analysed objects mined and the runs mined beside it. Under it:

- **Findings by object.** Duplicate pairs and outliers per object, most first.
- **Patterns.** The outliers grouped by field and the duplicates grouped by object, with severity, how often each was found and the confidence.
- **Likely duplicates.** Each pair of records with the match score and the fields whose values are the same, each with its description.
- **Outliers.** Each value far from the rest of its field, with the usual range or how many standard deviations it sits from the average, and how it was found.
- **Fields that depend on each other.** Pairs of fields whose values move together or where one decides the other, strongest first. These are candidates for a cross-field rule.

Users who may change master data can press **Mine the latest runs** to mine the latest run of every object again. A role that cannot read the mining results sees a dash in each list.

## Anomaly rules

The Anomaly rules page, under Rules, Anomaly rules, turns an outlier that mining found into a proposed rule. It lists each field that has outliers, with the field description, how many outliers it has and the usual range. Users who may manage rules press **Propose a rule** on a field. The page then shows:

- **The proposed rule.** A deterministic rule that flags values outside the usual range of the field. It is a template, so no AI is used. The AI drafts a rule only when no template fits, and then it sees the field, the statistic and counts, never a record.
- **The evidence.** The outliers found, how many records the rule would flag when it runs on the same data, and the confidence.

Press **Save as draft** to keep the rule as a draft in the rule workbench, where it is reviewed and published as any other draft.

### Null spikes and unexpected codes

Under the outliers, the panel **Null spikes and unexpected codes** compares each run with the run before it of the same system and shows counts only, never a record. Meridian reads it from the field statistics of the runs (row count, blank count, distinct values and the most common values of code fields); no AI is used. Each row shows the field with its description, the kind, the runs compared ("Run 12 against run 11"), the figures before and now, and the severity. By default the panel shows the latest run of each object that has shifts.

- **Null spike.** The share of blank values in a field rose by at least 10 points against the earlier run, and both runs hold at least 100 rows. The severity is medium, high from a rise of 25 points and critical from 50 points. The figures read "12% empty" before and now.
- **Unexpected code.** A code appears in the field that none of up to five earlier runs listed. Meridian judges this only when the current run and the one before it list every value of the field, so a new code is certain. Fields with many distinct values, masked fields and sensitive fields get no such check, because their statistics do not list every value. The severity is high when the new codes make up 5% or more of the filled rows, otherwise medium. The figures read "3 of 48,000".

A run with no earlier run to compare gets no shifts, and earlier runs are not checked afterwards. When nothing shifted, the panel says "No null spike or unexpected code was found."

Press **Propose rule** on a row to draft a rule from the shift. A null spike drafts a null check on the field. An unexpected code drafts a domain value check on the values the earlier run listed, and only when it listed every value. The draft is saved in the rule workbench like **Save as draft** above, so nothing is enforced until a person reviews and publishes it. Pressing it again for the same shift does not create a second draft; the page says "This draft already exists. Find it in the rule workbench."

## Learned monitors

The Learned monitors page, under Rules, Learned monitors, compares the latest run of each object with that object's own earlier runs. It needs no setup: material master, customer master and SuccessFactors get it as soon as they have runs. Every figure comes from the stored run results, so no record value is read and none is sent to a model.

Each object keeps a baseline of up to 30 earlier runs of the same system for these figures: records checked, score, and the fail rate of each rule. It also keeps the empty share and the distinct share (distinct values as a share of the filled rows, for fields with at least 100 filled rows) of each field that has field statistics. The usual range is the median of those runs plus or minus a robust spread (the median absolute deviation), so one bad run does not move it much. When an object has at least 28 earlier runs, the baseline also compares like weekdays with like. The table **What is learned** shows, per object, the latest run, how many earlier runs the baseline uses against how many it needs, and whether the object is **Watching** or still **Learning**. An object with fewer than 5 earlier runs only learns: it raises nothing and shows a dash for breaks.

After each analysis run Meridian checks six kinds of break and stores each with its severity, the usual range, the observed value and the runs behind it:

- **Volume drop** and **Volume spike.** Records checked fell below or rose above the usual range.
- **Fail rate jump.** A rule failed on a larger share of records than usual. The row shows the rule code with its description.
- **Score drop.** The score fell below the usual range.
- **Field emptied.** A field that is normally populated is now empty or far emptier than usual. The row shows the field code with its description.

- **Distinct values shifted.** The share of distinct values among the filled rows of a field moved by at least 20 percentage points either way, for example a code field that collapsed to a few values or a key field that began to repeat. The row shows the field code with its description. Only counts are compared; no value is read.
- **Value shapes shifted.** The share of filled rows whose shape falls outside the field's usual shapes rose by at least 10 percentage points. A shape is the layout of a value (letters count as A, digits as 9), and the usual shapes are those that hold at least 5% of the rows in at least half of the earlier runs. A field whose usual shapes cover under 80% of its rows (free text, keys) is skipped, and so is a field with fewer than 100 filled rows. Only the profile's five commonest shapes are read, so a field with many layouts is not judged.
- **Format broke.** The share of values that do not parse (numeric fields) or are not valid dates (date fields) rose by at least 5 percentage points. It is judged for any field with at least 100 filled rows, including personal fields, because it is a count.
- **Range shifted.** The mean of a numeric field moved by at least 50% of its usual level in either direction, the largest value of a numeric field rose or its smallest value fell by that much, or the latest date of a date field fell back, or the earliest date moved earlier, by at least 365 days. The row names the figure that moved (**Mean**, **Largest value**, **Smallest value**, **Latest date**, **Earliest date**) and shows how far it moved, as a percentage or in days; it does not show the value. One field raises at most one range break per run, the strongest.

Limits of the three. A latest date that moves forward as new records arrive is normal and never a break, so a dummy far-future date such as 31.12.9999 is not caught by **Latest date**; it does not parse as a date and shows up in **Format broke** instead. A profile taken from a sample of the rows gives no largest, smallest, latest or earliest figure, because a sample's extremes are not the table's; the mean and the shares are still watched. Personal and sensitive fields, and fields masked for privacy, are never watched for shapes or ranges, only for the share that does not parse. No value, shape, mean or date of a field is ever sent to a model: the wording is built from the share or the size of the move alone.

The panel **Breaks in the latest run** lists them, most severe first. Press a break to see **Why Aletheia flagged this**: a sentence built from the figures by a fixed template, and the runs it rests on ("Run 12 (this run)"). Press **Ask Aletheia to explain** to have the model reword it. Aletheia sees only the aggregate figures and the rule or field description, and Meridian drops any sentence that states a number outside those figures. When the model is not available, the fixed wording stays.

### Between full runs

A full analysis takes minutes to hours, and its figures (score, fail rate, empty share, records checked) exist only after the checks have run. One figure is known earlier: the number of rows a sync extracted, which Meridian stores as soon as the extraction lands. Every 15 minutes it compares that count with the row counts of the earlier synced runs of the same object, with the same baseline and the same learned minimum as the run monitors. The panel **Between full runs** lists a **Volume drop** or **Volume spike** found this way, with **Rows extracted**, the usual range, **Earlier syncs used** and the status **Analysis pending**. Press one to read the explanation, which states that the break comes from the extraction and not from a finished run. Steward decisions work as for any other break.

The check is limited on purpose:

- It covers volume only. Score, fail rate and empty share cannot be known before the checks run, so nothing is shown for them.
- It covers full extractions of a profile with one module. A delta or sampled extraction does not carry the size of the object, and a profile with several modules sums their rows, so both are left out.
- It looks at the latest sync of the last 72 hours whose analysis has not finished. When the analysis finishes, the run monitor judges the run on records checked and replaces the interim row.
- It reads stored counts only. It starts no extraction and does not run while the analysis is working.

Users who may change master data can decide on a break:

- **Acknowledge.** You have seen it. The baseline does not change.
- **Mark expected.** Choose **Leave this run out of the baseline** if the run was a one-off, or **Accept as the new normal** if the new level is right; the baseline then restarts at that run.
- **Snooze.** Hide the break for 1, 7 or 30 days. When the time passes and the break still stands, it reads as open again.

Each decision is written to the audit log with the person who made it. Other roles can read the page and ask for an explanation but see no decision buttons.

### Learned minimum effect

A break is raised only when its effect reaches the minimum effect of that monitor. A monitor is one object, one figure and one rule or field. The effect is the share of the median for records checked, points for score, percentage points for fail rate, empty share, distinct share, shape share and unparseable share, the share of the median for the mean, largest and smallest value of a number, and days for the latest and earliest date. Each figure has a fixed floor: 30 percent of the median for records checked, and fixed point values for the others (45 points for empty share, which is exactly where the monitor fires today, 20 points for distinct share, 10 for shape share, 5 for unparseable share, 50 percent for number ranges and 365 days for date ranges).

The panel **Learned minimum effect** shows, for every monitor that decisions touched, the **Minimum now**, the **Fixed floor**, the **Ceiling** and **Decisions that moved it**, newest first, each with the run, the person and the effect.

- **Mark expected** raises the minimum to 5 percent above the largest effect marked expected in the last 90 days.
- The ceiling is 3 times the floor, so a monitor is never silenced. A break above the ceiling is always raised.
- **Acknowledge** on a break smaller than the current minimum lowers the minimum to that effect. It never goes below the floor.
- Decisions older than 90 days stop counting, so a raised minimum relaxes by itself.
- Severity cut points scale with the minimum divided by the floor, at most 1.5 times, so a total loss of records stays critical however high the minimum.

The panel **Below the learned minimum** lists breaks that are outside the usual range but smaller than a raised minimum. They raise no alert, send no notification and are not counted as open. **Confirm as real** records the decision as an acknowledgement, and the minimum drops to that effect, never below the floor. A later run replaces the list.

Limits. The minimum is one number per monitor, learned from decisions alone. The distinct-share and shape monitors compare counts and shares only: they cannot tell which values changed. The shape monitor reads only the five commonest shapes of a field, and the range monitors need an unsampled profile for the largest, smallest, latest and earliest figures. The rule is a fixed calculation on aggregates, not a trained model, and a language model takes no part in it.

## Entry gate

The Entry gate page, under Master data, Entry gate, shows the data quality firewall: the check SAP calls before it saves a master data record. It covers the licensed objects, Material master, Customer master (sales) and SuccessFactors employee data. The page shows only what the firewall's audit trail holds. Where the trail did not record a figure, the page shows a dash and not a zero.

- **Records checked and blocked.** Two charts of the last 7 days, with a table of each day. A record is blocked when it fails a critical rule. A record that passes but fails a lesser rule is warned. The warned and passed counts were not kept before this release, so earlier days show a dash.
- **Rules that block most.** The critical rules that stopped the most records, each with its code and what it requires.
- **By object.** Records checked, blocked, warned and passed for each licensed object.
- **Try a record.** Paste records as JSON, choose the object and press **Check records**. The page runs the same check SAP calls. Tick **Show a fix where the rule gives one** to see a suggested fix. A fix appears only when the rule itself defines one, either a corrected value from the rule's auto-fix steps or the values the rule accepts, and each fix names its rule. When no fix is grounded in the rule, the cell shows a dash. No language model sees the record. The **SAP dictionary** column shows, for each failing field, its text, data element, domain, type and length and its check table, with whether the table's values were read from the system or are the SAP-standard values. When the value is not in the check table or the domain's fixed values, **Did you mean** lists the nearest valid codes.
- **Send to a steward.** Tick **Send blocked or warned records to a steward as a change request** before you check. Each blocked, warned or duplicate-flagged record then opens a create request and sends it to the approval workflow, and a table shows the request's status and an **Open the request** link for each record. Checking the same record again shows the request that is already open and adds no second one. When no request is opened, the note says why in words: SuccessFactors employee data has no change request, only the first 25 flagged records open one, the change request refused the record, or opening failed while the verdict still stands. The request carries the record values like any other change request, so avoid it for personal data you do not want held there.
- **Hold the SAP save.** Choose **Blocked** or **Flagged** in the **Hold** list before you check. It also sends the records to a steward, as above, and answers whether the SAP save may go on. Each covered record shows its hold state: **Held** while the request waits for approval, **Released** once it is approved (the save may go on, even for a blocked record, for 24 hours and once), **Rejected**, **Written** when Meridian writes or has written it to SAP or the load file was already taken, and **Not held** with the reason when no request could be opened. A line under the table says **The SAP save stops.** or **The SAP save may go on.** A released request cannot also be exported as a load file, and the Requests screen shows it as "Released to the SAP save". The sample SAP code for this has not been run on a live SAP system.
- **Holds panel.** Above the requests, the number held now, and released, rejected and written over the last 7 days, the age of the oldest held request, the median time from opened to decided, and the latest held requests, each with its object, status and a link. A dash or a sentence replaces a figure when nothing was held or decided.
- **Requests opened from the gate.** The latest ten requests the gate opened, each with its title linking to the request, its object and its status in words, and the date it was opened.

The page is a view of the firewall. The SAP side, the API key and the choice to let a save go on or stop when the check cannot run are described in the point-of-entry guide in the repository (docs/point-of-entry.md). The approval workflow runs in Meridian, not in SAP. The duplicate search at entry warns and never stops a save. It also finds a tax or part number that is one character different, or has two neighbouring characters swapped, and the page names the identifier field that matched under Matched on. A near value is a prompt to look: it can be another taxpayer or another part, and a difference of two or more characters is not found.

## MDM health

The MDM health page, under Master data, MDM health, shows the daily snapshot of how well master data is governed. The banner gives the health score out of 100 and its change over the last 90 days, with the golden records, the open stewardship items and the share of systems synced beside it. Under it:

- **What makes the score.** The four shares the score is built from, each with its weight and the points it adds: golden record coverage (40%), match confidence (30%), steward SLA (20%) and source consistency (10%). The points add up to the score. A small line beside each share shows its last 90 days.
- **Health score, day by day.** The score at each daily snapshot on a 0 to 100 scale.
- **Stewardship backlog, day by day.** The open stewardship items at each snapshot.

The snapshot runs once a day. Until the first one has run the page says so, and the charts need two days of snapshots before they draw a line. Viewers and process analysts see no figures.

## Record links

The Record links page, under Master data, Record links, shows which records are linked across objects: a business partner and the customer it is, a material and its plants, a vendor and its company codes. Relationship discovery reads these links from the SAP link tables at each sync, and the AI impact scorer adds links it infers. The banner counts the links, with the link types in use, the objects they join and the share that was inferred rather than read from SAP. Under it:

- **Find the links of one record.** Pick an object and type a record key to see every link to and from that record. Tick **Include ended links** to see links that no longer exist in SAP.
- **Links by type.** How many links of each type, most first. The list holds the latest 200 links; when there are more, the bars cover only those, and the banner says so.
- **Links.** Each link with the record on each side, what the link means, the SAP table it was read from (or the confidence of an inferred link) and the day it was found.
- **Link types SAP defines.** The link types with the SAP tables on each side.

Roles without permission to see AI confidence see a dash instead of the confidence of an inferred link.

## Record issues

The Issues page, under Master data, Issues, is the steward work list. Each issue is one record failing one rule, carried from run to run with its status, the person it is assigned to, its due date and its history. The banner counts the issues still to close, with those in progress, those waiting on SAP or on the requester, and those closed. Under it:

- **Where the issues stand.** How many issues are in each status.
- **Status buttons and filter.** Show one status or all of them, then narrow by severity, by who the issue is assigned to (you, no one or anyone) and by record key. Users with the export permission can export the list to Excel with the same filters.
- **Issues.** Each issue with the record, the rule and the field it failed on, the severity, the status, the assignee, the due date with whether it is on time, and how often it has been reopened. The list is ordered most severe first, a hundred to a page.
- **Change the selected issues.** Tick issues to move them to another status, assign them or add a note. Accepting an issue needs the approve permission and a resolution (risk accepted or false positive); a false positive needs a reason. Resolving needs the resolution fixed in the source. Other moves and assignments need the assign permission.
- **One issue.** Open a record to see the runs that found it failing or clean, and who did what to it. Users who may analyse can add a comment.

## Action centre

The Action centre, the first page under Fix and the page the Fix item opens, lists everything that needs you, most urgent first: fixes waiting for your approval, systems that cannot be reached, records failing again, overdue stewardship items, failed jobs, rules waiting for review and, for administrators, access requests and expiring keys. You see only what your role can act on. The banner counts the items by severity and says when the list was last checked; it refreshes every minute. Under it:

- **Filter.** Narrow the list to one kind or one system. The choice stays in the address, so a link to it opens the same view.
- **What needs attention, by kind.** How many items of each kind.
- **Act on these.** Each item with what happened, its severity, the system and object, when it started and how many records or items it covers. The button opens the screen where you resolve it.

## Material 360

The Material 360 page, under Master data, Material 360, shows one material across every view and organisational level. Type a material number; leading zeros may be left off. The banner gives the description, the material type, group and base unit, with the rules it fails, the views missing and the plants phasing it out beside it. Under it:

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
- **Cleaning engine pace.** What the cleaning engine has found and applied over every day it has recorded: fixes applied a day, fixes still waiting, the share approved without review, the share rejected at review or rolled back after applying, and the average review time.
- **Issues that came back.** The rules and the systems whose issues reopen most after they were closed, with the rate.
- **Where the failing records sit.** The records with an open issue by organisational unit, such as plant or company code, with the share of each value.
- **How good the proposals are.** For each source of proposals (rules, the cleaning engine, steward edits and simulations), how many were approved and how many were still fixed at the next run. A source with nothing proposed shows a dash.
- **Rules stewards call wrong.** Each rule with the steward verdicts on its flagged records: how many were called a false positive, how many were confirmed real, and the false-positive rate, the rule called wrong most at the top. **Show why** lists the notes stewards left when they called that rule wrong, with the records behind each note and the date it was last given. A rule with a high rate is a candidate for tuning or for a scope change.

A role that cannot read a list sees a short note in its place.

## Cost and causes

Cost and causes, under Migration on the rail, shows what bad data costs and where it comes from. Money is always shown per business area, such as procure to pay or order to cash, and never added across areas. The banner names the area with the most value at risk, with the largest value at risk, the largest proven cost, the SAP features at risk and the number of root causes. Under it:

- **By business area.** The proven cost and the value at risk of each area side by side.
- **Money already lost.** Costs measured in posted documents, such as late purchase orders or duplicate vendor payments, with the documents counted and the rules behind them. A cost in more than one currency lists each currency on its own.
- **SAP features at risk.** The features the failing rules block or degrade, with the records they touch, the value a record and the rules that cause it.
- **Root causes.** The failing rules grouped by the field they fail on, with the severity, the records, the share that can be fixed automatically and the program or user the bad values mostly come from. A figure that has not been worked out shows a dash; an estimated record count says "about".
- **Score run by run.** The score of the last runs, with the rules each run fixed and newly found.

Before the first scored run the page says so instead of showing figures.

## Forecast and plan

Forecast and plan, under Migration on the rail, shows where each object's score is heading, what to fix next and whether the data stewards can keep up. The banner counts the objects below their floor and the objects heading below it, with the sprints needed to clear the open work and the score once they are done. Under it:

- **Where each score is heading.** Each object with its floor, its score now, its last four weeks, its trend and its forecast in 30 and 90 days, each with a 95% range. A forecast needs scores from at least three days; until then the page says how many days there are.
- **Next best work.** The failing rules, cleaning items and exceptions ranked by the severity-weighted records fixed an hour, with the records, the effort and the cost where a cost per record is set.
- **Sprint plan.** The ranked work filled into sprints of the stated hours, with the records fixed, the critical findings cleared and the score before and after each sprint.
- **Can the stewards keep up.** The stewards needed against the stewards working, the new items a day, the items one steward clears a day, and the queue stages where items wait longest. Items already applied or rejected are not counted. Until stewards have recorded work the page says capacity cannot be planned instead of guessing.

The effort and cost assumptions are shown above the sprint plan.

## Value delivered

Value delivered, under Migration on the rail, prices what the latest finished run found. Each failing record is given the unit cost of the loss it can cause, taken from your cost model, and the mitigation share is what fixing it removes. The banner shows the annual risk found, the risk mitigated a year, the return on the subscription and the payback in months. When no subscription cost is set in the cost model the return and payback show as a dash with a note instead of an invented fee. Under it:

- **Where the risk sits.** The eight kinds of loss (duplicate payments, missed warranty claims, compliance penalties, inventory write-offs, blocked invoices, failed postings, contract violations and steward time saved), each with what counts towards it, how many findings or exceptions feed it, its annual risk, the amount mitigated and the formula used to price it.
- **Cost avoided month by month.** The monthly report records the subscription, the risk mitigated and the return to date on the first of each month. Until the first month is recorded the page says so.

Only the latest run is priced, so the figures never add the same failing records twice across runs.

## Survivorship picks and their accuracy

Aletheia survivorship lists the golden-record winners the model picked and whether the server proved each one. A candidate is shown as its source and the shape of its value, never the value. A steward can act on a proved pick:

- **Accept the pick.** Records that a steward kept it. If the approval policy held the pick back, accepting applies it.
- **Override.** Choose one of the other offered sources, never free text, and optionally a reason: wrong source, out of date, incomplete, wrong format or another reason. The change goes through the steward override path, so the field stays pinned until you clear it on the merge explain screen.

Each decision stores who decided, when, the earlier source and the new source, and writes an audit entry. The accuracy panel shows how often stewards keep the pick: the accepted, overridden and waiting counts, the weekly trend of accepted picks and a bar per field. A pick that is ingested again becomes waiting again.

To require approval before any AI pick is applied, use the Steward approval of AI picks panel on the verified survivorship screen. It shows the current value and the tenant setting behind it, `survivorship_ai_approval`: `required` (the default) holds each proved pick in the approval queue until a different steward approves or rejects it, `not_required` is the opt-in auto-approve and applies it at once. Changing it needs the manage settings permission; without it the panel shows the value and says why the control is off. Each change writes an audit entry.

## Reference data

Reference data, under Master data on the rail, manages the code lists of an ECC to S/4HANA migration: country, unit of measure, material group, payment terms and, for SuccessFactors, the picklist values. Lists come only from the check tables Meridian has already extracted. A list with no extracted check table is not shown, and a code with no extracted text shows the code alone.

- **Versions.** Each completed load of a check table is a version. Pick one to see the codes it held, and read the trend of codes per version.
- **Source codes.** Every source code with the target it goes to: the same code on both sides, a mapping, or no target yet. Each code sits beside its description.
- **Mappings.** A person with the analyse permission proposes a source to target mapping. A second person, never the proposer, approves or rejects it. Only an approved mapping reaches the migration. Each decision stores who decided and when, and writes an audit entry.
- **Ask Aletheia.** With the trigger AI permission, Aletheia suggests a target from code values and descriptions only. The server checks that the target exists in the list before showing it, and a person still has to approve it.

## Post-load reconciliation

Post-load reconciliation, on a migration analysis (Migration on the rail, select an analysed run), compares the load files Meridian prepared with what the target system holds afterwards. Meridian does not run the load. You load the files with your own tool, extract the target system again, and then run the comparison. Until the target has been extracted, nothing is compared.

- **Extract the target system.** When the target has no completed analysis, the panel says the target system has not been extracted yet and offers **Extract the target system**. It needs the trigger sync permission and starts the extraction now, for the run's objects that the target system type supports. It reads whole business objects, not only the tables the load files carry. If an extraction on that system is already running, Meridian refuses and starts nothing: it never queues behind a running extraction or interrupts it. The run must name a target system. When the extraction has been analysed, the comparison starts by itself.
- **Delete an analysis.** **Delete** in the Analyses list needs the analyse permission and asks for confirmation. It removes the analysis with its gaps, load files and reconciliations and the stored copies of the files exported, and it cannot be undone. A running analysis cannot be deleted. If the stored copies cannot be removed, the analysis is kept so you can try again. Files you already downloaded are not covered.
- **Run reconciliation.** Needs the analyse permission. The run must be analysed, must name a target system, and must not be reconciling already. The comparison runs in the background and the panel refreshes while it runs.
- **Scores.** One row per object with three figures side by side: **Source**, **Projected** (what the analysis expected for the target) and **Actual in target**. The actual figure is the data quality score of the target system's own latest analysis. When the target has no completed analysis, or none for that object, the cell is a dash with the reason. Meridian never estimates it. Under the scores, **Rules that moved the actual score** lists up to ten rules whose pass rate differs between source and target, the largest change first, each with its rule id beside its description.
- **Records per target table.** For each target table: expected (records in the load files), found in the target extraction, missing, and held back but present. Records are matched on the table's dictionary key. A record the blocking gaps held back is reported only when it is present in the target. A target record that is not in the load files is not reported, because the target holds records from other sources. A table that cannot be judged shows **Not compared** with the reason code beside its text: no key in the data dictionary, key field not in the load files, target extraction incomplete or partial, table not extracted, or key field not in the target extraction.
- **Fields compared.** Per field: how many loaded values were compared with the target, how many match and how many differ. A field the load left blank is not compared, because the target may fill its own default. Values are compared after trimming and, for numeric keys, padding to the SAP internal form. A difference in number format or case counts as a difference.
- **Records.** Pick **Missing in target**, **Different in target** or **Held back but present**, and optionally one table, to see the records with the expected and the found value. The list keeps the first 100 records of each table and kind. The counts are complete, and the panel says when a list is cut. The rows hold the compared values, so they follow the access rules of the migration data. A personal field is counted like any other, but its values are not kept: the record shows **Withheld** in place of the expected and the found value.
- **Out of date.** When a target extraction finishes after the comparison, the panel says so with the date of the newer extraction. Run the reconciliation again to compare with it, or wait: when the target system finishes a new analysis, Meridian starts the comparison itself for every run whose latest comparison used that system, unless one is already running. The panel then says **Started automatically when the target system was analysed again** and shows how the missing, differing and found counts moved since the previous comparison.
- **Download as Excel.** Needs the export permission. Sheets: Tables, Fields and Records.
- **What it was compared against.** At export, Meridian keeps a copy of exactly the files you handed over. The panel says **Compared against the files exported on** a date when it used that copy, so a mapping changed after the load is not a difference. When no copy exists, or it could not be read, the panel says the expected side was **Rebuilt from the current field mappings**, and then a mapping changed after the load does show as a difference. The copy holds record values, personal fields included. It is deleted with its run, with a version or tenant purge, and a data-subject erasure rewrites it without the person. Backups and files you already downloaded are not covered.
- **Columns cut from the extraction.** A table that lost non-key columns but has every record is compared on the fields present; the lost fields show as not in the target extraction. A table read for a date window or scope, or an older extraction recorded as partial, still shows **Not compared**.

## Score lens

Score lens, under Migration on the rail, scores every run two ways. The first is the score as it was recorded when the run finished, with the weights in force then. The second re-weights the same run under today's weights, so a change of weights never reads as a change in the data. The banner shows the latest run both ways, how many points the weight change accounts for, and the config-aware score. Under it:

- **Score under today's weights, run by run.** A trend line over the runs, oldest on the left. The table under the chart gives both scores for each run.
- **Each run, then and now.** Each run with its score then, its score under today's weights, the change the weights make, and whether the weights were recorded with the run. Runs scored before weights were recorded are re-weighted from the default weights, and the table says so.
- **Each module on the six dimensions.** A heat map of the latest run: one row per module, one column per dimension (completeness, accuracy, consistency, timeliness, uniqueness, validity) and the score. Each cell is coloured by your score targets: on target, below target, or below the warning line. A dimension no rule measures shows a dash. The last column counts the critical rules failing, and a note under the map says which module scores are capped by a critical failure.
- **Each module across the runs.** One row per module with a sparkline of its score, the latest score, the score as recorded then and the change since the first run.
- **Config-aware score.** The latest run counted only over the rules that your loaded SAP configuration says apply. A rule for batch management does not count when batch management is not active in any plant. The panel shows when the configuration was loaded, the score per process and per module, and the reasons rules do not apply with how many rules each covers. When no configuration is loaded every rule counts by default and the panel says so.

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
