# Approvals and exceptions

Every value decided in Work waits in a fix batch until a second person approves it. That is the four-eyes rule, and it has no bypass: whoever drafted a batch cannot approve it. Exceptions are records signed off without a change, as **not an issue** or **accept risk**, with a reason. Both live in the Work ledger, under their own chips: **Waiting for approval** and **Exceptions**. Open approvals from the command line by typing "approve", or at `/work?filter=approvals`.

## Waiting for approval

The sentence reads, for example, "612 records wait for approval: the values are in a draft fix batch that a second person approves." The rows are grouped by batch. Each batch heading names the batch (for example **B-241**, "Unit of measure and material type"), who built it, the records, the value at risk, the due date and the state, with **Approve** and **Send back** on the heading.

Open a batch to read it in the batch inspector:

- **Facts**: batch, name, status, owner, steward, created, due, records and value at risk.
- **Records**: each change as the SAP field and the pair of values, for example "`MARA.MEINS` STK to EA". The first 50 show in the inspector; **Open all 328 in the ledger** opens the rest.
- **Approval trail**: who drafted it and who proposed the values, with times.
- **Actions**: **Approve**, **Send back** (with a reason the steward reads), **Download sheet** and **Reassign…**. "Approving acts on the whole batch. You can take it back from the notice that follows."
- **Watch** and **Comments**.

## After approval

Approval does not touch SAP. It is Meridian's record that the values are right. The approved batch is exported as a load file for your SAP process, and records then read **Sent to SAP**. Where live write-back is switched on for the deployment, an approved change can go to SAP through that route instead, and each request needs someone other than the requester. Either way the work is not finished until a run says so: the next finished run reads the records again, and those that pass become **Fixed**. A record that still fails returns to **To fix**.

The record statuses, in order: **To fix**, **Fix proposed**, **Waiting for approval**, **Approved**, **Sent to SAP**, **Fixed**. Exceptions are **Not an issue** and **Accept risk**.

## Exceptions

The sentence reads "48 records are signed off as not an issue or an accepted risk." The columns change to **Resolution**, **Reason**, **Signed off by** and **When**, for example "Accept risk: Replaced by the new plant in wave 2; the risk is accepted until then". **Reopen** "Puts the record back to rows to fix. Needs the apply permission."

## The numbers and where they come from

- **The chip counts** are distinct records in each state in the latest run of each object in scope: "612 records wait for approval" counts records, not batches.
- **Records** and **Value at risk** on a batch are the records in it and their cost-model estimate, in the tenant currency.
- **Due** comes from the SLA days for the batch's worst severity, set under Triage and SLA.
- **Fixed** is set only by a run: a value waiting for approval, approved or sent to SAP never counts as fixed.

## Out of office and escalation

- When an approver is away, their approvals go to the deputy they named under Preferences, Out of office. The batch inspector says so, for example "You cover for T. Mokoena until 30 Oct 2026: their approvals and assigned work come to you as well." Four eyes still holds: nobody approves their own batch.
- A batch past its due date is escalated by the escalation chain under **Triage and SLA** (see People and inbox).

## What you can do, by role

- **Data owner** (approve): approve or send back batches you did not draft; sign records off as exceptions.
- **Data steward**: draft batches, read their state, reopen exceptions; a steward who also holds approve can approve other stewards' batches, never their own.
- **Programme lead**: approve, reassign batches.
- **Auditor**: read batches, trails and exceptions as four-eyes evidence; export them.

## Keyboard

- `⌘K`, then "approve", opens the approvals.
- `j` and `k` move, `Enter` opens the batch or the row; `n` and `r` sign the selected rows off.
- `⌘Z` undoes an approval or a sign-off from the notice.

## When something is wrong

- **"No value is waiting for approval. Accepted and entered values land here until a second person approves them."** Nothing is pending.
- **Approve is missing on a batch**: you drafted it, or your role does not hold approve. Ask another approver.
- **"Sent to SAP" records come back as To fix**: the load did not take. Check the file was loaded completely, into the right client, and that the run you read finished after the load.
- **A sign-off is missing its reason**: the reason is required when you sign off; older records may show "The API does not send the reason yet".
