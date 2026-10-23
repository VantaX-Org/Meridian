# Fix

Fix turns failing records into reviewed corrections and hands them to SAP as files. Stewards accept proposals, a second person approves and exports, and the next run checks whether each fix held.

Open it from the **Fix** pill in the index bar. The pill shows only to roles that can approve or apply fixes (Admin, Manager, Steward and Approver), with a live count of waiting work.

## What you see

The page header reads **Fix**, "Review proposals, approve batches and hand them to SAP". Below it are four tabs: **Cleaning queue**, **Batches**, **Monitor** and **Duplicates**. **What-if** is a separate page under Fix.

## Cleaning queue

A cleaning proposal is a suggested new value for a failing record. The queue groups proposals by batch and rule, so each row is one decision: review this rule's fixes in this batch. Rows with the most records come first.

The figures above the table are **Records with a proposal** (with the number of rules and batches) and **At 85% confidence or higher**, the records ready to accept.

The columns are **Object**, **Rule**, **Records**, **Confidence** (the mean confidence of the group), **Proposed value**, **Batch** and **Review**. The proposed value is the most common one in the group, in monospace, with the field it changes beside it. Hover over it to see the old value and the new one.

The export menu offers **Approved fixes (.xlsx)** and **Approved fixes (.csv)**.

## How to review a cleaning batch

1. In **Cleaning queue**, select a row or its **Review** link. The batch page opens, titled with the batch id.
2. Read the figures: **Records**, **Mean confidence** and **At 85% or higher**.
3. The table lists each proposal with **Record**, **Rule**, **Proposed value**, **Confidence** and **Status**, most confident first.
4. Select **Approve** or **Reject** on each row. A rejection is recorded with the reason "steward rejected".
5. To approve in bulk, select **Accept N at 85% or higher** at the top.

The bulk button approves up to that many waiting proposals, highest priority first, and only those from rules whose automation level is set to automatic. Approve the others one by one.

The batch page also has **Related**, **History** and **Audit** tabs. **Audit** lists every approval, rejection and change with **When**, **Who**, **Action** and **Record**. If your role can export, the export menu offers the approved fixes of this batch as .xlsx or .csv, and **PDF cleaning report (all batches)**. That report covers the whole tenant, not only this batch: proposals by object, rules applied, the audit trail, fix batches, proposed values, record-level fixes and duplicate candidates.

Approving and rejecting need the approve permission (Admin, Manager, Steward and Approver). Without it, **Approve** is greyed out and its tooltip names the role you need, with a **Request access** link.

## Fix batches

A fix batch is a set of record-level corrections that move together. It has three states:

1. **Draft**: proposals are still being reviewed.
2. **Approved**: a second person has signed it off.
3. **Exported**: the load file has been produced.

Batches are drafted from several places. Creating one needs the apply permission (Admin, Manager and Steward).

- A run comparison: **Create fix batch** on a rule that newly fails, or **Create fix batches** for several (see [Runs](/docs?page=runs)).
- **What-if**: **Create fix batch from this simulation**.
- A migration wave: **Create fix batch** on the **Blockers** or **S/4 areas** tab (see [Migration](/docs?page=migration)).
- The monitor, which drafts a batch of regressed records on its own.

A batch holds at most 50,000 records.

### The Batches tab

A notice at the top sums up monitoring, for example which systems regressed since their baseline, with **Open monitor**. Three figures follow, and each filters the list:

- **Draft batches**.
- **Waiting for export**: approved, not exported yet.
- **Still failing after export**: exported records that fail again.

Under them are a **Search** box and status buttons (**All**, **Draft**, **Approved**, **Exported**, each with its count). The table shows **Batch**, **Status**, **Items**, **With proposal**, **Auto-approvable**, **Fixed**, **Still failing** and **Created**. Once a batch is exported, **Before vs after** opens the comparison of the latest run with the run the batch was cut from. Select a row or **Review** to open the batch in a side panel.

### The batch panel

The panel lists the batch's status, item counts, who created and approved it, and when it was approved and exported. Below the buttons are:

- **Items**: **Record**, **Field**, **Current**, **Proposed**, **Source** (Rule, Steward, Manual, Cleaning or Simulation), **Confidence** (High, Medium or Low), **Accepted**, **Reconciled** and **Updated**.
- **Before and after**: each changed field as `TABLE.FIELD` with its old and new value.
- **Exported files**: each file produced, its format, who exported and approved it, and the start of its SHA-256 fingerprint. Hover to see the whole fingerprint, so you can check the file you load is the one Meridian produced.
- **History**: Drafted, Proposal changed, Accepted, Approved, Exported and Reconciled events, with who and when.

## How to approve and export a batch

1. Open the batch from the **Batches** tab.
2. To change a proposed value, select it in the **Proposed** column, type the new value and press `Enter`. `Escape` cancels. You can edit only while the batch is a draft and the proposal is not yet accepted.
3. Select **Accept N high-confidence proposals** to accept every auto-approvable item at once. An item is auto-approvable when a rule proposed it with high confidence and it has a value.
4. Select **Approve batch**. A card reminds you that Meridian never posts to SAP and approval is Meridian's record only. Select **Approve**, or **Not now**.
5. When the batch is approved, select **Export batch**.
6. Choose the **Export format** and select **Export**.

The formats are:

- **Migration Cockpit workbook (xlsx)**
- **Migration Cockpit CSV**
- **Mass change CSV**
- **Migration Cockpit object templates (xlsx)**
- **MM17 / XD99 / XK99 mass maintenance (zip)**
- **MDG change request file (json)**, which asks for a **Change request type**

Items without a proposed value are not exported. They stay with the steward for a manual correction.

### Four eyes

A batch always needs two people:

- The person who drafted a batch cannot accept its proposals, approve it or export it.
- In a batch the monitor drafted, the person who accepted the proposals cannot also approve it.

Accepting and approving need the approve permission. Exporting needs the export permission (Admin, Manager, Steward, Analyst, Approver and Auditor). Editing a proposed value needs both approve and apply (Admin, Manager and Steward).

## How fixes reach SAP

Meridian does not change SAP on its own. An exported batch is a file that your team loads through its own controlled process, such as the Migration Cockpit or a mass change transaction.

Live write-back is a separate, optional route. It is off unless your administrator turns it on for the deployment. Write-back requests appear in the [Inbox](/docs?page=inbox) under **Approvals**, where a different person from the requester must approve each one. While write-back is off, that tab says so and asks you to export the fixes and load them in SAP. Even when it is on, Meridian only sends a fix whose SAP field mapping has been verified for that object. Any other fix is refused with a message to load it through a fix batch instead.

## Reconciliation

After a batch is exported, the next run of the same system (or the next imported file, for imported data) checks each exported record again. Only runs that finish after the export count. The **Reconciled** column then shows:

- **Fixed**: the rule ran cleanly and the record was present and passed.
- **Still failing**: the record is still among the rule's failing records.
- A dash: not reconciled yet, because the rule did not run or the record was not in the data.

The batch list adds up **Fixed** and **Still failing** for exported batches, and **Still failing after export** totals them across all batches.

## Monitor

The **Monitor** tab watches every system with a pinned baseline: a run you mark as the cleaned state after a clean-up. Each system has a card with a pill: **Holding**, a count of rules that regressed, or **Stale check** if it was not checked in over 36 hours.

Each card shows **Baseline score**, **Latest score** with its change, **New failing records**, **Resolved since baseline** and **Regressed rules**, each linking to the run comparison. A table lists each regressed rule with its severity and new failing records. Regressed records are drafted into a fix batch for you, with a link to it.

The card also shows the re-check schedule, with **Set a schedule** or **Change**. **Re-check now** starts an extraction (needs the trigger sync permission). **Pin latest as baseline** makes the latest run the new baseline (needs the analyse permission).

## Duplicates

The **Duplicates** tab lists candidate pairs with **Object**, **Record A**, **Record B**, **Match**, **Method** and **Status**. It is read-only. Merging happens in [Master data](/docs?page=mdm).

## How to use What-if

What-if applies every rule fix to a copy of a run and shows the score before and after. Nothing is written to your system.

1. Open [What-if](/fix/what-if).
2. Choose the **Analysis run**. It defaults to the run in the address, or the newest finished run.
3. Select **Run simulation**. This needs the analyse permission (Admin, Manager, Steward and Analyst).
4. Read the summary sentence and the figures: **Score before**, **Score after**, **Findings resolved**, **Findings introduced**, **Cells changed** and **Records fixed**.
5. **Score change by object** shows how each object moves the score.
6. Two tables follow: **Rules changed by the fixes** and **Side effects**. Each lists **Rule**, **Object**, **Field**, **Result**, **Failing before**, **Failing after**, **Records resolved** and **Records introduced**. Select a rule to see each record's current and simulated value.
7. To keep the fixes, select **Create fix batch from this simulation**, name the batch and select **Create fix batch**. The batch starts as a draft on the **Batches** tab. This needs the apply permission.

## Good to know

- "No cleaning proposals" means no run has found values a rule can correct yet.
- "No batches" means nothing has been drafted. Batches come from the places listed above.
- "Nothing is being monitored" means no baseline is pinned. Pin one from [Runs](/runs) after a clean-up.
- A simulation result is kept for 24 hours. After that, "This simulation has expired. Run it again."
- **Before vs after** is greyed out until a run has finished since the export.

## Related

- [Inbox](/docs?page=inbox)
- [Runs](/docs?page=runs)
- [Migration](/docs?page=migration)
- [Master data](/docs?page=mdm)
- [Roles and permissions](/docs?page=roles)
