# Post-clean monitoring

Cleaning a record is not the end of the job. Monitoring, under Work, shows whether records that a batch fixed stay fixed, and which rules keep pulling them back. Open it from the Monitor tab at the top of the Work ledger.

## What is on it

- **Per system.** One row per connected system with the score then (the run before the clean), the score now, the change, how many records have failed again and how many were fixed since.
- **Failing again after a clean, by week.** A weekly bar chart over the last twelve weeks: records that failed again after a batch fixed them, set against records that were fixed again.
- **Drift by rule.** The rules whose records fail again most often, with the count for each. Open a rule to see which records came back and why.
- **Still clean, by batch.** Each approved batch with the records it fixed, how many are still clean and how many have failed again.

## The numbers and where they come from

Every figure comes from the record issue history that each run writes, joined to the remediation items of approved batches. A record counts as failing again when a run after its batch finds the same rule failing on it. Nothing is estimated: if no run has followed a batch yet, the screen says there is nothing to monitor.

## What you can do, by role

- **Data stewards and owners** open the drifting rules and send the records back to the ledger.
- **Programme leads** watch the weekly chart to see whether cleaning holds before a wave gate.
- **Auditors** read the still-clean table as evidence that approved fixes persisted.

## Keyboard

- `⌘K`, then "monitor", opens this tab.
- `Tab` moves between the tables; `Enter` on a rule or a batch opens it.

## When something is wrong

- **"Nothing to monitor yet."** No run has finished since a cleaning batch was loaded. Run the system once the load is in SAP.
- **A rule keeps coming back**: the source process creates the bad value again. Fix the process or the interface that writes the field, not only the records.
- **"The monitor could not be read."** The API did not answer. Check the system health, then reload.
