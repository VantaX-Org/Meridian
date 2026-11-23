# Feature coverage audit

Branch feat/coverage, from ux/all. Scope: every backend capability under `api/routes` (151 router files, 920 routes) against the new frontend (`frontend/ui`, clients in `frontend/lib/api` and `frontend/lib/api/v2`).

## Method and its limits

A client export in `lib/api` or `lib/api/v2` with no consumer in `ui/`, `app/`, `lib/` or `components/` (tests and its own file excluded) means no screen reaches that endpoint. This is a static, name-based check. It can miss callers that use a path constant, and it cannot find a backend route that has no client function at all except by comparing the route list with the client paths. Treat the counts as approximate (plus or minus about 10 percent). Nothing was invented: a capability is listed only when a route and a client function exist.

Statuses:

- WIRED: a screen in a journey calls the endpoint.
- ORPHAN: a typed client function exists, no screen calls it.
- LEGACY: reachable only through LegacyFrame or LegacyMount. Neither has any usage in `app`, `ui` or `lib`, so this set is empty.
- MISSING: user-facing route with neither client nor screen.
- INTERNAL: not meant for a screen.

## Counts (routes)

| Status | Approx. routes | Note |
| --- | --- | --- |
| Total | 920 | `routes.txt` from `api/routes` |
| INTERNAL | 25 | list below |
| LEGACY | 0 | no LegacyFrame or LegacyMount usage |
| ORPHAN | about 105 | 137 unused v2 client exports, about 105 map to a route; about 17 fixed on this branch |
| MISSING | not measurable by this method | v1-only clients in `lib/api` are dead old-UI code; their v2 equivalents were counted as WIRED where a screen uses them |
| WIRED | the remainder, about 790 | |

## Internal-only routes (no screen by design)

- `health` (3): liveness and readiness probes.
- `prom_metrics` (1): Prometheus scrape.
- `client_errors` (1): browser error beacon.
- `scim` (17): SCIM 2.0 provisioning, called by the identity provider. The token is managed on the Enterprise admin screen.
- `auth_oidc` (3): sign-in redirect, callback, session read.
- Webhook and worker callbacks and the public status page feed: called by other systems. The status page itself is read on Admin, Enterprise.

## Fixed on this branch

| Capability | Endpoints | Where | Home journey |
| --- | --- | --- | --- |
| Steward queue: filter, approve, reject, escalate, bulk approve confident items, item lifecycle stepper | GET `/stewardship/queue`, POST resolve, POST escalate, POST bulk-approve | `ui/screens/people/StewardQueue.tsx`, rendered in Stewardship | People, Stewardship |
| Maintenance windows: add and remove (PUT replaces list, max 20, UTC) | PUT `/settings/maintenance` | `ui/screens/admin/ops/MaintenanceEditor.tsx`, in Admin, Enterprise | Admin, Enterprise |
| Settings writes: theme (name, accents), logo upload and remove, compliance and retention days, automation, chat alerts and test | PUT `/settings/theme`, POST `/settings/theme/logo`, PUT `/settings/compliance`, PUT `/settings/retention`, PUT `/settings/automation`, PUT `/settings/chat-alerts`, POST `/settings/chat-alerts/test` | `ui/screens/admin/ops/{ThemeEditor,ComplianceEditor,AlertSettings}.tsx`, in Admin Enterprise, Data and Notify | Admin |
| Triage configuration: SLA policy reset, team edit and members, assignment rule add (three steps) and reorder, escalation chain, working calendar and fallback owner | DELETE `/triage/sla-policies/{id}`, PATCH `/triage/teams/{id}`, PUT `/triage/teams/{id}/members`, POST `/triage/rules`, POST `/triage/rules/reorder`, PUT `/triage/escalation-chain`, GET and PUT `/triage/settings` | `ui/screens/admin/ops/TriageConfig.tsx`, mounted in `Triage.tsx` | Admin, Triage settings |
| Data contracts: edit a draft or pending contract, set limits and enforcement behind a confirm, create a contract for one object in three steps (object picked from the landscape) | PUT `/contracts/{id}`, PUT `/contracts/{id}/enforcement`, POST `/contracts` | `ui/screens/people/ContractTerms.tsx`, in Contracts | People, Contracts |
| Admin: manager picker on a person, API key edit (name, role, expiry), field mapping create, schedule edit, extraction history (profiles and sync runs per system) | PUT `/users/{id}/manager`, PATCH `/admin/api-keys/{id}`, POST `/field-mappings`, GET and PATCH `/schedules/{id}`, GET `/systems/{id}/profiles`, GET `/systems/{id}/runs` | `ui/screens/admin/access/{Users,ApiKeys}.tsx`, `ui/screens/admin/ops/{Mappings,Schedules}.tsx` | Admin |
| Steward assign: owner picker fed by the assignable users list, empty releases the item | PUT `/stewardship/{id}/assign` | `ui/screens/people/StewardQueue.tsx` | People, Stewardship |
| Reports, digests, workflows, custom objects: report schedule edit, digest read before edit, workflow create and new version (three-step and two-step flows, activate behind a confirm), custom object registry edit and anomaly confirm or dismiss | PUT `/reports/schedules/{id}`, GET `/digests/{id}`, GET `/workflows/definitions/{id}`, POST `/workflows/definitions`, POST `/workflows/definitions/{id}/versions`, GET and PUT `/z-objects/registry/{id}`, POST `/z-objects/anomalies/{id}/feedback` | `ui/screens/admin/Reports.tsx`, `ui/screens/people/Digests.tsx`, `ui/screens/requests/WorkflowEditor.tsx`, `ui/screens/systems/CustomTab.tsx` | Admin, People, Work, Systems |

Tests: `people.test.tsx` (three new cases), `MaintenanceEditor.test.tsx`, `SettingsWrites.test.tsx`, `TriageConfig.test.tsx`, `ContractTerms.test.tsx`, `AdminWrites.test.tsx`, `Digests.test.tsx`, `requests.test.tsx` (workflow case), `CustomTab.test.tsx`.
| Dedup candidates, preview, merge | GET `/dedup/candidates`, POST `/dedup/preview`, POST `/dedup/merge` | `ui/screens/work/Dedup.tsx`, Duplicates tab of the cleaning queue | Clean |
| Rule authoring: dry run, publish, update draft, version diff | PUT `/rule-authoring/drafts/{id}`, POST `/rule-authoring/dry-run`, POST `/rule-authoring/drafts/{id}/publish`, POST `/rules/{id}/versions`, GET `/rules/{id}/versions/{v}/diff` | `ui/screens/rules/DraftReview.tsx` (Review sheet in Drafts), `RuleFix.tsx` (Propose a new version). `dryRunDraft` and `publishDraft` in object.ts hit the same routes as the wired rulelib calls, so they stay unused duplicates | Rules |
| Learned monitors: break evidence | GET `/aletheia/monitors/{id}/evidence` | `ui/screens/insights/BreakEvidenceSheet.tsx`, Evidence button on the Learned monitor view | Monitor |
| Learned rules: review, mine; mined rule accept | GET `/learned-rules/review`, POST `/learned-rules/mine`, POST `/rules/mined` | `ui/screens/rules/LearnedReview.tsx`, `ui/screens/runs/MinedDependencies.tsx` (profile tab, confirm first, needs manage_rules) | Rules, Clean |
| Survivorship: put, preview | `previewSurvivorship`, `putSurvivorshipRulesV2` (`putSurvivorship` in `designer.ts` is an unused duplicate client of the same preview route) | `ui/screens/mdm/SurvivorshipSave.tsx`: Save rules opens a preview sheet, then a confirm that names the rule and golden value counts | Rules |
| Fix drafts and cleaning plan | `draftFix`, `getCleaningPlan` | `ui/screens/work/CleaningPlan.tsx`, the Plan tab in Clean; Draft a fix needs manage_rules and stores the draft as pending | Clean |
| Split scope | `splitScope` | `ui/screens/runs/SplitCapped.tsx` on the Run overview: preview, then a confirm naming the scope count before the SAP read is queued (trigger_sync) | Run |
| Migration run: value candidates and value-map proposals, reconciliation records, target workbook check | GET `/migration/runs/{id}/value-candidates`, PUT `/migration/value-map`, GET `/migration/runs/{id}/reconciliation/records`, POST `/migration/target-workbook/{version_id}/check` (`loadParams` is its query builder) | `ui/screens/load/RunExtras.tsx`: Value mapping tab, records under Reconciliation, Target workbook tab of the run screen | Load |
| Batches: run records, export to SAP (preview then confirm), confirm loaded | `getBatchRunRecords`, `sendBatchToSap`, `confirmBatchLoaded` (GET `/writeback/batches/{id}/run/records`, POST `/remediation/batches/{id}/export`, POST `/remediation/batches/{id}/loaded`) | `ui/screens/work/BatchSend.tsx`, in the batch detail of Approvals; export needs the export permission, load confirmation needs approve or manage_systems | Load |
| External database: preview and load | `previewDb`, `loadDb` | `ui/screens/admin/ops/DbLoad.tsx`, under a selected connection in External database; needs manage_systems, preview first, confirm names the row cap | Load |
| Sandbox enter and exit, digest read | `enterSandbox`, `exitSandbox`, `getDigest` | `ui/screens/admin/access/SandboxPanel.tsx` in Admin Settings (anchor `#sandbox`): Stepper, confirm naming the copy choice and the held-back deliveries on entry, confirm naming the discarded runs and held-back count on exit, per-table row counts after; needs manage_system. `getDigest` is a fresh single read in the People Digests detail (it returns the same shape as the list) | Admin, People Digests |

Tests: `people.test.tsx` (two new cases), `MaintenanceEditor.test.tsx`, `LearnedReview.test.tsx`, `BreakEvidenceSheet.test.tsx`, `MinedDependencies.test.tsx`, `SurvivorshipSave.test.tsx`, `CleaningPlan.test.tsx`, `SplitCapped.test.tsx`, `RunExtras.test.tsx`, `BatchSend.test.tsx`, `DbLoad.test.tsx`. `SandboxPanel.test.tsx`, `Digests.test.tsx` (detail read).

## ORPHAN capabilities (client exists, no screen)

Suggested home is the journey where the user would expect it.

| Capability | Client functions | Endpoints | Suggested home |
| --- | --- | --- | --- |
| Cost features read, AI audit read | `getCostFeatures`, `getAiAudit` | `/settings/cost-model/features`, `/audit/llm` | Admin |
| Subscriptions, delegations | `putSubscriptions`, `getAllDelegations` | `/me/subscriptions`, `/delegations` | Me |
| Dedup candidates, preview, merge | `getDedupCandidates`, `getDedupCandidatesFor`, `previewDedup`, `mergeDedup` | `/dedup/*` | Clean |
| Learned monitors: break evidence | `getBreakEvidence` | `/aletheia/monitors/{id}/evidence` | Monitor |
| Learned rules: review, mine, approve; mined rule accept | `getLearnedReview`, `mineFixes`, `acceptMinedRule` | `/learned-rules/*`, `/rules/mined` | Rules |
| Rule authoring: dry run, publish, update draft, version diff | `dryRunDraft`, `publishDraft`, `updateDraft`, `createRuleVersion` | `/rule-authoring/*`, `/rules/{id}/versions/{v}/diff` | Rules |
| Sandbox enter and exit | `enterSandbox`, `exitSandbox` | `/admin/sandbox/*` | Admin |
| Data contracts: update, enforcement, create per object | `updateContract`, `setEnforcement`, `createObjectContract` | `/contracts` | People, Contracts |
| Analytics: prescriptive, bottlenecks, capacity, sprints, finding impact, MDM health series and history | `getPrescriptive`, `getBottlenecks`, `getCapacity`, `getSprintPlan`, `getFindingImpact`, `getMdmHealthSeries`, `getMdmHistory` | `/analytics/*`, `/mdm-metrics/history` | Home and Monitor |
| Design: table, config, diff | `getDesignTable`, `getDesignConfig`, `getDesignDiff` | `/systems/{id}/design/*` | Objects, per system |
| Process mining summary and graph | `getMiningRunSummary`, `getMiningGraph` | `/mining/summary/*`, `/process/mining/graph/*` | Objects, processes |
| Config: process, root cause v2, rediscover, match summary | `getConfigProcess`, `getConfigRootCauseV2`, `rediscoverConfig`, `getConfigMatchSummary` | `/config/*`, `/versions/{id}/config-matches/summary` | Objects, config |
| Discovery: health, schedules, run model | `getDiscoveryHealth`, `addSchedule`, `patchSchedule`, `getRunModel` | discovery routes | Admin, Systems |
| Connectivity config snapshot | `getConfigSnapshot` | `/connectivity/config/{system}/{module}` | Admin, Systems |
| Lineage blast radius | `getBlastRadius` | `/lineage/blast-radius/*` | Objects, lineage |
| Reference data usage | `getRefUsage` | `/reference-data/lists/{id}/usage` | Objects, reference data |
| Migration: value candidates, value map, load params, reconciliation records, target workbook check | `getValueCandidates`, `saveValueMap`, `loadParams`, `getReconciliationRecords`, `checkTargetWorkbook` | migration routes | Load |
| Batches: run records, send to SAP, confirm loaded | `getBatchRunRecords`, `sendBatchToSap`, `confirmBatchLoaded` | `/writeback/batches/*`, `/remediation/batches/*` | Load |
| External database preview and load | `previewDb`, `loadDb` | external-db routes | Load |
| Survivorship: put, preview | `putSurvivorship`, `previewSurvivorship` | `/survivorship-rules*` | Rules |
| Fix drafts and cleaning plan | `draftFix`, `getCleaningPlan` | `/aletheia/fix-drafts`, `/aletheia/cleaning-plan` | Clean |
| Split scope | `splitScope` | `/systems/{id}/versions/{v}/split-scope` | Run |
| Admin (left): `GET /systems/{id}/runs` is declared twice, in sync runs and in process discovery; sync runs is registered first so the process discovery list route is shadowed. The sync runs view uses it. | | `api/routes/process_discovery.py` L619 | Backend |
| Workflow definitions: get, new version, create | `getDefinition`, `newVersion`, `createDefinition` | `/workflows/definitions*` | Work, Requests |
| Z-object registry: get, update, anomaly feedback | `getZEntry`, `updateZEntry`, `feedbackZAnomaly` | `/z-objects/*` | Objects, Z-objects |
| Report schedule update | `updateSchedule` | `/reports/schedules/{id}` | Reports |
| Admin: user manager, API key update, field mapping create, sync runs and profiles, run schedule get and patch | `setUserManager`, `updateApiKey`, `createFieldMapping`, `listSyncRuns`, `listProfiles`, `getRunSchedule`, `patchRunSchedule` | `/users/{id}/manager`, `/licence`, `/field-mappings`, `/systems/{id}/runs`, `/schedules/{id}` | Admin |
| Record findings, glossary batch lookup, DQ firewall validate, AI feedback | `getRecordFindings`, `glossaryBatchLookup`, `validateRecords`, `sendAiFeedback` | various | Objects, Clean |

## Left to feat/claims (export, import, download)

Owned by the other agent, not touched here: `exportGrid`, `exportBundle`, `importBundle`, `exportObjects`, `exportObject`, `exportParams`, `exportFixSheetByObject`, `exportRunSteps`, `exportTargetWorkbook`, `downloadRunReport`, `downloadBatchSheet`, `batchSheetCsv`, `downloadReconciliationWorkbook`, `downloadConfigMatches`, `uploadFix`, `uploadRows`, `uploadDataFile`, `rejectedCsv`, `postDownload`, `extractionDryRun`, `extractDelta`, `putTemplate`.

## Why the rest is not built

About 100 orphan endpoints remain. Each needs its own design (forms, pickers, previews, confirmations) and several are destructive or write to SAP (merge, send to SAP, publish, sandbox). Building them in one pass would mean guessing at screens that need product decisions and a Fable look pass. They are listed by journey above so the next batches can take one journey at a time.
