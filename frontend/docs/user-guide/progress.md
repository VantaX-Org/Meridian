# Progress

Progress answers two questions: how fast is the data getting fixed, and what is slowing it down? Leads use it to report on the clean-up and to see where to put people; stewards use it to see their own pace. Every number on the page is counted from what the work already records, the record issues, decisions and fix batches, with fixed rules and no model.

Open it with the **Progress** pill. The view has three tabs: **Progress**, **Trends** and **Forecast**. This chapter covers the first; Trends and Forecast are in [Analysis](/docs?page=analysis). The page follows the run chosen in the scope bar. Days are counted as calendar days in UTC.

## The figures at the top

- **Open records** (or **Open issues** before the run's work list is built): the records in the run that are still open, that is **To fix**, **Fix proposed**, **Approved** or **Sent to SAP**. The hint gives the number of open issues behind them. Select it to open Fix work.
- **Fixed this week**: issues a run showed fixed in the last 7 days. Only a run can mark an issue fixed; a value waiting for approval does not count.
- **Median time to fix**: the typical number of days from the day a run first found an issue to the day a run showed it fixed, over the fixes of the last 180 days.
- **Projected finish**: the day the open count reaches zero at the recent pace. The pace is the net number of issues closed per day over the last 28 days: the open count 28 days ago minus the open count today, divided by 28. When the pace is zero or negative there is no date, and the figure reads **No date yet**. With nothing open it reads **Done**.

Under the figures are the four sentences: what is open now, what changed in the last 7 days, which object takes longest to fix, and when the backlog clears, with **Open fix list**.

## Burn-down

A line of open issues per day over the last 90 days. An issue opens on the day a run first finds it and again whenever it fails after a fix or a sign-off is withdrawn. It closes when a run shows it fixed or someone signs it off. When there is a finish date, a **Projected** line continues at the recent pace, up to 90 days ahead.

Under the line, a bar per run shows the failing record checks in each run of the same system, so you can see each run's step down.

## Decisions by person

The decisions each person made in the last 30 days, by kind: **Accepted suggestion**, **Typed a value**, **Not an issue**, **Risk accepted** and **Approved**. A bar chart shows the twelve busiest people. **Open work per person** lists each assignee, and **Nobody yet** for unassigned work, with their **Open**, **Critical** and **Overdue** records.

## Time to fix

For each object, the typical days from first seen to fixed, slowest first. A table per rule shows **Fixed**, **Typical time** (the median) and **9 in 10 within** (the 90th percentile): nine out of ten fixes took that long or less. Only issues a run showed fixed count, over the last 180 days.

## Problems that come back

Issues that failed again after they were fixed. Each rule and each system shows **Came back**, **Tracked** (issues it has tracked) and **Rate**, the share that came back. A high rate usually means the cause is upstream: a process or an interface keeps writing the bad value, and fixing records alone will not hold.

## Where the failing records sit

The run's failing records split by the organisational unit in their record key: company code, plant, sales organisation, purchasing organisation or storage location. Use **Slice by** to switch. A Pareto chart shows how few units carry most of the failures, and the table lists **Failing records**, **Still to fix**, **Critical** and **Share of run** for the top 20 values. This tells you which site or company code to talk to.

## How good the proposals are

For each place a value came from (**Rule suggestion**, **Steward's own value**, **Cleaning engine**, **What-if simulation** or **Entered by hand**): how many values were **Proposed**, how many were **Approved**, **Sent to SAP**, and then **Fixed** or **Still failing** at the next run. **Fix rate** is the fixed values as a share of those the next run could check: fixed divided by fixed plus still failing. A low fix rate on rule suggestions is worth raising with whoever maintains the rules.

## Change since the previous run

For each object, comparing the run with the run before it from the same system: **New** failing records, **Fixed**, **Still failing**, and **Rules not in both runs**. Only rules that ran in both runs are compared, so a rule added or switched off never reads as a fix. **Open** opens the object.

## How to export

**Export** offers **Proof of progress (PDF)**, the comparison report for the run, and **Comparison workbook (Excel)**. Exporting needs the export permission.

## Good to know

- "Nothing to track yet" means no finished run has found failing records.
- "No earlier run of this system to compare with" means the change card fills after the next run.
- A card that fails to load shows its own error and **Retry**; the rest of the page still works.

## Related

- [Fix work](/docs?page=fix)
- [Approvals and export](/docs?page=approvals)
- [Analysis](/docs?page=analysis)
- [Key concepts](/docs?page=concepts)
