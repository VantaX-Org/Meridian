# Runs

A run is one analysis of your data: an extraction from a system, or an imported file, followed by the checks. Every figure in Meridian belongs to a run.

## Choosing a run

The run selector in the top bar sets the run for the whole page. It is stored in the address as `?run=`, so you can share a link that opens on the same run. The newest finished run is chosen for you.

## The runs list

Runs lists every run with its system, status, score and when it happened. Tiles at the top show the number of runs, the latest score and its change, and any failed runs. A line chart shows the score per run for one system.

## One run

A run page shows its blocking findings, affected records and, where it can be worked out, the cost at risk. Its tabs are:

- **Overview** lists the objects scored in the run.
- **Findings** lists every failing rule. Select one to open the finding drawer.
- **Steps** shows each stage of the run, so you can see where a failed run stopped and why.
- **Configuration matches** appears when the run was checked against the system's loaded configuration.

## Comparing two runs

Choose **Compare** to see what changed between two runs: which rules improved, which regressed, and which records moved from failing to passing. You can create a fix batch from the records that regressed.

## Progress

A running job shows a progress bar on its page and in the job tray at the top of every page. You can leave the page; the job carries on in the background.

## Naming a run

Give a run a label, for example "Pre-migration baseline", so it is easy to find in the selector.
