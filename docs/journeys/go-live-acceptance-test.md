# Go-live acceptance test

A checklist for one signed-in tester on the live site, run after each release and before the customer is told the
release is ready. Automated tests run in fixture mode and cannot sign in to production, so these checks are the only
proof that the release works with the customer's own accounts, data and SAP connection.

Run it as an account that holds the role named in each section. Where one person holds several roles, sign out and
in again between sections, or use a second browser profile. Never paste SAP record values into the notes: write
counts, run ids and pass or fail only.

Record for each check: pass, fail, or blocked (with the reason). A fail in sections 1 to 3 stops the release; a fail
later is raised as a defect and the release may stay live.

## 0. Before you start (operator)

- [ ] No extraction, sync or analysis is running. Check Operations, Jobs. Never test during one.
- [ ] The release number on the server matches the release notes (`/app/VERSION` inside the API container).
- [ ] `GET /health` returns 200.
- [ ] The API log shows no `Traceback` since the update.

## 1. Sign in and the shell (every role)

- [ ] Sign in with the normal sign-in page. No error, no blank page.
- [ ] The menu shows only the tools the role can use. A data owner sees no Administration entry; an auditor sees no
      fix or approve controls.
- [ ] Light mode is the default. Switching to dark mode and back keeps the page readable.
- [ ] Reload any page: it opens at the top and stays signed in.
- [ ] Sign out returns to the sign-in page, and the back button does not reopen a signed-in page.

## 2. Runs and objects (data steward)

- [ ] Home lists the licensed objects with a score and the date of the last run.
- [ ] Open the last finished run of each licensed object. The run detail shows the score, the rule results and the
      trend. Every code in a table has its text beside it.
- [ ] Open one failing rule. The records list loads, and the rule text explains what is wrong.
- [ ] Download the findings export. The file opens and its row count matches the screen.

## 3. Fix, approve, send (data steward, then data owner)

Use sandbox mode (Administration, Settings, **Enter sandbox mode**) unless the customer has agreed to real batches.

- [ ] The steward builds a batch from a failing rule and sends it for approval.
- [ ] The owner sees the waiting batch on Work without being told, approves it, and the steward sees the new status.
- [ ] The audit trail shows both actions with the right names and times.

## 4. Migration target workbook (programme lead or data steward with export rights)

Use a target workbook that the new system produced. Do not use a workbook edited by hand.

- [ ] Migration, **Target workbook**: upload the workbook against the last finished run. The check report lists
      matched columns, unmatched columns, and rows that cannot be filled.
- [ ] Columns the run does not hold yet but the next run will extract show as learned, with the prompt to update the
      run. Columns the source system did not return show the not-in-system notice instead.
- [ ] Ask someone who can start extractions to update the run, then upload the same workbook again. The learned
      columns are now matched, or listed as not in the system.
- [ ] Export. The file opens in the load tool of the new system, or in a spreadsheet program if the load tool is not
      available. Record which.
- [ ] In the load tool, run its own validation on the exported file. Record every rejected column and why. This is the
      check that proves number and date cells, key header names and picklist values are accepted.

## 5. Monitoring after a clean (data owner)

- [ ] Open an object that was cleaned. The monitoring view shows the score since the clean and any new failures.

## 6. Administration (administrator)

- [ ] Users: the role of each tester is right. Change one role and confirm the menu changes on the next sign-in.
- [ ] Connections: the SAP connection test passes. Do not start an extraction from here during the test window
      unless the operator agrees.
- [ ] Licence: the licensed modules match the contract.
- [ ] Help: the guide opens, and at least one help video plays.

## 7. Sign-off

| Section | Result | Tester code | Date | Notes |
|---|---|---|---|---|
| 0 Before you start | | | | |
| 1 Sign in and the shell | | | | |
| 2 Runs and objects | | | | |
| 3 Fix, approve, send | | | | |
| 4 Migration target workbook | | | | |
| 5 Monitoring after a clean | | | | |
| 6 Administration | | | | |

Use a tester code, such as AT-1, not a name. Keep the completed sheet with the release record.
