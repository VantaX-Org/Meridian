# Journey: audit

An auditor (internal audit, an external auditor, or a compliance officer) gathers the evidence that data changes were
controlled: who changed what and when, that every value change had four eyes, why records were signed off without a
change, which policy classes are breached, and the trail behind a readiness certificate. Nothing the auditor does
changes data.

- **Roles**: auditor (view, view audit, export); a viewer reached by a share link reads one page; the administrator
  grants access and exports the configuration bundle when asked.
- **Trigger**: an audit request, a quarterly control test (for example SOX financial controls on vendor bank data), or
  a certificate to be checked before a cutover.
- **Done**: an evidence folder outside Meridian holding the audit log export for the period, the batches with their
  approval trails, the exceptions with reasons and who signed them off, the policy breaches by class, and any
  certificate PDF with its SHA-256; every file complete, not just the rows on screen.
- **Target**: 30 minutes and 12 clicks for a complete evidence set for one period (measured: see the
  [friction audit](friction-audit.md#measured-clicks-against-targets)).

## 1. The audit log

| # | Address | Control | Result |
|---|---|---|---|
| 1.1 | `/` | The account menu (top right), **Administration** | `/admin` |
| 1.2 | `/admin/audit` | **Audit log** in the index | "36 events recorded in the last 30 days." |
| 1.3 | same | Filter: **Action contains** (for example `auth.login`, `approve_batch`, `send_back_batch`), **Object kind**, **From**, **To** | The period and the actions under test. There is no **Who** filter for an auditor ([F25](friction-audit.md#findings)) |
| 1.4 | same | **Export Excel** (or **Export CSV**) | `audit_log.xlsx` |
| 1.5 | same, **AI calls** | Read | Every call to the language model, which service made it, and whether a deterministic rule answered first; prompts and records are never stored |

## 2. Four-eyes evidence for value changes

| # | Address | Control | Result |
|---|---|---|---|
| 2.1 | `/admin` | **Back to the landscape**, then **Work** in the map | `/work` |
| 2.2 | `/work?filter=approvals` | **Waiting for approval** chip | The rows grouped by batch: who built it, records, value at risk, due, state |
| 2.3 | `/work?open=batch:{id}` | A batch heading | **Approval trail**: drafted by, values proposed by, approved by, sent to SAP by, with times |
| 2.4 | same | **Download sheet** | The batch's changes as a sheet |

Batches already approved or sent are not under any chip in Work ([F10](friction-audit.md#findings)); open them from
the audit log targets or the inbox links.

## 3. Exceptions (signed off without a change)

| # | Address | Control | Result |
|---|---|---|---|
| 3.1 | `/work?filter=exceptions` | **Exceptions** chip | "48 records are signed off as not an issue or an accepted risk." Columns **Resolution**, **Reason**, **Signed off by**, **When** |
| 3.2 | same | **Share and export**, **Export to Excel** | `work.xlsx` with the rows on screen ([F26](friction-audit.md#findings)) |

## 4. Policy breaches

| # | Address | Control | Result |
|---|---|---|---|
| 4.1 | `/work` | **Policy** chip, then a class (for example **Vendor bank data**, "breached") | The records failing a rule that evidences that class (`policy=sox:vendor_bank`) |
| 4.2 | `/admin/policypacks` | **Policy packs** in the Administration index | GxP, SOX and GDPR classes, the authority each answers to, and the evidencing rules |
| 4.3 | `/o/{system}/{object}` | **Policy classes breached** on the object canvas | Per object, the breached classes |

## 5. People and certificates

| # | Address | Control | Result |
|---|---|---|---|
| 5.1 | `/people?open=person:{id}` | **People** in the map, a person | The person inspector, **Activity**: their audit trail |
| 5.2 | `/?view=waves&open=certificate:{wave}` | **Certificate** on the wave | Each issued version, the signatures, **Download PDF** |
| 5.3 | `/r/{id}` | A rule's **History** and **Versions** | Not joined to runs yet: read them side by side |

## 6. Share a page read-only

| # | Address | Control | Result |
|---|---|---|---|
| 6.1 | Any grid | **Share and export**, **Share this page as a link** | A read-only link until it expires; the viewer sees "Shared view. Read-only, as a viewer." |
| 6.2 | `/share/{token}` | **Leave the shared view** | Back to the person's own session |

**Decision**: complete or not. If an export is partial or a filter is missing, the auditor asks the administrator for
the full export (for example an audit log export filtered by person, which needs manage users).

## Hand-offs at a glance

| From | To | What | How they hear today |
|---|---|---|---|
| Auditor | Administrator | Access, a person filter, a full export | Outside Meridian |
| Administrator | Auditor | Access granted | Their role changes; no notice |
| Auditor | Evidence folder | The exports | Downloads (leaves Meridian) |
