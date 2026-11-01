# Runs

A run is one measurement of your data at a point in time: an extraction from a system scored against the rules as they stood. Every score, failing record and report belongs to a run. **Runs** lists them on a timeline with their jobs, so you can see what ran, what failed and which run is the baseline. Open it from the map, with `g` then `r`, or at `/runs`.

## What is on it

- **The banner**: the small line says "Latest run" and the headline "Finished on 16 Oct 2026" ("No run has finished yet" before the first). The line under it says which way the data moved: "The average score rose by 2.1 points since the run before.", "did not change", or "A second run is needed to say whether the data got better or worse." when there is only one. The headline is marked at risk when the average fell. Three figures: **Runs shown** (with the baseline date or "no baseline set"), **Average score** ("out of 100") and **Took** for the latest run. The one button is **Start a run**, for people who may start an analysis.
- **The charts**: **Score over time**, the average object score over the last runs as a line ("Two runs are needed to draw a trend." until there are two), and **How long each run took**, a horizontal bar per run for the last eight, on one scale from zero. A long bar is a slow run; compare it with its records in the table.
- **Aletheia**, docked on the right: ask about the runs in plain words (see the Ask Meridian chapter).
- **The sentence**: "The timeline shows the last 8 finished runs, the latest on 16 Oct 2026. The baseline is 2 Oct 2026." Over the table, its own count: "9 runs in the table, 1 of them failed."
- **The run timeline**: one mark per run, the baseline labelled. Select a mark to open that run.
- **Runs and Jobs**: two views. **Start a run** opens the start panel.
- **Runs** table: date, system, label, trigger (Scheduled, Started by hand, or upload for a run made from a file), records, rules, score range across objects (for example "70.0 to 93.4"), status (Complete, Failed, Queued or running) and how long it took. Filter by system and status; **Show archived runs** brings back archived ones.
- **Jobs** table: every background job (extraction, analysis, configuration load, configuration sync, upload, simulation, process discovery) with its object, system, state, progress, start and duration.

## The job line and the job inspector

A running job shows as a thin progress line under the top bar, never a tray. Open it, or any job row, for the job inspector: its stages and tables with row counts, the percent, the error in plain words for a failed job (for example "OData refused credentials (HTTP 401). Check the client id and secret in the system settings.") and, where the job recorded how it started, **Retry**.

Every start form (Administration, Start and schedule; the system inspector's **Extract** and **Run analysis**; **Start a run** here) shows the prediction before you confirm: the duration band and how sure it is, the records it will check, the cost from the cost model's run cost (a dash when none is set) and where it would queue, for example "Position 2 in the queue; 1 running, 1 queued". A queued job says its place on the job line and in its inspector.

## The numbers and where they come from

- **Records** and **Rules** are the records checked and the rules measured in that run, across every object.
- **Score** is the lowest and highest shown score of the run's objects.
- **Took** is from the job registry: extraction and analysis timings are recorded by the workers.
- **The prediction** reads the tenant's last eight finished runs of each object: the median records, the median seconds per record, and a band from the 25th to the 75th percentile; with fewer than four runs the band is the lowest to the highest. Nothing is estimated by a language model.
- The baseline is the run you pinned; every comparison and "since the baseline" figure measures against it.

## What you can do, by role

- **SAP Basis and analyst** (trigger sync, analyse): start an extraction or an analysis, retry a failed job.
- **Anyone with analyse**: start a run ("Starting a run needs the analyse permission"), pin a baseline, archive older runs.
- **Anyone with export**: download a run's report.
- **Everyone**: read runs and jobs, open a run, compare two runs.

Starting runs, schedules and retries for one system at a time also live under Administration, **Start and schedule**: "Start an extraction, an analysis, a configuration load or an upload, and schedule them. The runs themselves are on Runs."

## Keyboard

- `g` then `r` opens Runs.
- `j` and `k` move through runs or jobs, `Enter` opens one.
- `Esc` closes the job inspector.

## When something is wrong

- **A run reads Failed with no records**: open its job. Connection errors (HTTP 401, RFC logon failures) belong to SAP Basis; the job says which credential or table failed.
- **A run is complete but scores are missing for an object**: the extraction read no records for it, or the analysis skipped its rules. Open the object; its receipt says how many rules produced a result.
- **Retry is missing**: the job did not record how it started; start it again from the system or from Administration, Start and schedule.
- **The job line shows nothing but a job is running**: the job registry updates every few seconds; reload the page if it does not appear within a minute, then ask your administrator to check Platform and updates.
