# Migration

Migration shows whether your records would load into the new system, and what to fix first. Open it from **Migration** on the rail, or press g then i. Its address is `/migration`.

## What is on it

- **The steps**: Start an analysis, Fix what would not load, Load into the target, Check the result. The current step is marked.
- **The banner**: the verdict of the latest analysis. Starting an analysis only checks your records. The page updates by itself while it runs.
- **Gaps by kind**: why records would not load, grouped by the kind of problem, such as a value that is not in the check table.
- **Quality in the source and in the target**: a fold-out that compares the quality of each object before and after.
- **All analyses**: a fold-out that lists the analyses that have run.

## The workbook from the new system

The panel **Workbook from the new system** fills the new system's own workbook or load file from a finished run. It has three steps: choose the run and workbook, check what fits, export the data.

1. Choose a finished run, and the file the new system gave you. Excel (.xlsx, .xlsm, .xls, .xlsb), OpenDocument (.ods), Migration Cockpit XML (.xml), delimited text (.csv, .tsv, .txt, .dat) and ZIP files can be read.
2. Select **Check the workbook**. The check only reads the workbook. Nothing is stored and nothing is exported yet.
3. Read the result: how many rows are ready and how many are held back, and how many sheets can be filled. A table lists each sheet with what it is filled from, the columns filled, the rows ready and the rows held back.
4. Where required columns have no data in the run, the panel names them: the new system will refuse those rows until the columns are filled.
5. Export the data in the same format, as Excel or as CSV files. The export holds the ready rows in the workbook's own columns, and held rows on a Held back tab. In the same format, held rows travel in a separate file, and .xls, .xlsb, .xlsm and .ods files come back as .xlsx. Every export is recorded in the audit log. The workbook itself is not stored.

Without a finished run, the panel says so; a finished run is needed before the workbook can be filled.

## What you can do, by role

Starting an analysis, checking a workbook and exporting each depend on the role. A button the role cannot use is not offered.

## The numbers and where they come from

Gaps by kind come from the latest analysis of your records against the target system. The workbook figures come from the finished run and the workbook you choose, and nothing is guessed.

## When something is wrong

- **The workbook could not be checked**: the page shows the reason in plain words. Check that the file is the one from the new system and try again.
- **Rows are held back**: read the table of required columns with no data, and the reasons per row, then fix the source and run again.
- **No run has finished yet**: finish a run first. The workbook cannot be filled without one.

## Keyboard

- `g` then `i` opens Migration.
- `Esc` closes the topmost layer.
