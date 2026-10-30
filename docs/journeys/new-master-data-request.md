# Journey: new master data request (target, being built)

**Status: target, being built.** This journey describes the change request feature that a workflow engine is being
built for. None of its screens exist at v0.0.542. The steps, addresses and controls below are the target the build is
measured against; the names are proposals and change with the build. Today the request lives outside Meridian (an
email, a form or a ticket) and only the result is measured, by the next run.

- **Roles**: requester (anyone with a Meridian account who needs master data, for example a buyer or a sales
  administrator); approvers by workflow step (data owner of the object, finance for accounts and bank data,
  compliance where a policy class applies); data steward (completes and checks the request); SAP (the create, through
  live write-back or a load file).
- **Trigger**: someone needs a new material, customer, vendor or business partner, or an extension of one (a new plant,
  sales organisation or company code).
- **Done**: the record exists in SAP with the values approved, the request shows the SAP number and the SAP RETURN
  messages, and the next run reads the new record and passes every rule that applies to it; the requester was told at
  each step.
- **Target**: the requester submits in 5 minutes and 6 clicks; a standard request is created in SAP in 1 working day;
  every approver acts in 2 clicks from the notice.

## Target steps

| # | Who | Target address | Target control | Result |
|---|---|---|---|---|
| 1 | Requester | `/requests/new` (from the command line, "New request", or a **New request** button on the object) | Choose the object (Material master, Customer, Vendor, Business partner) and the template | A form of the fields the template needs, each with its SAP field (`MARA-MTART`) and possible values |
| 2 | Requester | same | Fill the fields; Meridian checks each value against the object's rules as it is typed (the same deterministic rules as a run) and searches for duplicates (match and merge) | Rule failures shown before submit; likely duplicates with their match score |
| 3 | Requester | same | **Submit request** | `/requests/{id}`: the request, its workflow steps and who acts next |
| 4 | Steward | Inbox notice, then `/requests/{id}` | Complete the fields only a steward knows; **Send for approval** or **Send back** with a reason | The request moves to its first approval step |
| 5 | Approvers, step by step | Inbox notice and email, then `/requests/{id}` | **Approve** or **Send back** with a reason; four eyes: the requester and the steward never approve their own request | Each decision on the request's trail |
| 6 | Last approver, or the steward | `/requests/{id}` | **Create in SAP**: with live write-back, simulated first and committed only when SAP's RETURN holds no error; otherwise a load file | The SAP number and the RETURN messages on the request |
| 7 | Next run | (no screen) | The scheduled extraction | The record is read and scored; the request reads "Verified on run ..." or names the rules it fails |

## Decisions

- **Duplicate found**: the requester extends the existing record instead (a new plant or sales area), or explains why
  a new one is needed; the steward decides.
- **Rule failure at submit**: the requester fixes the value, or submits with the failure named for the steward to
  resolve.
- **Approval route**: the workflow chooses the steps from the object, the organisational scope (company code, plant,
  sales organisation) and the policy classes the fields fall in (for example SOX vendor bank data adds a finance
  approval).
- **Create path**: BAPI where live write-back covers the object and system, load file otherwise, with the reason per
  field (as for fix batches today).

## Target hand-offs

| From | To | What | How they hear |
|---|---|---|---|
| Requester | Steward | A new request | Inbox notice and the steward's start-screen next step |
| Steward | Approver | Ready for approval | Inbox notice and email; due date from the SLA of the step |
| Approver | Requester, steward | Sent back, with the reason | Inbox notice and email |
| Last approver | Requester | Created in SAP, with the number | Inbox notice and email |
| Next run | Requester, steward | Verified, or failing rules | Inbox notice |

## What the build must avoid (from today's friction)

The [friction audit](friction-audit.md) found hand-offs in the fix-batch journey that tell nobody (a batch waiting, a
batch sent back, a file to load). The request journey must notify every hand-off above, show the verification of the
next run on the request itself, and never mark something as created in SAP when only a file was produced.
