# Reports and schedules

Reports are files built from a stored run: the board pack, the analyst workbook, the analysis report, the trend report and the rule catalogue. Schedules build a report from the latest run and send it on a rhythm. Open Reports from the command line (type "reports") or at `/reports`.

## What is on it

- **The banner**: the small line says "Report delivery" and the headline says what needs you first: "2 schedules failed on the last run", "1 schedule is overdue" (more than an hour past its next run), "1 schedule reached only some recipients", "Every schedule delivered on its last run", or "No report goes out on a schedule yet". Three figures: **Reports made** (with how many of the latest came from a schedule), **Schedules on** ("of 3 in all") and **Need attention** ("failed, overdue or partly delivered"). The one button is **Create a report**, for people with the export permission.
- **Reports made by kind**: a horizontal bar per report kind (board pack, analyst workbook and so on), with "4 made, 2 by schedule" at the end of the row. "Counted over the latest 6 reports in the history."
- **Aletheia**, docked on the right, as on every screen.
- **The sentence**: "6 reports made, 2 of 3 schedules are on. Reports are built from stored runs, so a number in a report matches the run it names."
- **Create a report** and **Schedule a report**.
- **Reports**: report, run ("Run of 16 Oct 2026"), format (PDF or XLSX), created, by, size and **Download**. The rule catalogue is "Not tied to a run".
- **Schedules**: "Each builds a report from the latest run and sends it." Report and format, cadence ("Every Monday at 07:00 (Africa/Johannesburg)"), recipients, next run and last result (**Delivered**, **Partly delivered**, **Failed** or "Not run yet"), and **Paused** for a paused schedule.

## Create a report

Choose the report, the run it is built from ("Built from the run you choose") and, optionally, one object. The report is built by a worker and appears in the list when it is ready.

## The schedule inspector

Open a schedule for its facts (next run, last run and its result), then: name, report (Board pack (PDF), Analyst workbook (XLSX), Analysis report (PDF), Trend report (PDF), Rule catalogue (PDF)), **Which run** ("The latest finished run", "The latest file upload" or the latest run of one system), an optional object, the cadence (every day, week or month, the day and the time in the tenant's time zone), the recipients (people of the tenant and the alert channels that take reports) and **Schedule is on**. Actions: **Save the schedule**, **Pause**, **Run it now** ("It is built on the worker and delivered to the recipients; the next scheduled run is unchanged.") and **Delete** ("No more reports are built or sent from this schedule. Files it already made stay in the list.").

## Export centre

The export centre sits in Reports, under **Export centre**, for people with the export permission. It writes any of these datasets to a file: findings by rule, object and run; failing records with the reason each one fails; cleansing proposals; approved changes with the value before and after; score history; the rule catalogue; and the audit log.

- **Format**: XLSX, CSV or JSON for every dataset, and PDF where a report already exists for it (the PDF is the existing report, so the column, severity and run choices do not apply to it).
- **Filters**: the system (every system, file uploads or one system), the object, the run (the latest or every run) and the severity, where the dataset has one.
- **Columns**: tick the columns you want, in the order shown; at least one stays ticked. Every code column carries its description beside it.
- **Sheets**: an XLSX file can put everything on one sheet or one sheet per object, severity or run. CSV and JSON are always one file.
- **Run export**: the file is built on the worker and the progress shows as it reads, writes and stores. When it is ready, **Download** saves it, and it joins the Reports list, where it can be downloaded again later. If the worker retries an export, it reuses the file it already stored rather than writing a second one.
- **Schedule this export**: give it a name, a cadence (daily, weekly on Monday or monthly on the 1st) and a time in the tenant time zone, then choose people to email, the server folder, or both. Email goes out through the notification settings the administrator already configured. The server folder is the `REPORT_EXPORT_DIR` setting of the deployment; when it is not set, folder delivery is not available.

Cells that begin with `=`, `+`, `-` or `@` are written so that a spreadsheet does not run them as formulas.

## Export what is on screen

Every table and grid has an export button above it. It writes exactly what you see: the rows that pass the current filters, in the current sort, with the visible columns, as XLSX or CSV. A code column gets its description in the column beside it.

## The numbers and where they come from

Every figure in a report is read from the run it names, so the board pack of 16 Oct says what the landscape said for that run. Money is in the tenant currency from the run's cost model. Alerts and channel messages carry counts, rule ids and links, never record values.

## What you can do, by role

- **Programme lead, analyst, admin** (export): create, schedule, run now, pause, delete, and use the export centre. The server refuses an export without the export permission.
- **Everyone with view**: download reports. "Creating and scheduling reports needs the export permission."
- **Administrator**: add the channels that can receive reports under Administration, Alerts.

## Keyboard

- `j` and `k` move through reports and schedules, `Enter` opens a schedule.
- `Esc` closes the inspector.

## When something is wrong

- **"No report has been made yet. Create one from a run, or schedule one to arrive on its own."**
- **"No one can receive reports yet."** Invite people, or add an email or Teams channel under Administration, Alerts.
- **Partly delivered**: one recipient or channel refused it. Check the channel under Administration, Alerts; email needs an email backend, which Administration, Platform and updates reports under Health checks.
- **Failed**: open the schedule and choose **Run it now** after fixing the channel; the job appears under Runs, Jobs.
