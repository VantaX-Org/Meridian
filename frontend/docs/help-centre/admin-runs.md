# Executing runs: analysis, discovery and baselines

A run is a measurement, taken at a moment, of the records Meridian holds. Every score, queue and comparison downstream reads it, so the craft is in starting the right run, watching it finish, and pinning the one that marks your baseline.

## What a run does, in order

Extraction reads the tables behind the objects you selected, filtered by the scope you set, and stores them as a version; the connection is read-only, so nothing is written back to SAP. The checks then run over that stored data: each rule applying to the object is evaluated, findings and failing records are written, and every object is scored into dimension scores and its data quality score. As scoring finishes Meridian builds the work list, routes new issues to owners, starts their clocks, and compares the run with the system's pinned baseline. Summaries and remediation text come afterwards, which is why a run can finish as scored and move again later.

Statuses mean different things: extracted is stored but unchecked; complete and its enriched variants have findings to read; partial means some checks were skipped; failed has nothing to read.

Re-running an analysis over data you already extracted is a separate action, on the run page and the system page. It re-checks the stored records with the current rules, replaces the findings, and keeps the run's name, baseline and history. That is the cheap way to test a rule change: it costs no SAP read.

## Scopes, periods and schedules

Open a system and choose Extract. Tick the objects, then narrow the read: company codes, plants, sales or purchasing organisations where the object carries them, a document date window where it has one, and an option to skip records flagged for deletion. Organisational filters restrict every table carrying that field, and general data without it is read in full so no record loses its context. Skipping deletion-flagged records reads faster, but inactive data is itself a finding, so leave it off for a true score. The confirmation names the system, the objects and the scope: the last checkpoint before a read that can take an hour.

Scheduled extracts pull an object again on a timetable: pick the object, a preset or a custom five-field cron, and full download or changes only. Times show in the tenant time zone and due runs start within five minutes. Changes only re-reads what SAP's change log says moved, with a full download at least weekly so a gap in the log cannot hide.

## Jobs, retries and failed extractions

The jobs page holds the newest two hundred extractions, analyses, uploads, configuration loads and discovery runs with status, duration, rows and a detail line. Expand a failed job for the error in one sentence, the next step, and the raw text underneath. Retry repeats a failed extraction, analysis, configuration load or discovery run, and needs the permission that starting it needed; an extraction a discovery run chained cannot be repeated there and sends you back to the system's Extract drawer. The run page's steps tab lists every step with its own status and message.

Read failures by cause. A sign-in refusal is credentials. Unreachable is host, port or route. A refused authorisation means the connection user cannot read one of the tables, which is a request to your SAP team. A missing library means the SAP connector is not on the worker. A timeout means the read was too big for the window: retry at a quieter time, take fewer objects, or move the object to changes only.

## Baselines and the regression monitor

Pin the run taken just after a clean-up as the baseline, from the run page or the progress toolbar. Every newer run of that system is then diffed against it, rule by rule. Records failing now that passed in the baseline are regressions: they are counted on the run, they raise a notification, and they are drafted into a new fix batch named for the day. Someone still has to accept its proposals and a second person approve it; Meridian never posts to SAP. Unpinning returns later runs to comparing against the previous run.

Comparing two specific runs is separate: select two in the runs list, or use compare with previous or compare with baseline on a run page. Both show what is new, what is fixed and what still fails, per rule and per record.

## Discovery, and running out of memory

Discovery reads the document and change tables of a business process and reconstructs how it ran, reporting coverage, fitness, variants and durations. Start it from a process page, pick the processes and, on a full run, a period start. A process your licence does not entitle is listed greyed out with "not in this licence", and no retry changes that. A full run takes from a few minutes to two hours, and only one discovery chain runs against a system at a time.

Memory guards are sizing feedback, not data faults. A discovery run over budget tells you to narrow the period. An extraction that would need more memory than the worker has says so before allocating, and names the two fixes: more worker memory, or a narrower object. Shorten the window, split the object across runs, or move it to changes only, and note the decision on the object page.

## Next steps

- Manage systems, extracts and schedules at [Systems](/systems).
- Watch and retry jobs at [Jobs](/admin/jobs).
- Read run history and comparisons at [Runs](/runs).
