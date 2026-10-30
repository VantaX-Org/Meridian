# User journeys

How people get their work done in Meridian, end to end, across roles. Each journey names the role or roles, what
starts it, every step with the exact address and the control used, the decisions on the way, the hand-offs between
people (and how the next person hears about it), what "done" looks like, and the time and number of clicks we aim
for.

The journeys describe the product as it is at v0.0.542 (`main`, the one interface served from `frontend/app/(v2)`),
except the last one, which describes a feature that is being built. Where today's product makes a step harder than it
should be, the step links to the finding in the [friction audit](friction-audit.md).

| Journey | Roles | Trigger | Target time | Target clicks |
|---|---|---|---|---|
| [First live week](first-live-week.md) | Administrator, SAP Basis, the SAP team that proves the numbers | The licence is bought and a host is ready | 5 working days elapsed; under 2 hours in Meridian | 30 |
| [Find, fix, approve, send](find-fix-approve-send.md) | Data steward, data owner, the SAP load team | A run finishes with records to fix | Steward 10 minutes, owner 5 minutes; 2 working days to "Fixed" | Steward 5, owner 4 |
| [Migration wave](migration-wave.md) | Programme lead, data owners, stewards, process analyst | A wave's target date is set | 30 minutes to set up; go/no-go in 5 minutes on the day | Setup 12, decision 4 |
| [Basis operations](basis-operations.md) | SAP Basis | Start of the day, or a failed job or refused credential | 10 minutes a day | 3 per incident |
| [Audit](audit.md) | Auditor (or viewer) | An audit request or a quarterly control test | 30 minutes for a complete evidence set | 12 |
| [Monthly governance](monthly-governance.md) | Programme lead, data owners, administrator for the digest | Month end, before the steering committee | 20 minutes | 10 |
| [New master data request](new-master-data-request.md) | Requester, approvers, steward, SAP | Someone needs a new material, customer, vendor or business partner | Target, being built | Target, being built |

## How to read a journey

- **Addresses** are the routes of the interface (`frontend/DESIGN.md`, section 5). `?open=kind:id` is the inspector on
  the right; `/o/{system}/{object}` is an object; `_` as the system means the system that holds it.
- **Controls** are named exactly as they read on screen, in bold.
- **Clicks** count every click, key press that acts (`Enter`, `Escape`, a shortcut) and selection in a list. Typing in
  a field is counted separately as a field.
- **Hand-off** lines say who acts next and how they hear about it: the inbox (`?open=inbox`), the next-step button on
  their start screen, an email, or nothing.
- **Leaves Meridian** marks a step done outside the product (a shell on the host, SE16 or the Migration Cockpit in
  SAP, an email).

## Roles

The role keys are those of `lib/api/v2/fixtures/role-actions.json`; each role lands on its own start screen
(`frontend/docs/guide/persona-*.md`).

| Role | Key | Start screen |
|---|---|---|
| Administrator | `platform_admin` | Landscape with **Open Administration** |
| SAP Basis | `sap_basis` | Landscape with the Basis home (Connections, Last extraction, Failed jobs to triage, Authorisation errors, Schedules) |
| Data steward | `data_steward` | Landscape with **Accept the suggested values** |
| Data owner | `data_owner` | Landscape with "2 batches wait for your approval" and **Approve batch B-241** |
| Programme lead | `programme_lead` | Landscape with the nearest wave's next step |
| Process analyst | `process_analyst` | Landscape with **Open PTP step 3** |
| Auditor, viewer | `auditor`, `viewer` | Landscape, read-only |

## The other files

- [friction-audit.md](friction-audit.md): every journey walked in fixture mode at 1440 and 390 pixels wide, the clicks
  measured against the targets, and the findings ranked.
- [usability-test-script.md](usability-test-script.md): the moderated session script for five users per role on the
  live site.
- [img/](img): the screenshots of the audit, fixture data only (the "Demo data" bar shows on each).
