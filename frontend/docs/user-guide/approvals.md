# Approvals and export

Every value decided in Fix work waits in a fix batch until a second person approves it. The approved batch is then exported as a file your team loads into SAP, and the next run checks whether each record now passes. This chapter covers that second half of the work: four eyes, export formats, what the next run does, and the **Monitor** tab.

Batches are approved in one place, **Inbox**, **Approvals**, beside the SAP write-back requests (see [Inbox](/docs?page=inbox)). Data owners land there. The batches and their export live in **Fix work**, on the **Batches and export** tab, which links to the approvals with **Open approvals**.

## Four eyes

A batch always needs two people:

- The person who drafted a batch cannot approve it or export it. The panel says "Four-eyes required: a second person must approve this batch before it can be exported."
- In a batch the monitor drafted, the person who accepted its proposals cannot also approve it.

When a steward accepts suggestions or enters values in Fix work, they land in the steward's own draft batch, named "Fixes by" and the steward's name. A data owner, lead or another steward opens that batch and approves it. Approving needs the approve permission; exporting needs the export permission.

## What you see

A notice at the top sums up monitoring, such as which systems regressed since their baseline, with **Open monitor**. Three figures follow, and each filters the list:

- **Draft batches**: waiting for proposals to be accepted and approved.
- **Waiting for export**: approved, not exported yet.
- **Still failing after export**: exported records that fail again.

Under them are **Search batches** and the status buttons **All**, **Draft**, **Approved** and **Exported**. The table shows each batch with its **Status**, **Items**, **With proposal**, **Auto-approvable**, **Fixed**, **Still failing** and **Created**. Select a row to open the batch in a side panel.

The panel lists who created and approved the batch and when, then:

- **Items**: each record with its **Field**, **Current** and **Proposed** value, the source, the **Confidence**, whether it is **Accepted**, and **Reconciled** (Fixed or Still failing after the next run).
- **Before and after**: each changed field as `TABLE.FIELD` with its old and new value.
- **Exported files**: each file produced, with its format, who exported and approved it, and its fingerprint, so you can check the file you load is the one Meridian produced.
- **History**: every draft, change, acceptance, approval, export and reconciliation, with who and when.

## How to approve and export a batch

1. Open the batch: from **Inbox**, **Approvals** to approve it, or from **Fix work**, **Batches and export**. Both open the same panel.
2. Read the items. While the batch is a draft you can change a proposed value: select it, type the new value and press `Enter`.
3. To accept every high-confidence rule proposal at once, select **Accept N high-confidence proposals**.
4. Select **Approve batch**, then **Approve**. Meridian never posts to SAP; approval is Meridian's record that the values are right. **Not now** backs out.
5. Select **Export batch**, choose the **Export format** and select **Export**.

The formats are:

- **Migration Cockpit workbook (xlsx)**
- **Migration Cockpit CSV**
- **Mass change CSV**
- **Migration Cockpit object templates (xlsx)**
- **MM17 / XD99 / XK99 mass maintenance (zip)**
- **MDG change request file (json)**, which asks for a **Change request type**

Items without a proposed value are not exported. In Fix work, the records of an approved batch read **Approved**; once exported they read **Sent to SAP**.

## Loading into SAP

Meridian does not change SAP on its own. Your team loads the exported file through its own controlled process, such as the Migration Cockpit or a mass change transaction. The panel then reads "Exported. Load it with the Migration Cockpit or a mass-change template."

Live write-back is a separate, optional route that is off unless your administrator turns it on. Its requests wait under **Inbox**, **Approvals**, where someone other than the requester approves each one.

## What happens on the next run

The next run of the same system, or the next import of the same objects, checks every exported record again. Only runs that finish after the export count.

- A record that now passes becomes **Fixed** in Fix work, and its batch item reads **Fixed**.
- A record that still fails goes back to **To fix**. Its record panel warns: "This value was sent to SAP, but the latest run still finds the record failing. Check the load, or propose another value." The batch item reads **Still failing**, and the figure **Still failing after export** counts it.
- Until such a run, the item shows a dash.

Once a run has finished since the export, **Before vs after** on the batch opens the comparison of the latest run with the run the batch was cut from.

## Monitor

After a clean-up, pin the run that shows the cleaned data as the baseline. The **Monitor** tab then compares every later run with it, one card per system, with a pill: **Holding**, a count of rules that regressed, or **Stale check**. Each card shows **Baseline score**, **Latest score**, **New failing records**, **Resolved since baseline** and **Regressed rules**. Regressed records are drafted into a fix batch for you, and you are notified. **Re-check now** starts an extraction and **Pin latest as baseline** moves the baseline forward.

## Duplicates

Duplicate pairs are reviewed in one place, **Master data**, **Match review**: pairs from the match rules and from the cleaning engine side by side, with **Merge**, **Not a match** and **Skip**. Old links to Fix work's Duplicates tab open it. Merging needs the approve permission. To tune how pairs are found, see [Master data](/docs?page=mdm).

## Related

- [Fix work](/docs?page=fix)
- [Progress](/docs?page=progress)
- [Roles and access](/docs?page=roles)
- [Troubleshooting](/docs?page=troubleshooting)
