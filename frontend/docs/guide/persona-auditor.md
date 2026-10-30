# Walkthrough: auditor and viewer

You read: every canvas, every number and its receipt, and, as an auditor, the audit log and each person's activity. Nothing you do changes data. Your start screen is the **Landscape**, the same one the programme lead sees, read-only. A viewer may also arrive through a share link, which opens one page read-only with the bar "Shared view. Read-only, as a viewer."

## Your first five steps

1. **Landscape**: read the sentence and the coverage matrix; hover a cell for its reading.
2. **An object**: open the receipt and every **i**: the arithmetic behind each figure.
3. **Approvals**: in Work, **Waiting for approval** and **Exceptions** show the four-eyes evidence: who drafted, who approved, who signed off and why.
4. **Audit log** (auditor): Administration, **Audit log**; filter by person and dates and **Export Excel**.
5. **Person activity** (auditor): People, open a person, **Activity**.

## Your jobs and where they are done

- **Read every canvas**: all canvases, read-only.
- **Audit log and export (auditor)**: Administration, Audit log.
- **A person's audit trail (auditor)**: Person inspector, **Activity**.
- **Open a read-only share link**: `/v2/share/{token}`; the bar says "Shared view", and **Leave the shared view** returns you.
- **Export a grid (auditor)**: **Share and export**, **Export to Excel**.
- **Read comments**: Inspector, **Comments**.
- **Rule change trail joining versions and runs**: not joined yet; read the rule's **Versions** and **History** side by side.

## The numbers you check

- Every object score has a receipt: dimension points, measured, cap and shown. The formula line states the weights, the severity weights, the tolerance and the cap rule.
- Comparisons state their method: the common set of rules and the change threshold.
- The audit log's **AI calls** list every call to the language model, which service made it and whether a deterministic rule answered first; prompts and records are never stored there.

## When something is wrong

- **A share link says it expired or was revoked**: ask the person who shared it for a new one.
- **The audit log is missing**: it needs the view audit permission.
- **Contact**: your administrator for access; the programme lead for the run a report was built on.
