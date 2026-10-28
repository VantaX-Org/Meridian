# Keeping the plumbing healthy

Basis work in Meridian is the supply chain: connections that still work, extracts that land on time, configuration that matches SAP, and jobs that either finish or say why they did not. Do it well and everyone downstream sees current numbers without asking. Do it late and every score on every page quietly goes stale.

## Schedule the extracts

Data changes in SAP every day, so a run is a photograph, not a feed. Scheduled re-evaluation keeps the photograph recent: choose an object, a schedule and a mode, and add it. An extraction reads the tables behind the objects you selected, filtered by the scope you set, and stores them as a run; nothing is written back, because the connection is read-only. The analysis then applies the rules that apply to that system and builds the work list. If you run an extract alone, the analysis is a second step over the same stored data, which is the cheap way to test a rule change.

Two modes cover nearly everything. A full download reads every record of the object. Changes only re-reads the records SAP's change log shows as changed, which is quicker and lighter, at the cost of trusting the log; Meridian takes a full download at least weekly so a gap in the log cannot hide.

Choose the schedule from the work downstream, not from the calendar. A weekly clean-up needs a run before stewards start, not after. Approvals and exports land on a Wednesday, so the confirming run should be Thursday. Daily deltas on the objects people actually fix, and a weekly full on everything else, is a sane default.

## Memory guards and time limits

Large transactional objects can outgrow the budget of a single job. When they do, the job stops with a memory message that asks you to narrow the period, and that is exactly the right instruction: shorten the document date window, split the object across runs, or move it to changes only.

Read these as sizing feedback, not data faults. The same scope will keep failing at the same size. If an object is genuinely that big, narrow the period permanently, schedule it that way, and say so on the object page so nobody re-widens it. A timeout at a busy hour is a different signal: retry the step quietly before you change anything.

## Process discovery runs

Discovery reads the document and change tables of a business process and reconstructs how it actually ran: which steps, in what order, by whom, on how many cases. It is heavier than an ordinary extract and takes from a few minutes to a couple of hours depending on volume, so plan it rather than clicking it during a meeting.

Three things catch people. A process needs enough cases to mean anything, so a rarely used path gives a thin model rather than a wrong one. Only one discovery chain runs against a system at a time, and a chain that waits too long reports that extraction on the system was still running. And the licence may not include the modules a process's event log reads: such a process is marked as not in this licence, cannot be selected, and no amount of retrying changes that. Ask whoever holds the licence what is entitled before you plan around a process.

Once a run finishes, the process page shows coverage, fitness, variants and duration, and the data-quality defects on the objects that process touches.

## Config loads

A configuration load reads the customising: which fields are required or optional, which values are valid, which parts of the product are switched on. That is how Meridian decides which rules apply. Without it, every rule applies by default, and a field your configuration never uses reads as a defect on every record.

Load the configuration on a new system before anyone reads a score from it. Re-load after a configuration change in SAP, and after any upgrade that touches the tables you monitor, so a change in score can be traced to a change in SAP rather than to the data. A load can finish with gaps when some areas could not be read; the rules that depend on those areas fall back to applying by default, and the page tells you how many areas loaded. Retry the gaps once the connection is healthy, and treat a persistent gap as a missing authorisation rather than a bug.

## Jobs, retries and alerts

The jobs tray shows what is running now. The jobs list shows extractions, analyses, uploads and simulations with their status, duration and any error, and a failed run breaks into steps, each with its own message.

When a job fails, read the sentence rather than the stack. A sign-in refusal means credentials. An unreachable message means host, port or network route. A refused authorisation means the connection user cannot read one of the tables, which is a request to your SAP team. A missing library means the SAP connector is not installed on the worker. Fix the cause, then retry the failed step or re-run the analysis: retrying without fixing just refills the list. A run that stays running for a long time usually means the background workers have stopped, which is an infrastructure check, not a data one.

Alert channels carry the news out: email, Slack, Teams or a webhook, each with a digest and a test you can send. Alerts carry counts, rule IDs and links, never record values, which is what makes them safe to leave on a shared channel. Send a test when you add one, and point a channel at the two events worth waking someone for: a system that stopped being reachable, and a run that failed before it scored.

## Next steps

- Manage connections, loads and schedules at [Systems](/systems).
- Review discovery runs and process models at [Processes](/process).
- Set channels, retention and health checks at [Settings](/admin/settings).
