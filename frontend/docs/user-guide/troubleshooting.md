# Troubleshooting

This chapter lists the problems people meet most often in Meridian, the message you see and what to do. The fix work problems come first. Some fixes need an administrator; each section says so.

## No finished run yet

Fix work reads "No finished run yet" and Progress reads "Nothing to track yet" when no run has finished analysing.

1. Open **More**, **Analysis**, **Runs** to see whether a run is still going.
2. If there is no run at all, connect a system under **Data in**, **Systems**, or load a file with **Import file** (see [Data in](/docs?page=data-in)).
3. If a colleague sees records you do not, your access may be scoped to some systems or objects. Ask an administrator to check your grants.

## The work list is not built for this run

Fix work reads "This run's work list is not built yet", and an object's **Records to fix** tab reads "The work list for this run is not built yet". Runs analysed before the work list existed, or whose build failed, have none.

1. If your role can run analyses, select **Build the work list**. It takes a few minutes for a large run; the records appear when it finishes.
2. Otherwise, ask an analyst or a steward to build it. Until then the object's **Overview** and **Rules** tabs show what fails.
3. Or choose a newer run in the scope bar: every new run builds its work list as part of the analysis.

## I cannot see Fix work

The **Fix work** pill appears only for roles that can apply fixes or approve them: Platform admin, Programme lead, Data steward and Data owner. An analyst, Basis administrator, auditor or viewer does not see it.

- You can still open any object's **Records to fix** tab and read each record. The panel says "Your role can view this record. Fixing it needs the apply permission."
- Ask an administrator for the Data steward role, or use **Request access** where a button offers it. See [Roles and access](/docs?page=roles).
- If you see Fix work but not **Accept**, **Enter value** or **Take it**, your role approves but does not fix. If you see the values but not **Not an issue**, your role fixes but does not approve.

## I cannot approve my own batch

"The batch creator cannot approve it" and "The batch creator cannot export it" are the four-eyes rule at work. Your decisions go into your own draft batch, and a second person with the approve permission must approve it. Ask your data owner or another steward. See [Approvals and export](/docs?page=approvals).

## A value I sent still fails

The record panel reads "This value was sent to SAP, but the latest run still finds the record failing. Check the load, or propose another value." The record is back on **To fix**.

1. Check that the exported file was loaded into SAP, completely and into the right client. The batch's **Exported files** list gives each file's fingerprint.
2. Check that the run you are viewing finished after the load. Only runs that finish after the export reconcile.
3. If the load went in, read the issue's instruction and **Why it matters** again: the value may pass one rule and fail another, or SAP may have overwritten it. Enter another value, and it goes through approval again.
4. If the same records keep coming back, look at **Problems that come back** on [Progress](/docs?page=progress): the cause is probably upstream.

## My records list is empty

"Nothing left to fix" means every failing record in the run has a decision. "No records match these filters" means a filter hides them: select **Clear filters**. Check the **Status** filter too; it shows **Still open** records by default.

## The fix sheet will not import

Meridian reads only a sheet it exported. "No 'Fix sheet' sheet" or "The sheet's columns were changed" means the file was built by hand or its headers were edited: download a fresh fix sheet. Rows are skipped, and listed, when the **Decision** is not `fix`, `not an issue` or `accept risk`, when a sign-off has no **Reason**, or when the record no longer fails in the run. A file holds at most 5,000 decisions and 25 MB.

## A system shows Unreachable or Sign-in refused

Open the system's **Health** tab and select **Test connection**. **Unreachable** means the server could not reach SAP: check with your network or SAP team. **Sign-in refused** means SAP rejected the user: someone who manages systems updates the credentials.

## A run failed

Open the run from **Runs** and choose **Steps**. Each step shows its status, duration and error. Fix the cause, then select **Re-run analysis**. A run that stays running for a long time usually means the background workers have stopped: a server administrator checks them with `docker compose ps worker` and restarts them with `docker compose restart worker`.

## The score looks capped

One critical rule failing over tolerance caps an object at 85, two or more at 70. Work the critical records first: in Fix work, select the **Critical** figure.

## How to report a problem

Open the help menu (**?**), choose **Report a problem**, select **Copy details** and paste them into an email to the support address the dialog shows. The details are the page address, the run and the Meridian version. Nothing is sent from the dialog itself.

## Related

- [Fix work](/docs?page=fix)
- [Roles and access](/docs?page=roles)
- [Data in](/docs?page=data-in)
- [Administration](/docs?page=admin)
