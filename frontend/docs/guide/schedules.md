# Reports and schedules

Reports are files built from a stored run: the board pack, the analyst workbook, the analysis report, the trend report and the rule catalogue. Schedules build a report from the latest run and send it on a rhythm. Open Reports from the command line (type "reports") or at `/v2/reports`.

## What is on it

- **The sentence**: "6 reports made, 2 of 3 schedules are on. Reports are built from stored runs, so a number in a report matches the run it names."
- **Create a report** and **Schedule a report**.
- **Reports**: report, run ("Run of 16 Oct 2026"), format (PDF or XLSX), created, by, size and **Download**. The rule catalogue is "Not tied to a run".
- **Schedules**: "Each builds a report from the latest run and sends it." Report and format, cadence ("Every Monday at 07:00 (Africa/Johannesburg)"), recipients, next run and last result (**Delivered**, **Partly delivered**, **Failed** or "Not run yet"), and **Paused** for a paused schedule.

## Create a report

Choose the report, the run it is built from ("Built from the run you choose") and, optionally, one object. The report is built by a worker and appears in the list when it is ready.

## The schedule inspector

Open a schedule for its facts (next run, last run and its result), then: name, report (Board pack (PDF), Analyst workbook (XLSX), Analysis report (PDF), Trend report (PDF), Rule catalogue (PDF)), **Which run** ("The latest finished run", "The latest file upload" or the latest run of one system), an optional object, the cadence (every day, week or month, the day and the time in the tenant's time zone), the recipients (people of the tenant and the alert channels that take reports) and **Schedule is on**. Actions: **Save the schedule**, **Pause**, **Run it now** ("It is built on the worker and delivered to the recipients; the next scheduled run is unchanged.") and **Delete** ("No more reports are built or sent from this schedule. Files it already made stay in the list.").

## The numbers and where they come from

Every figure in a report is read from the run it names, so the board pack of 16 Oct says what the landscape said for that run. Money is in the tenant currency from the run's cost model. Alerts and channel messages carry counts, rule ids and links, never record values.

## What you can do, by role

- **Programme lead, analyst, admin** (export): create, schedule, run now, pause, delete.
- **Everyone with view**: download reports. "Creating and scheduling reports needs the export permission."
- **Administrator**: add the channels that can receive reports under Administration, Alerts.

## Keyboard

- `j` and `k` move through reports and schedules, `Enter` opens a schedule.
- `Esc` closes the inspector.

## When something is wrong

- **"No report has been made yet. Create one from a run, or schedule one to arrive on its own."**
- **"No one can receive reports yet."** Invite people, or add an email or Teams channel under Administration, Alerts.
- **Partly delivered**: one recipient or channel refused it. Check the channel under Administration, Alerts; email needs an email backend, which Administration, Jobs and system update reports under Health checks.
- **Failed**: open the schedule and choose **Run it now** after fixing the channel; the job appears under Runs, Jobs.
