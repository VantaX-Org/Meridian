# Roles and features: the role capability audit (Meridian 2, step 6c)

What each role Meridian defines has to get done, the v2 verb that does it (a canvas or inspector action), the API
endpoint behind the verb, the permission the endpoint checks, and whether the verb existed before this step
(**Before**) and after it (**After**): `present`, `partial` or `missing`. Each row names the competitor products that
give the same role the same job (from `competitor-ui-research.md` and product knowledge; "(inferred)" where the
evidence is a vendor document, not a walkthrough). Keep this file current as verbs are built.

Roles are the backend's (`api/services/rbac.py`): `platform_admin` (admin), `programme_lead` (manager),
`data_steward` (steward), `data_owner` (approver), `sap_basis`, `process_analyst`, `analyst`, `auditor`, `viewer`, and
the legacy `ai_reviewer`. Permissions are the action strings of `PERMISSIONS` / `PERSONA_ROLES`; the v2 client reads
them from `/me/permissions` (fixture mode: `?role=<key>`, from `lib/api/v2/fixtures/role-actions.json`).

Every new verb is deterministic (no LLM), gated by the permission named, audited (`audit_log`), tenant-scoped with
RLS (migrations 104 and 105), and has fixtures, vitest (`design/v2/__tests__/roles/*.test.tsx`), Postgres tests
(`tests/test_m2_roles_pg.py`) and an e2e screenshot (`e2e/v2-roles.spec.ts`). Where an endpoint is missing on an older
server the client shows a dash, never an error.

## Summary

| | Before | After |
|---|---|---|
| Present | 29 | 82 |
| Partial | 15 | 4 |
| Missing | 43 | 1 |
| Rows | 87 | 87 |

What is still partial or missing after this step, and why:

- **Readiness certificate** (lead): a stub (`GET /migration/waves/{id}/certificate`, `final: false`); the signed PDF is
  step 9.
- **Wave sign-off from v2** (lead): signed off in the cockpit of the current interface; the Waves panel shows the state.
- **Watch a system** (Basis): the API takes `target_kind=system` and the run worker notifies system watchers; the System
  inspector has no Watch button yet (System.tsx belongs to step 6b).
- **Rule authoring in bulk from v2 Rules canvas** (steward): the import lives in Admin › Rules import and export; the
  Rules canvas (step 6b) does not link it yet.
- **Rule change history beyond runs** (auditor): the rule inspector's History reads run history; version history is in
  the Versions section, but there is no single "who changed this rule" trail joining both (missing).

## Everyone (any role holding `view`)

| Job | v2 verb | Endpoint | Permission | Before | After | Benchmark |
|---|---|---|---|---|---|---|
| Comment on a record, rule, batch, contract or wave | Inspector › Comments (Post comment) | `GET/POST /comments`, `DELETE /comments/{id}` | view (author or manage_users deletes) | missing | present | Collibra asset comments; Ataccama ONE task comments; Informatica MDM 360 task notes |
| @mention a colleague | Comments composer, `@` picker | `POST /comments` (`mentions`), notification `mention` | view | missing | present | Collibra mentions; Monte Carlo incident comments |
| See unread mentions | Inbox panel "N unread mentions" | `GET /comments/mentions/unread` | view | missing | present | Linear triage inbox; Collibra notifications |
| Watch an object, rule, record or batch | Inspector › Watch; Object canvas Watch | `GET/PUT/DELETE /watches`, `GET /watches/mine` | view | missing | present | Monte Carlo table watchers; Soda dataset notifications |
| Choose which events reach me | Preferences › What you hear about | `GET/PUT /me/subscriptions` | view | missing | present | Soda notification rules; Monte Carlo audiences |
| Hear about run finished, score drop, new critical breach, batch waiting | Inbox (notifications) | worker `collab.fire_run_events`, `notify_batch_waiting_sync` | view | missing | present | Monte Carlo incident alerts; Soda check alerts |
| Save a view of any grid (filters, columns) | Share and export › Save these columns as a view | `PUT /views` (any route key) | view | partial | present | PostHog saved views; Monte Carlo saved filters |
| Share a view with everyone | Save view › Share with everyone | `PUT /views` (`shared: true`), `GET /views` | view | missing | present | PostHog shared views; Ataccama shared filters (inferred) |
| Remember my columns per grid across browsers | automatic (the `_columns` view row) | `GET/PUT /views` | view | partial | present | PostHog column config; Collibra table views |
| Export any grid to Excel with its visible columns | Share and export › Export to Excel | `POST /export/grid` (branded workbook) | export | partial | present | Collibra export; Ataccama export; Informatica export |
| See a record's history | Record inspector › History | `GET /records/{module}/{key}/links` | view | present | present | Informatica MDM history; SAP MDG change documents |
| See my own activity | Person inspector › Activity (self) | `GET /people/{id}/activity` | view (self) | missing | present | Collibra activity stream |
| Open related objects of an object | Object canvas › Related objects | `GET /objects/{module}/related` | view | missing | present | Monte Carlo lineage; Collibra relations; Information Steward Metapedia |

## Platform admin (`platform_admin`, legacy `admin`)

| Job | v2 verb | Endpoint | Permission | Before | After | Benchmark |
|---|---|---|---|---|---|---|
| Invite users, set roles | Admin › Users | `/users/*`, `/roles/*/grants` | manage_users | present | present | Collibra user admin; Informatica IDMC org admin |
| Custom roles and scoped grants | Admin › Roles and permissions | `/roles/*` | manage_users | present | present | Collibra resource roles; Ataccama roles |
| Single sign-on | Admin › Single sign-on | `/admin/sso` | manage_users | present | present | Informatica SAML/OIDC; Collibra SSO |
| API keys | Admin › API keys | `/admin/api-keys` | manage_users | present | present | Monte Carlo API keys; Soda API keys |
| Audit log and export | Admin › Audit log | `GET /audit`, `/audit/export` | view_audit or manage_users | present | present | Collibra audit; Informatica audit |
| Export and import the tenant configuration with a dry-run diff | Admin › Configuration bundle | `GET /admin/config-bundle`, `POST /admin/config-bundle/import?dry_run=` | manage_settings | missing | present | Informatica asset export/import; Collibra migration packages (inferred) |
| View the product as a role (support) | Admin › View as a role; bar "Viewing as" | `POST/DELETE /admin/view-as`, header `X-View-As-Role` (read-only, narrowed server-side) | manage_users | missing | present | Collibra "view as" role check (inferred); Ataccama impersonation (inferred) |
| Import and export rules in bulk (YAML and Excel) | Admin › Rules import and export | `GET /rules/bulk/export`, `POST /rules/bulk/import` (validated drafts) | export / manage_rules | partial | present | Soda contracts as code; Ataccama rule import; Informatica rule specs export |
| Govern share links (list, revoke) | Admin › Share links | `GET /share-links?all=true`, `DELETE /share-links/{id}` | manage_users | missing | present | GX Cloud shareable URLs; Monte Carlo share links |
| See everyone's out of office | Admin › Out of office | `GET /delegations`, `DELETE /delegations/{id}` | manage_users | missing | present | SAP MDG workflow substitution admin |
| Steward assignment template (owner per object, stewards per slice) | Admin › Stewardship (template editor) | `GET/PUT /admin/assignment-template` | manage_settings | missing | present | SAP MDG governance scope and processor determination; Collibra responsibilities |
| Apply the template with a dry-run diff | Admin › Stewardship › Check, Apply | `POST /admin/assignment-template/apply` | manage_settings | missing | present | Collibra bulk responsibility assignment (inferred) |
| Audit "one owner and a steward per active slice" | Admin › Stewardship › Gaps | `GET /admin/assignment-template/gaps` | view | missing | present | Collibra governance coverage dashboards (inferred) |
| Licence, platform update, health | Admin › Licence; Jobs and system update | `/licence`, `/system/*` | manage_system | present | present | Informatica org health |
| Tenant settings (scoring, cost, retention) | Admin › Settings | `/settings/*` (PATCH `/settings/tenant` by the parallel builder) | manage_settings | present | present | Informatica scorecard settings |

## Programme lead (`programme_lead`, legacy `manager`)

| Job | v2 verb | Endpoint | Permission | Before | After | Benchmark |
|---|---|---|---|---|---|---|
| Landscape readiness by system and wave | Landscape (Systems / Waves view) | `GET /landscape`, `GET /migration/waves` | view | present | present | Syniti migration dashboards; Information Steward scorecards |
| Plan waves (objects, dates, stages) | Waves panel | `/migration/waves` CRUD | analyse | present | present | Syniti wave planning (inferred); SAP Migration Cockpit projects |
| Wave gate criteria: min score, zero criticals, contracts met | Waves panel › Gate (Save the gate) | `PUT /migration/waves/{id}/gate` | analyse | partial | present | SAP Activate quality gates; Syniti readiness gates (inferred) |
| Gate status on the Waves view | Landscape Waves view gate mark | `GET /migration/waves/gates` | view | missing | present | Monte Carlo data product health; Informatica scorecards |
| Readiness certificate for a wave | Waves panel › certificate link | `GET /migration/waves/{id}/certificate` | view | missing | partial | SAP Activate quality gate sign-off |
| Sign off a wave | current interface cockpit | `POST /migration/waves/{id}/signoff` | approve | partial | partial | SAP Migration Cockpit; Syniti |
| Balance work between stewards (by counts, objects or the template's slices) | People › Balance work | `POST /people/balance/plan`, `POST /people/balance/apply`, Undo `POST /actions/undo` | assign | missing | present | Informatica MDM task reassignment; Collibra workflow reassignment |
| Read data contracts and their breaches | People › Data contracts | `GET /contracts`, `GET /contracts/{id}/detail` | view | missing | present | Soda data contracts; Monte Carlo data products |
| Watch objects and get run, score and breach notices | Object canvas › Watch | `PUT /watches` | view | missing | present | Monte Carlo notifications; Soda alerts |
| Export the ledger or any grid | Share and export › Export to Excel | `POST /export/grid` | export | partial | present | Collibra export |
| Share a canvas with the steering committee | Share and export › Share this page as a link | `POST /share-links` | export | missing | present | GX Cloud shareable results; Monte Carlo share |
| Start extraction and analysis, schedules | System inspector; Admin › Runs | `/systems/{id}/downloads`, `/versions/{id}/analyse` | trigger_sync, analyse | present | present | Informatica CDQ jobs |
| Reports and report schedules | Reports | `/reports/*`, schedule CRUD | export | present | present | Information Steward scorecards; Collibra reports |

## Data steward (`data_steward`, legacy `steward`)

| Job | v2 verb | Endpoint | Permission | Before | After | Benchmark |
|---|---|---|---|---|---|---|
| Work the ledger: fix, propose, not an issue, accept risk | Work ledger, record inspector | `POST /work/decide` | apply / approve | present | present | SAP MDG change requests; Informatica MDM tasks |
| Accept suggested values in bulk | Work › Accept the suggested values | `POST /work/groups/{check}/accept-all` | apply | present | present | Informatica CLAIRE suggestions; Ataccama |
| Build a fix batch for approval | Work bulk bar | `POST /remediation/batches` | apply | present | present | SAP MDG mass change |
| Undo a decision | Toast Undo, Cmd+Z | `POST /actions/undo` | view | present | present | Linear undo |
| Comment and mention on a record or rule | Inspector › Comments | `POST /comments` | view | missing | present | Collibra comments; Ataccama task comments |
| Watch a rule or record | Inspector › Watch | `PUT /watches` | view | missing | present | Monte Carlo watchers |
| Fix the upstream object first | Work and record inspector fix-order hint ("Fix Material master first: 3,640 upstream failures") | `GET /objects/{module}/related` | view | missing | present | Monte Carlo lineage blast radius; Anomalo root cause |
| Out of office with a deputy | Preferences › Out of office; `?open=away` | `GET /delegations/mine`, `POST /delegations`, `DELETE /delegations/{id}` | view (self) | missing | present | SAP MDG substitution; Informatica task delegation |
| Saved and shared views of the ledger | Work Views menu; Share and export | `GET/PUT /views` | view | partial | present | PostHog saved views |
| Balance work in the team | People › Balance work | `POST /people/balance/*` | assign | missing | present | Informatica MDM task balancing (inferred) |
| Author rules | Rules canvas (step 6b) | `/rule-authoring/*` | manage_rules | present | present | Soda no-code checks; Ataccama rule builder |
| Import rules in bulk from the Rules canvas | Admin › Rules import (no link on the Rules canvas yet) | `POST /rules/bulk/import` | manage_rules | missing | partial | Soda contracts as code |
| See my own activity | Person inspector › Activity | `GET /people/{id}/activity` | view (self) | missing | present | Collibra activity |

## Data owner / approver (`data_owner`, legacy `approver`)

| Job | v2 verb | Endpoint | Permission | Before | After | Benchmark |
|---|---|---|---|---|---|---|
| Approve or send back a batch (four eyes) | Batch inspector › Approve, Send back | `POST /remediation/batches/{id}/approve`, `/send-back` | approve | present | present | SAP MDG approval step; Soda agreement approval |
| Out of office: approvals route to the deputy | Preferences › Out of office; banner on batch and person inspectors | `POST /delegations`, notification copy to the delegate (`delegation.route_copy`) | view (approve checked on the delegate) | missing | present | SAP MDG substitution rules; Informatica task delegation |
| Escalation chain after an SLA breach | Triage panel › Escalation chain (Save the chain); worker step | `GET/PUT /triage/escalation-chain`, `escalation.escalate_chain` in the SLA sweep | manage_triage / manage_settings / manage_rules | partial | present | Soda incident escalation; SAP MDG workflow deadlines |
| Create and edit a data contract | Data contracts › New contract; contract inspector | `POST /contracts`, `PUT /contracts/{id}` | manage_rules | partial | present | Soda contracts; Monte Carlo data products |
| Approve a contract (never their own) | Contract inspector › Approve | `PUT /contracts/{id}/activate` | approve | partial | present | Soda agreement stakeholder approval |
| Contract versions and revisions | Contract inspector › Versions, Revise as a new version | `POST /contracts/{id}/revise`, `GET /contracts/{id}/detail` | manage_rules / view | missing | present | Soda contract versions |
| Contract breaches | Contract inspector › Breaches | `GET /contracts/{id}/detail` | view | partial | present | Soda contract check results; Monte Carlo incidents |
| Apply the steward template to my objects | Object canvas › Steward template | `POST /admin/assignment-template/apply` (owner: own objects only) | approve (own objects) | missing | present | SAP MDG processor determination (inferred) |
| Watch my objects; subscriptions | Object canvas › Watch; Preferences | `/watches`, `/me/subscriptions` | view | missing | present | Monte Carlo audiences |
| Gate status of my objects' wave | Landscape Waves view | `GET /migration/waves/gates` | view | missing | present | SAP Activate quality gates |

## SAP Basis (`sap_basis`)

| Job | v2 verb | Endpoint | Permission | Before | After | Benchmark |
|---|---|---|---|---|---|---|
| Test a connection, health | System inspector › Test connection | `/systems/{id}/test-connection` | manage_systems | present | present | SAP Information Steward connections; Informatica runtime health |
| Extract objects | System inspector › Extract | `POST /systems/{id}/downloads` | trigger_sync | present | present | Informatica CDI tasks |
| Extraction dry run: row counts per table and a duration estimate | System inspector › Dry run | `POST /systems/{id}/downloads` (`dry_run: true`) | trigger_sync | missing | present | Informatica mapping preview (inferred); Syniti extraction estimate (inferred) |
| Delta extraction (changes only) | System inspector › Extract changes only | `POST /systems/{id}/downloads` (`delta: true`; CDHDR change documents) | trigger_sync | partial | present | SAP SLT / ODP delta; Informatica CDC |
| Schedules, retry, cancel | Admin › Runs and jobs | schedule CRUD, `/jobs/{id}/retry`, `POST /jobs/{id}/cancel` (parallel builder) | trigger_sync | present | present | Informatica schedules |
| Field mappings | Admin › Field mappings | `/field-mappings` (create and delete by the parallel builder) | manage_field_mappings | present | present | Informatica field mapping |
| Watch a system | API only (no button on the System inspector) | `PUT /watches` (`target_kind=system`) | view | missing | partial | Monte Carlo monitor subscriptions |

## Process analyst (`process_analyst`)

| Job | v2 verb | Endpoint | Permission | Before | After | Benchmark |
|---|---|---|---|---|---|---|
| Process readiness by step | Object › Processes tab | `GET /business-process/{run}/{module}` | view | present | present | Celonis process readiness (inferred); SAP Signavio |
| What if these rules were fixed (simulation) | Processes tab › What if these rules were fixed | client-side over the process document and the receipt (`lib/v2/what-if.ts`) | view | missing | present | Informatica none found; Anomalo root cause (closest) |
| Hand a blocking rule to a steward | Step inspector › Hand off | `POST /stewardship/handoff` | handoff_rule | present | present | Collibra workflow task |
| Export the as-is process | Processes, designer | `/process-export/*` | export_process | present | present | SAP Signavio export |
| Comment on a rule or step's rule | Rule inspector › Comments | `POST /comments` | view | missing | present | Collibra comments |
| Related objects and fix order | Object canvas › Related objects | `GET /objects/{module}/related` | view | missing | present | Monte Carlo lineage |

## Auditor and viewer (`auditor`, `viewer`)

| Job | v2 verb | Endpoint | Permission | Before | After | Benchmark |
|---|---|---|---|---|---|---|
| Read every canvas | All canvases, read-only | every GET | view | present | present | Collibra read-only consumers |
| Audit log and export (auditor) | Admin › Audit log | `GET /audit`, `/audit/export` | view_audit | present | present | Collibra audit; Informatica audit |
| A person's audit trail (auditor) | Person inspector › Activity | `GET /people/{id}/activity` | view_audit or manage_users (or self) | missing | present | Collibra user activity |
| Open a read-only share link | `/v2/share/<token>`; bar "Shared view" | `GET /share-links/resolve/{token}` | view (signed in; viewer narrowing) | missing | present | GX Cloud shareable validation URLs; Monte Carlo shared incident links |
| Export a grid (auditor) | Share and export › Export to Excel | `POST /export/grid` | export | partial | present | Collibra export |
| Read comments | Inspector › Comments | `GET /comments` | view | missing | present | Collibra |
| Rule change trail joining versions and runs | none yet | `GET /rules/{id}/history`, `/rules/{id}/versions` | view | missing | missing | Collibra asset history |

## Analyst (`analyst`) and AI reviewer (legacy `ai_reviewer`)

| Job | v2 verb | Endpoint | Permission | Before | After | Benchmark |
|---|---|---|---|---|---|---|
| Upload a file and analyse | Admin › Runs; current interface upload | `/upload`, `/versions/{id}/analyse` (rule set and modules options by the parallel builder) | upload, analyse | present | present | Soda scans; GX validations |
| Export any grid | Share and export | `POST /export/grid` | export | partial | present | Collibra export |
| Review AI-proposed rules (ai_reviewer) | Rules canvas › Learned (step 6b) | `/learned-rules/*` | review_ai_rules | present | present | Informatica CLAIRE rule suggestions |

## Stewardship template and related objects (product owner addition)

Source: "Steward assignment and related objects", version 1 (the approved best-practice document). Seeds:
`sap/object_relationships.yaml` (object to related objects with relation upstream, downstream or shared-reference,
plus the fixing-order tier) and `sap/steward_template.yaml` (object to owner role, steward slice by company code,
plant, sales organisation or purchasing organisation, steward teams, the reference-data steward and the span of
control). Tables: `assignment_templates`, `steward_assignments` (migration 105). The rows above marked Stewardship,
Related objects, fix order, owner apply and balancing "by the assignment template" are these.

| Piece | Where | Endpoint | Permission |
|---|---|---|---|
| Template editor | Admin › Stewardship | `GET/PUT /admin/assignment-template` | view / manage_settings |
| Apply with dry-run diff | Admin › Stewardship; Object canvas (owner) | `POST /admin/assignment-template/apply` | manage_settings; approve for own objects |
| Gaps (one owner, a steward per active slice) | Admin › Stewardship › Gaps | `GET /admin/assignment-template/gaps` | view |
| Slice assignments | People, balancing | `GET /admin/steward-assignments` | view |
| Related objects | Object canvas header | `GET /objects/{module}/related` | view |
| Fix-order hint | Work ledger, record inspector | `GET /objects/{module}/related` (`fix_hint`) | view |
| Balance by the template's slices | People › Balance work › By the assignment template | `POST /people/balance/plan` (`by: slice`) | assign |

## Endpoints added in step 6c

```
GET    /api/v1/comments?target_kind=&target_id=        {target_kind, target_id, comments: [{id, body, author_label, mentions, created_at, mine}]}
POST   /api/v1/comments                                 {target_kind, target_id, body, mentions[]} -> comment (201)
DELETE /api/v1/comments/{id}                            204
GET    /api/v1/comments/mentions/unread                 {count}
GET    /api/v1/watches?target_kind=&target_id=          {watching, events}
GET    /api/v1/watches/mine                             {watches: [...]}
PUT    /api/v1/watches                                  {target_kind, target_id, events[]}
DELETE /api/v1/watches?target_kind=&target_id=          204
GET    /api/v1/me/subscriptions                         {events: [{event, label, enabled, default}]}
PUT    /api/v1/me/subscriptions                         {event: bool}
GET    /api/v1/people/{user_id}/activity                {user_id, entries: [audit rows]}
GET    /api/v1/delegations/mine                         {away: [...], covering: [...]}
GET    /api/v1/delegations                              {delegations: [...]} (manage_users)
POST   /api/v1/delegations                              {to_user_id, starts_on, ends_on, reason?, from_user_id?} -> delegation (201)
DELETE /api/v1/delegations/{id}                         204
GET    /api/v1/triage/escalation-chain                  {steps: [{level, after_minutes, target, user_id, user_name}]}
PUT    /api/v1/triage/escalation-chain                  {steps: [...]}
GET    /api/v1/contracts/{id}/detail                    {contract, versions, breaches, checks}
POST   /api/v1/contracts/{id}/revise                    {note?} -> {id, version, status: draft}
GET    /api/v1/migration/waves/gates                    {gates: [{wave_id, name, modules, gate, status: {passed, checks}, certificate_href}]}
PUT    /api/v1/migration/waves/{id}/gate                {min_score?, zero_criticals, contracts_met} -> gate
GET    /api/v1/migration/waves/{id}/certificate         {wave_id, wave, final: false, passed, checks, note}
POST   /api/v1/people/balance/plan                      {by: owner|object|slice, module?, user_ids?} -> {before, after, moves, moved, people}
POST   /api/v1/people/balance/apply                     {by, moves: [{from, to, issue_ids}]} -> {moved, skipped, action_id}
POST   /api/v1/share-links                              {route, state, label?, expires_in_days} -> link + {token, url} (201)
GET    /api/v1/share-links?all=                         {links: [...]}
DELETE /api/v1/share-links/{id}                         204
GET    /api/v1/share-links/resolve/{token}              {route, state, role: viewer, expires_at, shared_by} (410 when expired or revoked)
GET    /api/v1/admin/config-bundle                      the bundle file (JSON download)
POST   /api/v1/admin/config-bundle/import?dry_run=      bundle -> {dry_run, sections: {name: {add, change, same, kept, items}}, totals}
POST   /api/v1/admin/view-as                            {role} -> {role, name, actions, read_only: true}
DELETE /api/v1/admin/view-as                            204
GET    /api/v1/rules/bulk/export?format=yaml|xlsx       file
POST   /api/v1/rules/bulk/import                        {format, content, module?, dry_run} -> {total, valid, invalid, created, rows}
POST   /api/v1/export/grid                              {title, route, columns, rows, filters?} -> branded xlsx
POST   /api/v1/systems/{id}/downloads                   + dry_run: true -> {tables, total_rows, unknown_tables, seconds, rate, rate_basis, delta}
                                                        + delta: true -> the extraction reads changes only
GET    /api/v1/views?route=                             + columns (the person's remembered columns), views[].shared, views[].mine
PUT    /api/v1/views                                    + shared
GET    /api/v1/objects/{module}/related                 {module, tier, related: [{module, label, relation, tier, open_criticals}], fix_hint}
GET    /api/v1/admin/assignment-template                {template, saved, updated_by, updated_at, active_slices, labels}
PUT    /api/v1/admin/assignment-template                {template}
POST   /api/v1/admin/assignment-template/apply          {modules?, dry_run} -> {owners, stewards, totals}
GET    /api/v1/admin/assignment-template/gaps           {objects, gaps: [{module, label, gap, slice_kind, slice_value, sentence}], based_on}
GET    /api/v1/admin/steward-assignments                {assignments: [...]}
Header X-View-As-Role: <role>                           honoured for manage_users holders; narrows every check; refuses writes
```
