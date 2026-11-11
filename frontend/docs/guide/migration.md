# Migration

Migration shows whether your records would load into the new system, and what to fix first. Open it from **Migration** on the rail, or press g then i. Its address is `/migration`.

## What is on it

- **The steps**: Start an analysis, Fix what would not load, Load into the target, Check the result. The current step is marked.
- **The banner**: the verdict of the latest analysis. Starting an analysis only checks your records. The page updates by itself while it runs.
- **Gaps by kind**: why records would not load, grouped by the kind of problem, such as a value that is not in the check table.
- **Quality in the source and in the target**: a fold-out that compares the quality of each object before and after.
- **All analyses**: a fold-out that lists the analyses that have run, newest first. Select a date to open that analysis.
- **For the open analysis**: Gaps by kind, then **Load files** (records without blocking gaps, shaped for the target system, as CSV files or Excel), **Post-load reconciliation** (the load files compared with the target system after the load), **Field-level gaps** and **Records**, with a switch between records that would not load and records ready to load.
- **Field map**: how each source field maps to a target table and field, with the value mappings beside it.

## The workbook from the new system

The panel **Workbook from the new system** fills the new system's own workbook or load file from a finished run. It has three steps: choose the run and workbook, check what fits, export the data.

1. Choose a finished run, and the file the new system gave you. Excel (.xlsx, .xlsm, .xls, .xlsb), OpenDocument (.ods), Migration Cockpit XML (.xml), delimited text (.csv, .tsv, .txt, .dat) and ZIP files can be read.
2. Select **Check the workbook**. The check reads the workbook and exports nothing yet. The workbook itself is not kept. The one thing the check can change is the extraction, as step 5 explains.
3. Read the result: how many rows are ready and how many are held back, and how many sheets can be filled. A line under the result says which format the file was read as. A table lists each sheet with what it is filled from, the columns filled, the rows ready and the rows held back.
4. Where required columns have no data in the run, the panel names them: the new system will refuse those rows until the columns are filled. Fold-outs list the required columns with no data, the country-specific columns that were not checked, and a sample of the rows held back with the reason for each.
5. Where the workbook asks for columns the extraction does not fetch yet, Meridian adds them to the extraction of that source system, so the next run fetches them. This applies to SuccessFactors workbooks, and only to columns that name a plain property of the sheet's entity. The extraction checks each one against the source system's own metadata, so a column is learned, never invented. The panel says how many columns were added, and the fold-out **Columns added to the extraction** lists them.
6. To fetch the added columns now, select **Update the run**. It starts a new extraction and analysis of that system. When the new run finishes, choose it in step 1 and check the workbook again. Without the right to start extractions, the panel asks you to have someone who can start extractions update the run.
7. Export the data in the same format, as Excel or as CSV files. The export holds the ready rows in the workbook's own columns, and held rows on a Held back tab. In the same format, held rows travel in a separate file, and .xls, .xlsb, .xlsm and .ods files come back as .xlsx. Every export is recorded in the audit log. The workbook itself is not stored.

Without a finished run, the panel says so; a finished run is needed before the workbook can be filled.

## The template library

The panel **Template library** keeps the new system's load templates for each object, so the same template is filled from every run without uploading it again. It works for every object, not only SuccessFactors.

1. Choose the object. The list shows each kept template with its version, how many of its columns resolve to a field, and when it was last filled.
2. To keep a template, give it a name, choose the file (a Migration Cockpit workbook, a SuccessFactors import file, or any .xlsx or .csv) and select **Keep the template**. Uploading the same name again keeps a new version, and the column corrections of the previous version are carried over.
3. Where a column does not resolve, select **Map columns** and choose the field that column holds. Only fields of the object's own tables are offered, and a column left open is reported as absent. The column map is saved for your organisation.
4. **Check** fills the template from the latest finished run without exporting, and says how many rows are ready, how many are held back and how many approved cleansing values it applied.
5. **Fill from the latest run** downloads the template filled with the latest run's data. Approved cleansing (batches that are approved, awaiting load or exported) is applied first. Rows that fail a check go to a Held back sheet with the reason.
6. **Download a blank template** gives a workbook with one sheet per table and a Field List sheet. The Field List names every field the object's rules read, with its description, whether it is required, its check table and its allowed values. Fields come from the data dictionary, so no field is invented.
7. **Original** downloads the file as it was uploaded.

Uploading and mapping need the right to analyse. The downloads and the check need the right to export.

## What you can do, by role

The buttons depend on the role, and a button the role cannot use is not shown:

- **Start an analysis** and **Delete** on an analysis need the right to analyse. An analysis that is queued or running cannot be deleted.
- The panels **Workbook from the new system** and the load files need the right to export. They are not shown in a shared link or while viewing as another role.
- **Update the run** and **Extract the target system** need the right to start extractions. Without it, the workbook panel asks you to have someone who can start extractions update the run.
- **Run reconciliation** needs the right to analyse, and downloading its result needs the right to export.

A role that cannot read migration analyses at all sees "Your role cannot read the migration analyses."

## System comparison

System comparison pairs a source and a target system for one object, for example ECC production and S/4HANA for the material master. Open it at /system-compare. Each pair shows three scores: the source score, the score the migration analysis projects for the target, and the score measured on the target itself. When a score is missing, the screen says why, for example that the target has no completed analysis yet.

Compare now runs a comparison in the background. It reconciles the records of every table both systems extracted: how many records are in the source and in the target, how many match, how many are missing in the target and how many exist only in the target. Records are matched on the dictionary key of the table. When the target numbers records anew, set the key fields of the pair, for example the source MATNR against the target BISMT that holds the old number. Only fields from the system's dictionary are accepted.

For every matched record each field is compared. A value that differs only by leading zeros, case or spacing, a value mapping, a date format or a number format counts as equal after that change and is shown as such. Every other difference is listed in the difference grid, which you can filter by table, kind, field and text, and export to Excel or CSV with the descriptions beside the codes. Select a record to see the source and target values side by side. Up to 100 records per table and kind are kept for review; the counts always cover all records.

The comparison also checks configuration: organisational units, value lists and check tables read from the source are looked for in the target by key, by normalised key and by description. Why the scores differ lists the rules whose pass rate moved most between source and target, each linked to the rule. Scores over time draws the three scores across comparisons.

A table that cannot be compared says why: it was not extracted from one side, the extraction did not finish or holds only part of the table, or a key field is missing.

## The numbers and where they come from

Gaps by kind come from the latest analysis of your records against the target system. The workbook figures come from the finished run and the workbook you choose, and nothing is guessed.

## When something is wrong

- **The workbook could not be checked**: the page shows the reason in plain words. Check that the file is the one from the new system and try again.
- **Required columns still have no data after Update the run**: the new run must finish first. Choose the new run in step 1 and check the workbook again.
- **Rows are held back**: read the table of required columns with no data, and the reasons per row, then fix the source and run again.
- **No run has finished yet**: finish a run first. The workbook cannot be filled without one.

## Keyboard

- `g` then `i` opens Migration.
- `Esc` closes the topmost layer.
