# Walkthrough: data steward

You clean the data: you decide the right value for each failing field, accept what Meridian suggests where it is right, sign off what is not a problem, and hand your batch to a second person. Your start screen is the **Landscape** with "Accept the suggested values" as your next step.

## Your first five steps

1. **Landscape**: press **Accept the suggested values**; Work opens on your rows.
2. **Work**: read the top rows, ranked by value at risk. Select rows and press `a` to accept their suggested values; the notice has **Undo**.
3. **A record**: press `Enter` on a row without a suggestion. Read the possible values with their meanings, type the New value and press `Enter`.
4. **By rule**: switch the ledger to **By rule** and decide a whole rule at once, or **Export fix sheet** (`e`) to work offline and **Import filled sheet** when done.
5. **Waiting for approval**: check your draft batch under the chip; a data owner approves it.

## Your jobs and where they are done

- **Work the ledger: fix, propose, not an issue, accept risk**: Work ledger and record inspector.
- **Accept suggested values in bulk**: **Accept all** on a rule, or the next-step button.
- **Build a fix batch for approval**: every accepted or entered value goes into your draft batch.
- **Undo a decision**: the notice's **Undo**, or `⌘Z`.
- **Comment and mention**: Inspector, **Comments**; type `@` and a name.
- **Watch a rule or record**: Inspector, **Watch**.
- **Fix the upstream object first**: the fix-order hint, for example "Fix Material master first: 3,640 upstream failures. Records there fail before this object can pass."
- **Out of office with a deputy**: Preferences or People, **Out of office**.
- **Saved and shared views of the ledger**: **Views**, **Save current view…**, shared with everyone if you choose.
- **Balance work in the team**: People, **Balance work** (needs assign).
- **Author rules**: Rules, **New rule draft** (needs manage rules).
- **Import rules in bulk**: Administration, Rules import and export; there is no link from the rules library yet.
- **See your own activity**: your row in People, **Activity**.

## The numbers you work with

- **Value at risk** ranks the rows; it is the cost-model estimate of what each failing value costs.
- **Possible values** come from the rule; a value outside them still fails and is refused.
- **Suggested value** is the rule's proposal, "Blank when no single value is right."

## When something is wrong

- **The ledger says "Read-only for your role"**: you need the apply permission. Ask your administrator.
- **A batch comes back**: the approver sent it back with a reason; it is in the batch inspector.
- **A fixed record returns to To fix**: the next run still found it failing after it was sent to SAP. Check with whoever loads the file.
- **Contact**: the object's owner for approvals, SAP Basis for extraction gaps.
