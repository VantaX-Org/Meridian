# Journey: find, fix, approve, send

The core loop of the product: a steward decides the right values for failing records, a second person approves them,
the values go to SAP, and the next run confirms each record as **Fixed**. The four-eyes rule has no bypass: whoever
drafted a batch cannot approve it or send it.

- **Roles**: data steward (apply), data owner (approve), the SAP load team when live write-back is off (outside
  Meridian), the next run (scheduled, no person).
- **Trigger**: a run finishes with records to fix. The steward sees it as the next-step button **Accept the suggested
  values** on the Landscape, an **SLA at risk** or **Data quality** notice in the inbox, or the weekly digest.
- **Done**: every record of the batch reads **Fixed** after the next finished run; those still failing are back in
  **To fix** with their history.
- **Target**: steward 10 minutes and 5 clicks for a rule's worth of suggested values; owner 5 minutes and 4 clicks
  from sign-in to sent; 2 working days from the run to "Fixed" (measured: see the
  [friction audit](friction-audit.md#measured-clicks-against-targets)).

Record states, in order: **To fix**, **Fix proposed**, **Waiting for approval**, **Approved**, **Sent to SAP**,
**Fixed**; exceptions **Not an issue** and **Accept risk**.

## 1. Steward: find

| # | Address | Control | Result |
|---|---|---|---|
| 1.1 | `/` | **Accept the suggested values** (next-step button) | `/work`, all objects, ranked by value at risk ([F11](friction-audit.md#findings)) |
| 1.2 | `/work` | Read the sentence ("25,712 records to fix, 3,418 with a suggested value.") and the top rows; or **By rule** to decide a whole rule | The rows to decide |

Alternatives: an inbox notice (**Open the ledger**), the object's **Records** tab
(`/o/{system}/{object}/records`), or the rule canvas **Failing records** (`/r/{id}?tab=failing`).

## 2. Steward: fix

| # | Address | Control | Result |
|---|---|---|---|
| 2.1 | `/work` | **Accept the 112 suggested values** ("for MM142, the rule with the most at risk") | The confirmation bar: "Accept 112 suggested values for MM142? Enter confirms, Escape keeps the rows as they are." |
| 2.2 | same | `Enter` | Notice "Accepted 112 suggested values for MM142" with **Undo**; the chips move: **To fix** down, **Waiting for approval** up |
| 2.3 | `/work?filter=approvals` | **Waiting for approval** chip | The rows grouped by batch, with the steward's draft batch |

Other ways to fix:

- **One record**: `Enter` on a row opens `?open=record:...`; type the **New value**, `Enter`.
- **A selection**: `x` or the checkboxes, then `a` (accept), `n` (not an issue), `r` (accept risk), or **Value for
  all selected rows**; `⌘D` fills down.
- **Offline**: **Export fix sheet** (`e`), fill **New value** and **Decision** in Excel (leaves Meridian), then
  **Import filled sheet**: "Meridian checks keys, SAP fields and values before anything changes."

**Decision**: fix, not an issue, or accept risk. A value outside the rule's possible values is refused. A sign-off
needs a reason.

**Hand-off steward to owner**: the values sit in the steward's draft batch, which is what the owner approves. Today
the owner hears about it only from their start screen ("2 batches wait for your approval", **Approve batch B-241**)
the next time they sign in, the **Waiting for approval** chip, or the weekly digest. Values decided in Work notify
nobody; a batch drafted through the fix-batch API tells only the people who watch its objects
([F06](friction-audit.md#findings)).

## 3. Owner: approve

| # | Address | Control | Result |
|---|---|---|---|
| 3.1 | `/` | **Approve batch B-241** (next-step button), or the inbox notice **Open the batch** | `/?open=batch:B-241`, the batch inspector |
| 3.2 | same | Read **Facts** (records, value at risk, due), **Records** ("`MARA-MEINS` STK to EA"; the first 50, **Open all 328 in the ledger** for the rest) and the **Approval trail** | The evidence |
| 3.3 | same | **Approve** ("Approving acts on the whole batch. You can take it back from the notice that follows.") | Notice "Approved batch B-241" with **Undo**; status **Approved** |

**Decision**: approve or **Send back** with a reason the steward reads in the batch inspector. A sent-back batch does
not notify the steward ([F07](friction-audit.md#findings)). An owner who is away has named a deputy under **Out of
office**; the batch inspector says who covers.

## 4. Owner (or another approver): send to SAP

Without live write-back (the default):

| # | Address | Control | Result |
|---|---|---|---|
| 4.1 | `/?open=batch:B-241` | **Send to SAP** | Notice "Sent to SAP, 328 records" with the file name and its SHA-256: "Load it into SAP with the Migration Cockpit." Status **Sent to SAP** ([F08](friction-audit.md#findings)) |
| 4.2 | SAP Migration Cockpit (leaves Meridian) | The SAP load team loads the file into the right client | The values in SAP |

With live write-back (`MERIDIAN_LIVE_WRITEBACK_ENABLED`, material master, customer, business partner, vendor through
the business partner):

| # | Address | Control | Result |
|---|---|---|---|
| 4.1 | `/?open=batch:{id}`, section **Live write-back** | **Check with SAP** (sends nothing) | Each field: **BAPI** (which one) or **Export** with the reason |
| 4.2 | same | **Send to SAP**, confirm the record count | Per record: SAP's RETURN messages of the test run and the commit; committed records read **Sent to SAP** |
| 4.3 | same | **Export load file** for the fields without a BAPI | A Migration Cockpit file for the rest (leaves Meridian) |

**Hand-off owner to SAP load team**: none in Meridian. The file is downloaded by the owner and passed on outside
the product ([F08](friction-audit.md#findings)).

## 5. The next run: verify

| # | Who | Address | Control | Result |
|---|---|---|---|---|
| 5.1 | Scheduler | (no screen) | The object's schedule extracts and analyses again | A new run |
| 5.2 | Steward | `/runs`, then the run, then **Compare** | **Runs** in the map, the run's date, **Compare** | `/run/{a}/vs/{b}`: per object New, Fixed, Worse, Better |
| 5.3 | Steward | `/o/{system}/{object}/runs`, or a record's **History** | The object's **Runs** tab | Fixed counts per run; per record every run and decision |

**Decision**: a record that still fails is back in **To fix**. Check the load reached the right client, then decide
again. The batch itself does not say how many of its records were confirmed ([F09](friction-audit.md#findings)).

## Hand-offs at a glance

| From | To | What | How they hear today |
|---|---|---|---|
| Run | Steward | Records to fix | Next-step button; SLA and data-quality notices; weekly digest |
| Steward | Owner | A batch waits | Owner's start-screen line and next step on next sign-in; weekly digest |
| Owner | Steward | Sent back, with a reason | Nothing; the steward finds it in the batch inspector |
| Owner | SAP load team | A load file | Outside Meridian |
| Next run | Steward, owner | Fixed or back to To fix | Ledger counts; run compare; no notice per batch |
