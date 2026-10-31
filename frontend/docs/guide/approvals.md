# Approvals and exceptions

Every value decided in Work waits in a fix batch until a second person approves it. That is the four-eyes rule, and it has no bypass: whoever drafted a batch cannot approve it. Exceptions are records signed off without a change, as **not an issue** or **accept risk**, with a reason. Both live in the Work ledger, under their own chips: **Waiting for approval** and **Exceptions**. Open approvals from the command line by typing "approve", or at `/work?filter=approvals`.

## Waiting for approval

The sentence reads, for example, "612 records wait for approval: the values are in a draft fix batch that a second person approves." The rows are grouped by batch. Each batch heading names the batch (for example **B-241**, "Unit of measure and material type"), who built it, the records, the value at risk, the due date and the state, with **Approve** and **Send back** on the heading.

Open a batch to read it in the batch inspector:

- **Facts**: batch, name, status, owner, steward, created, due, records and value at risk.
- **Records**: each change as the SAP field and the pair of values, for example "`MARA-MEINS` STK to EA". The first 50 show in the inspector; **Open all 328 in the ledger** opens the rest.
- **Approval trail**: who drafted it and who proposed the values, with times.
- **Actions**: **Approve**, **Send back** (with a reason the steward reads), **Download sheet** and **Reassign…**. "Approving acts on the whole batch. You can take it back from the notice that follows."
- **Watch** and **Comments**.

## After approval

Approval does not touch SAP. It is Meridian's record that the values are right. The approved batch is exported as a load file for your SAP process, and records then read **Sent to SAP**. Where live write-back is switched on for the deployment (`MERIDIAN_LIVE_WRITEBACK_ENABLED`, material master, customer, business partner and vendor on ECC, S/4HANA on premise and EWM), an approved change can go to SAP through standard BAPIs instead: each record is simulated first and committed only when SAP's RETURN messages hold no error, those messages are kept per record, and each request needs someone other than the requester. A vendor goes live only where SAP holds it as a business partner with the supplier role (always on S/4HANA, on ECC where customer/vendor integration is active): its name, search term, address and bank account holder go through the business partner, and Meridian asks the system per record before anything is sent. Vendor company code and purchasing data, every vendor on a release without that integration, and every other object go out as a load file, each with its reason. Either way the work is not finished until a run says so: the next finished run reads the records again, and those that pass become **Fixed**. A record that still fails returns to **To fix**.

With live write-back switched on, the inspector of an approved batch (open it from **Work** or the inbox) carries a **Live write-back** section, and its load file button reads **Export load file**. **Check with SAP** comes first and sends nothing: a table lists each field of the batch with the record, whether it goes by **BAPI** (and which BAPI) or by **Export**, and the reason a field cannot go by BAPI. For vendor fields the check asks SAP which vendors are business partners there, so a vendor field reads **Export** with the reason when the system cannot take it. Then **Send to SAP**, for an approver who did not build the batch, asks once with the number of records and writes them: the summary says how many records were sent, how many failed and how many fields stay for the export, and a second table shows SAP's answer per record, each RETURN message of the test run and of the commit with its type, message class, number and text. Once SAP has committed a record the batch reads **Sent to SAP**; fields without a BAPI still go out with **Export load file**.

The record statuses, in order: **To fix**, **Fix proposed**, **Waiting for approval**, **Approved**, **Sent to SAP**, **Fixed**. Exceptions are **Not an issue** and **Accept risk**.

## Exceptions

The sentence reads "48 records are signed off as not an issue or an accepted risk." The columns change to **Resolution**, **Reason**, **Signed off by** and **When**, for example "Accept risk: Replaced by the new plant in wave 2; the risk is accepted until then". **Reopen** "Puts the record back to rows to fix. Needs the apply permission."

## The numbers and where they come from

- **The chip counts** are distinct records in each state in the latest run of each object in scope: "612 records wait for approval" counts records, not batches.
- **Records** and **Value at risk** on a batch are the records in it and their cost-model estimate, in the tenant currency.
- **Due** comes from the SLA days for the batch's worst severity, set under Triage and SLA.
- **Fixed** is set only by a run: a value waiting for approval, approved or sent to SAP never counts as fixed.

## Change requests

**Requests** in the map lists change requests: a request to create a material, customer, vendor or business partner in SAP, or to change one. The views are **Mine**, **To approve** and **All**, with filters by status, object and kind. Each row opens the request on the right (`?open=request:{id}`).

The banner on top says "Change requests". Its headline counts what waits ("3 requests wait for approval", or "No request waits for approval") and the line under it says whether any failed ("1 request failed to reach SAP and need a new look." or "Nothing has failed in this list."). Three figures: **Waiting** ("submitted or in approval"), **Failed** ("did not reach SAP") and **Drafts** ("not yet submitted"), all counted over the requests in the current view and filters. The one button is **New request**. Under the banner, **Requests per person** is a horizontal bar per requester, the eight with most requests, with "4 requests" at the end of the row. Aletheia is docked on the right.

- **New request**: choose the object and the kind, give the SAP key when you change a record, a title, and the fields, one `TABLE.FIELD=value` per line. **Check** saves a draft and runs the rule pre-checks and the duplicate search: failed rules link to the rule and likely duplicates to the golden record, with how alike they are. **Submit for approval** sends it into the approval workflow once the check shows no problem. Needs the master data write permission.
- **The request inspector** shows the proposed values, the checks, the approval steps with who decided each and when, the history, comments and attachments. The requester can cancel a request that is not finished; a request that failed in SAP can be retried once you have checked in SAP that the record does not exist; a request with a load file can be exported.
- **Your decision**: when a step waits for you, the inspector of the request shows **Approve**, and **Reject** with a reason the requester reads. The step, its due time and whether you decide on behalf of someone are stated.

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
