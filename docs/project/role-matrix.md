# Role matrix

This note records which role can do what on each screen of the interface, and how the interface tells a person when an action is out of reach. The backend is the source of truth. `api/services/rbac.py` defines the permissions of each role, and every write endpoint checks one of them through `require_permission` or inside its handler. The interface reads the same permission list for the signed-in user and shows an action only when the backend would accept it.

## Roles

Nine roles are in use. Each persona role builds on a base role and adds a small set of permissions.

- **Viewer** reads everything the tenant holds and changes nothing.
- **Auditor** reads, exports and opens the audit log.
- **Data owner** (approver) reads, approves, exports and gives feedback on AI proposals.
- **Process analyst** reads, runs process discovery, exports processes and hands rules off.
- **Analyst** reads, uploads, starts runs, exports and triggers AI and sync jobs.
- **SAP Basis** is an analyst who also manages systems, field mappings and process discovery.
- **Data steward** applies and approves fixes, assigns work, manages rules, writes master data and runs triage.
- **Programme lead** has the manager permissions plus process discovery, triage, digests and rules.
- **Platform admin** holds every permission.

The legacy roles manager, steward, approver and ai_reviewer still exist. The first three follow the programme lead, data steward and data owner columns, except that the plain manager does not hold `manage_rules`. The ai_reviewer reads, reviews AI-written rules and gives AI feedback.

## Landing page

Every role lands on the Landscape (`/`), as `PERSONA_HOME` in `rbac.py` says. The Landscape adapts its next step to the persona rather than sending people to different pages. A data owner is offered the next cleansing batch to approve and a count of what waits for them, a data steward the rule with the most suggested values to accept, a process analyst the next process discovery step, an auditor the rules library, SAP Basis the connection and sync tasks, and an administrator the Administration page. Every other role, the viewer included, is offered the next migration wave and its no-go or at-risk objects. No role lands on a page that is empty for it.

## How a locked action reads

When a role lacks the permission an action needs, the interface either leaves out a control that belongs to a section the role cannot use, or puts a sentence in its place that names the permission. There are three forms of that sentence.

- `NeedsPermission` (in `design/v2/admin/kit.tsx`) says "{what} needs the {permission} permission. Ask an administrator to grant it." and carries a Request access button that files an access request.
- A short inline note in `m2-prov` style names the permission beside a row action.
- A shared link or a view-as session is read-only for every role, and the screens say so.

A shared session (`/share/[token]`) and a view-as session behave as a viewer, whatever role the person holds.

## Matrix

The table lists each screen with a write action, the permission the backend checks, and whether each role holds it. Every role can read every screen listed. Screens with no write action are listed after the table.

| Screen | Action | Permission | Viewer | Auditor | Data owner | Process analyst | Analyst | SAP Basis | Data steward | Programme lead | Platform admin |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `/ (Landscape)` | Read the landscape and the next step for the role | `view` | yes | yes | yes | yes | yes | yes | yes | yes | yes |
| `/ (Landscape)` | Connect a system | `manage_systems` | no | no | no | no | no | yes | no | yes | yes |
| `/ (Landscape)` | Upload a file | `upload` | no | no | no | no | yes | yes | yes | yes | yes |
| `/ (Landscape)` | Start a run | `analyse` | no | no | no | no | yes | yes | yes | yes | yes |
| `/ (Landscape)` | Invite people | `manage_users` | no | no | no | no | no | no | no | no | yes |
| `/s, /s/new, /s/[id]` | Add or edit a connection, edit sync schedules | `manage_systems` | no | no | no | no | no | yes | no | yes | yes |
| `/runs, /run/[id]` | Start or change a run | `analyse` | no | no | no | no | yes | yes | yes | yes | yes |
| `/runs, /run/[id], /reports` | Download or export | `export` | no | yes | yes | no | yes | yes | yes | yes | yes |
| `/o/[system]/[module]` | Draft a tuned rule version | `manage_rules` | no | no | no | no | no | no | yes | yes | yes |
| `/o/[system]/[module]` | Draft a cleansing batch | `apply` | no | no | no | no | no | no | yes | yes | yes |
| `/o/[system]/[module]` | Set a rule owner | `assign` | no | no | no | no | no | no | yes | yes | yes |
| `/o/.../golden` | Approve a golden record write-back | `approve` | no | no | yes | no | no | no | yes | yes | yes |
| `/o/.../golden` | Apply a golden record write-back | `apply` | no | no | no | no | no | no | yes | yes | yes |
| `/o/.../processes, /processes` | Run process discovery, edit the design | `run_process_discovery` | no | no | no | yes | no | yes | yes | yes | yes |
| `/o/.../processes, /processes` | Export a process | `export_process` | no | no | no | yes | no | no | no | yes | yes |
| `/work` | Accept, edit or undo a fix | `apply` | no | no | no | no | no | no | yes | yes | yes |
| `/work` | Mark not an issue, accept a risk | `approve` | no | no | yes | no | no | no | yes | yes | yes |
| `/work, /people, /work/exceptions` | Assign or remind | `assign` | no | no | no | no | no | no | yes | yes | yes |
| `/work, /work/exceptions, /issues` | Comment | `analyse` | no | no | no | no | yes | yes | yes | yes | yes |
| `/work/triage` | Bulk assign or snooze | `assign` | no | no | no | no | no | no | yes | yes | yes |
| `/work/triage` | Change triage settings | `manage_triage` | no | no | no | no | no | no | yes | yes | yes |
| `/work/exceptions` | Resolve an exception | `approve` | no | no | yes | no | no | no | yes | yes | yes |
| `/issues` | Move an accepted issue | `approve` | no | no | yes | no | no | no | yes | yes | yes |
| `/cleansing` | Apply a batch | `apply` | no | no | no | no | no | no | yes | yes | yes |
| `/cleansing` | Approve a batch, merge duplicates | `approve` | no | no | yes | no | no | no | yes | yes | yes |
| `/rules, /r/[id]` | Create, edit or publish a rule | `manage_rules` | no | no | no | no | no | no | yes | yes | yes |
| `/rules, /r/[id]` | End a suppression | `approve` | no | no | yes | no | no | no | yes | yes | yes |
| `/r/[id]` | Hand a rule off | `handoff_rule` | no | no | no | yes | no | no | yes | yes | yes |
| `/r/[id]` | Review an AI-written rule | `review_ai_rules` | no | no | no | no | no | no | yes | no | yes |
| `/rule-promotion, /rule-dry-run, /fix-drafts` | Promote, dry-run or draft | `manage_rules` | no | no | no | no | no | no | yes | yes | yes |
| `/anomaly-rules` | Propose a rule from an outlier or a shift | `manage_rules` | no | no | no | no | no | no | yes | yes | yes |
| `/entry-gate` | Check records at the gate | `mdm.write` | no | no | no | no | no | no | yes | yes | yes |
| `/monitors, /mining` | Create a monitor, act on a mined finding | `mdm.write` | no | no | no | no | no | no | yes | yes | yes |
| `/reference-data` | Edit a mapping | `analyse` | no | no | no | no | yes | yes | yes | yes | yes |
| `/reference-data` | Approve a proposed mapping | `approve` | no | no | yes | no | no | no | yes | yes | yes |
| `/reference-data` | Ask Aletheia for a mapping | `trigger_ai` | no | no | no | no | yes | yes | yes | yes | yes |
| `/aletheia-survivorship` | Decide a survivorship proposal | `approve` | no | no | yes | no | no | no | yes | yes | yes |
| `/aletheia-survivorship` | Change survivorship settings | `manage_settings` | no | no | no | no | no | no | no | no | yes |
| `/requests, /requests/[id]` | Create or edit a change request, attach files | `mdm.write` | no | no | no | no | no | no | yes | yes | yes |
| `/requests` | Change workflow defaults, derivations and critical fields | `manage_workflows` | no | no | no | no | no | no | no | no | yes |
| `/config` | Change run configuration | `analyse` | no | no | no | no | yes | yes | yes | yes | yes |
| `/migration` | Start a migration run or reconciliation | `analyse` | no | no | no | no | yes | yes | yes | yes | yes |
| `/migration` | Extract the target system | `trigger_sync` | no | no | no | no | yes | yes | yes | yes | yes |
| `/admin/[section]` | Users and roles | `manage_users` | no | no | no | no | no | no | no | no | yes |
| `/admin/[section]` | Tenant settings, webhooks, channels | `manage_settings` | no | no | no | no | no | no | no | no | yes |
| `/admin/[section]` | Audit log | `view_audit` | no | yes | no | no | no | no | no | yes | yes |
| `/admin/[section]` | Field mappings | `manage_field_mappings` | no | no | no | no | no | yes | no | no | yes |
| `/admin/digests` | Manage digests | `manage_digests` | no | no | no | no | no | no | no | yes | yes |

Screens with no write action, readable by every role: `/atlas`, `/attention`, `/forecast`, `/go-live`, `/insights`, `/links`, `/materials`, `/mdm`, `/objects`, `/s4`, `/score`, `/value`, `/work/analytics`, `/work/monitor`, `/aletheia/evidence`, and the object tabs for fixes, glossary, lineage, profile, readiness, records, rules, runs and trend. A record (`/o/.../records/[key]`) opens in owner mode for a role that may change it and in a read-only mode with a sentence for every other role.

## Decisions on change requests

A change request is decided step by step through its workflow tasks, not through a single decide call. The step panel shows the decide buttons only to the person the task is assigned to, using the `may_decide` flag the task carries. The endpoint `POST /change-requests/{id}/decide` exists for API clients and has no screen on purpose.

## Gaps closed in this pass

Three screens offered a button the backend would refuse.

- The entry gate (`/entry-gate`) showed Check records to every role, but `POST /dq-firewall/validate` needs `mdm.write`. Viewers, auditors, data owners, analysts, SAP Basis and process analysts now see the permission sentence and a Request access button instead.
- The Aletheia findings on an object page showed Draft tuned version and Draft cleansing batch to every role. These need `manage_rules` and `apply`. A role without them now reads the reason in the row.
- The anomaly rules screen (`/anomaly-rules`) hid the propose buttons from roles without `manage_rules` but said nothing. It now shows the permission sentence at the top of the page.

## Known limits

- Workflow defaults, derivations and critical fields need `manage_workflows`, which only the platform admin holds. A programme lead reads them but cannot change them. Widening this is a backend decision.
- Only the platform admin holds `manage_users`, so invitations on the Landscape and the users section are admin-only.
- The navigation shows every entry to every role. The screens carry their own locked states, so nothing breaks, but a few entries could carry the permission they need so the menu can mark them.

## Related

- [[Requirements traceability]] in `docs/project/requirements-traceability.md`
- [[Solution design summary]] in `docs/project/solution-design-summary.md`
