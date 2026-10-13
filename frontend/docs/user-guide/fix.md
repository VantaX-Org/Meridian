# Fix

Fix is where failing records become corrections you can load back into SAP.

## Cleaning proposals

A proposal is a suggested correction for a failing record, from a rule, a steward, a simulation or the cleaning engine. Each shows the old value, the new value and how confident the suggestion is. Accept the ones you trust and leave the rest.

## Batches

Accepted proposals are grouped into a batch. A batch moves through three states:

1. **Draft**, while proposals are still being accepted.
2. **Approved**, when an owner signs it off.
3. **Exported**, when the package has been produced for loading into SAP.

The tiles on the batches tab count draft batches, batches waiting for export, and exported records that were checked again and still fail. Open a batch to see its items and its history.

## Monitoring

After export, the next run checks the records again. Fixed records show as fixed. Records that still fail are listed, so a bad fix is caught rather than assumed.

## What-if

What-if lets you try a fix before you commit to it. Choose a rule and a correction, and Meridian shows how many findings it would resolve, how many it might introduce and how many cells it would change. Nothing is saved until you create a batch.

## Duplicates

The duplicates tab lists likely duplicate records so they can be merged instead of corrected one by one.

## Safety

Every change is recorded with who made it and when. Meridian prepares corrections; it does not write to SAP on its own.
