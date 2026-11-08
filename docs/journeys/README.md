# User journeys

How people get their work done in Meridian, end to end, across roles. Each journey names the role or roles, what
starts it, every step with the exact address and the control used, the decisions on the way, the hand-offs between
people (and how the next person hears about it), what "done" looks like, and the time and number of clicks we aim
for.

The journeys describe the product as it is at v0.0.630 (`main`, the one interface served from `frontend/app/(v2)`),
except the last one, which describes a feature that is being built. Where today's product makes a step harder than it
should be, the step links to the finding in the [friction audit](friction-audit.md).

Two newer files cover the same product by role and by object, and a machine-readable file lists the steps:

- [by-role.md](by-role.md): one section per role in code, with its rights, daily and weekly journeys, hand-offs and
  what done looks like.
- [by-object.md](by-object.md): one section per scored object, with every action, the route and control, and a role
  by action table.
- [steps.json](steps.json): each journey as a list of steps (route, control, visible text). Values in braces, such as
  `{system_id}` or `{batch_id}`, are filled from the tenant's data.

Routes that changed since the older journeys were written:

- [New master data request](new-master-data-request.md) uses `/requests/new` and `/requests/{id}`. Both addresses now
  redirect: `/requests/new` opens `/requests`, where **New request** starts the form, and `/requests/{id}` opens the
  request in its panel (`/requests?open=request:{id}`).
- [Find, fix, approve, send](find-fix-approve-send.md) uses the fixture batch `B-241`. Real batch ids differ; open the
  batch from its row on `/work`.
- [Monthly governance](monthly-governance.md) uses `/admin/digests`. The section opens with `manage_settings` or
  `manage_digests`, so a programme lead can open it.

`frontend/e2e/v2-journeys.spec.ts` walks every journey in steps.json in fixture mode. At each step the page must draw,
show the expected text and offer the next control. A step with `needs` depends on an action or data the fixture
cannot reach (an upload, an approval, a SuccessFactors analysis). For those the spec checks only that the route draws;
the component tests cover the state itself.

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

The role keys are those of `api/services/rbac.py`. Every role lands on `/` (Landscape). The next-step button under the
title depends on the role (`frontend/design/v2/screens/Landscape.tsx`). Values in braces come from the tenant's data.

| Role | Key | Next-step button on `/` |
|---|---|---|
| Platform admin | `platform_admin` | **Open Administration** |
| SAP Basis / integration admin | `sap_basis` | **Fix the {system} sign-in**, else **Extract {system}** or **Run analysis on {system}**; the Basis home below |
| Data steward | `data_steward` | **Accept {count} suggested values for {check}**, else **Accept the suggested values** |
| Data owner / approver | `data_owner` | **Approve batch {label}**, else **See who holds the work**; "{n} batches wait for your approval" |
| Programme lead / CIO | `programme_lead` | The nearest wave: **Clear the {n} no-go objects in {wave}**, **Review the {n} at-risk objects in {wave}** or **Open {wave}**; with no wave **Open the no-go objects** |
| Process analyst | `process_analyst` | **Open {process} step {n}**, else **Open the process readiness** |
| Analyst | `analyst` | Same as the programme lead |
| Auditor | `auditor` | **Open the rules library** |
| Viewer | `viewer` | Same as the programme lead, read-only |

Legacy roles `admin`, `manager`, `steward`, `approver` and `ai_reviewer` still work and show with "(legacy)". See
[by-role.md](by-role.md) for rights.

## The other files

- [friction-audit.md](friction-audit.md): every journey walked in fixture mode at 1440 and 390 pixels wide, the clicks
  measured against the targets, and the findings ranked.
- [usability-test-script.md](usability-test-script.md): the moderated session script for five users per role on the
  live site.
- [img/](img): the screenshots of the audit, fixture data only (the "Demo data" bar shows on each).
