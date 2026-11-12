# Runs

A run is one measurement of your data at a point in time: an extraction from a system scored against the rules as they stood. Every score, failing record and report belongs to a run. **Runs** lists every run of every system, so you can see what ran, what failed and what changed. Open it from the rail, with `g` then `r`, or at `/runs`.

Run numbers restart for each system, so outside a system's own page a run is always named with its system: "ECC production run 12". What the product calls the current state is each object at its own newest finished run, not one latest run for everything.

## What is on it

- **The sentence**: "Every run of every system, newest first within each system. Open a run to see what it scored, or compare it with the one before to see what changed."
- **The banner**: the small line says "Latest run" and the headline "Finished on 16 Oct 2026" ("No run has finished yet" before the first). The line under it says which way the data moved: "The average score rose by 2.1 points since the run before.", "did not change", or "A second run is needed to say whether the data got better or worse." when there is only one. Three figures: **Runs shown** (with the baseline date or "no baseline set"), **Average score** ("out of 100") and **Took** for the latest run. The one button is **Start a run**, for people who may start an analysis, with the reason beside it.
- **The charts**: **Score over time**, the average object score over the last runs as a line ("Two runs are needed to draw a trend." until there are two), and **How long each run took**, a bar per run on one scale from zero. A long bar is a slow run.
- **Runs and Jobs**: two views.
- **The runs ledger**: one group per system, active systems first, each headed by its name and its count, for example "9 runs, 1 failed". A system that is no longer active keeps its runs, marked Inactive, and they still open. Each group has a date axis with one square per run, then a table: run, status, records checked, objects scored, score range across objects (for example "70.0 to 93.4"), how long it took, and **Compare with previous** on every run but the first of its system. Filter by system and status; **Show archived runs** brings back archived ones.
- **Jobs** table: every background job (extraction, analysis, configuration load, configuration sync, upload, simulation, process discovery) with its object, system, state, progress, start and duration.
- **Trend per object**: small charts, one per object, of the score across runs.

## The job line and the job inspector

A running job shows as a thin progress line under the top bar, never a tray. Open it, or any job row, for the job inspector: its stages and tables with row counts, the percent, the error in plain words for a failed job (for example "OData refused credentials (HTTP 401). Check the client id and secret in the system settings.") and, where the job recorded how it started, **Retry**.

Every start form (Administration, Start and schedule; the system inspector's **Extract** and **Run analysis**; **Start a run** here) shows the prediction before you confirm: the duration band and how sure it is, the records it will check, the cost from the cost model's run cost (a dash when none is set) and where it would queue, for example "Position 2 in the queue; 1 running, 1 queued". A queued job says its place on the job line and in its inspector.

## The numbers and where they come from

- **Records** and **Rules** are the records checked and the rules measured in that run, across every object.
- **Score** is the lowest and highest shown score of the run's objects.
- **Took** is from the job registry: extraction and analysis timings are recorded by the workers.
- **The prediction** reads the tenant's last eight finished runs of each object: the median records, the median seconds per record, and a band from the 25th to the 75th percentile; with fewer than four runs the band is the lowest to the highest. Nothing is estimated by a language model.
- The baseline is the run you pinned; every comparison and "since the baseline" figure measures against it.

## Column types and trust of an uploaded file

A run made from an uploaded file or an external database (anything that is not an SAP extraction) shows **Column types and trust** on its run page, under the shape of the run. Meridian reads up to 20,000 rows of the file and, for each column, checks the values against fixed detectors: IBAN (ISO 13616 mod-97), EU VAT number (member state layout), email address, web address, date, phone number (E.164), postal code, country code (ISO 3166), amount and person name. The values decide: a column needs 80% of its values in a type's shape (60% when its header names the type, which also adds to the confidence). A postal code and a person name are only detected on a column whose header says so. Only the share of values that match each type is kept, never a value itself, and nothing goes to a language model.

- **Column types**: each column with its detected type, the **Confidence** (the share of values in the type's shape, lowered for a column with fewer than 20 filled values), **Filled** (the share of non-empty values), **Conforms** (the share of filled values that match the type in force) and **Type in force**. Choose a type in the select to confirm it, or **No type** to override a wrong guess. A detected type stays "not confirmed" until someone chooses. Confirming needs the upload permission, and every change is in the audit log.
- **Trust score**: one number out of 100 for the dataset, from four weighted parts: the run's data quality score (40%), type conformance across typed columns (25%), freshness (15%: 100 for data loaded in the last day, falling to 0 at 90 days) and completeness across all columns (20%). A missing part gives its weight to the others, so a file with no typed column is scored on the other three.
- **Rules suggested from confirmed types**: the rules each confirmed type implies, for example "IBAN passes the ISO 13616 mod-97 check" for a confirmed IBAN column, and a postal code format rule tied to the confirmed country column. Only confirmed types suggest rules. **Open rules to add them**.

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
