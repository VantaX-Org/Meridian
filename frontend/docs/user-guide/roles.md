# Roles and access

Your role decides which pages you see and what you can change on them. This chapter explains the six permissions that matter for fixing data, lists every role with what it sees and can do, and shows how to ask for more access.

## How access works

- Every user has one main role, for every system and object.
- An administrator can add grants: a further role for one system, one object, or one object on one system. What you can do is the sum of your main role and every grant that covers the record in front of you.
- Pages and buttons you cannot use are hidden, so the menus never offer a dead end. The server checks the same permissions on every request.
- Your licence can switch pages off for every role.

## The six permissions behind fixing data

- **view**: open pages and read records, scores and findings. Every role has it.
- **apply**: accept a suggestion, enter a value, set one value for a whole issue, undo a decision and import a fix sheet. Values go into your own draft fix batch.
- **approve**: mark a record **Not an issue** or **Accept risk**, withdraw a sign-off, approve a fix batch, accept high-confidence proposals in a batch, and merge duplicates.
- **assign**: take a record or release it, for yourself or in bulk.
- **analyse**: run analyses, build a run's work list, pin a baseline, and add comments on a record.
- **export**: download the fix sheet, export an approved batch for the SAP load, and download reports.

**Fix work** appears for every role that holds apply or approve.

## The roles

### Data steward

The person who cleans the data. Holds view, apply, approve, assign, analyse and export, and may also maintain rules, contracts and the glossary. Lands on **Fix work**. A steward can do everything in Fix work, but cannot approve or export a batch they drafted themselves.

### Data owner / approver

The second pair of eyes. Holds view, approve and export. Lands on **Fix work**, where they approve the batches stewards prepared, sign off records as **Not an issue** or **Accept risk**, and export approved batches. They cannot enter values, take records or comment.

### Programme lead / CIO

Runs the programme. Holds view, apply, approve, assign, analyse and export, plus connecting systems, editing master data and reading the audit log. Lands on the data lead Home page and usually works from **Progress**.

### Platform admin

Full access, including users and roles, rules, settings, AI settings, the licence and updates. Lands on the data lead Home page.

### Analyst

Imports files, extracts, runs analyses and exports. Holds view, analyse and export, but neither apply nor approve, so **Fix work** is hidden. An analyst can still open an object's **Records to fix** tab and read each record, and builds a run's work list when one is missing.

### SAP Basis / integration admin

Everything the analyst can do, plus connecting and editing SAP systems and their credentials, and field mapping. Lands on the Basis Home page.

### Auditor, viewer and process analyst

- **Auditor**: read everything, export, and read the audit log.
- **Viewer**: read only. On report pages the export button becomes **Print**.
- **Process analyst**: read everything, run process discovery and export as-is process models. Lands on the process Home page.

Older role names (Admin, Manager, Steward, Approver, AI reviewer) still work and carry the rights of the matching role above.

## What each role sees

- **Objects**, **Progress** and **Inbox**: every role.
- **Fix work** and **What-if**: roles with apply or approve (Platform admin, Programme lead, Data steward, Data owner).
- **Inbox**, **Exceptions**: roles with approve or assign.
- **More**, **Analysis**, **Master data**, **Rules** and **Data in**, **Systems**: every role.
- **Import file**: roles that may upload. **Migration**: roles with analyse.
- **Rules**, **Drafts**: roles that maintain rules (Platform admin, Data steward).
- **Users and audit**: Platform admin. **Audit log**: Platform admin, Programme lead and Auditor.

Tables follow the same rule: a role that can change nothing gets no selection boxes and no bulk actions. In the record panel such a role reads "Your role can view this record. Fixing it needs the apply permission."

## Scoped access

A grant for one system or object counts only on records of that system or object; elsewhere your main role applies. When any grant is scoped, the scope bar shows a pill such as "Scoped: PRD ECC, Material master", with "+2" for two more.

## How to ask for access

1. Select **Request access** beside a button your role does not allow.
2. Check the **Resource**, **Action** and **Scope** Meridian filled in, and write a **Reason**.
3. Select **Send request**. An administrator grants or declines it on **Roles and access**. See [Administration](/docs?page=admin).

## Related

- [Fix work](/docs?page=fix)
- [Approvals and export](/docs?page=approvals)
- [Administration](/docs?page=admin)
- [Troubleshooting](/docs?page=troubleshooting)
