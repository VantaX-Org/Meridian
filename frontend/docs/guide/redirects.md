# Old addresses and where they go

In October 2026 the map, canvas and inspector became the whole product. The landscape moved from `/v2` to `/`, and
every page of the earlier interface was removed. No job was lost: each page's work lives on a canvas,
a tab of an object, a panel or an inspector (see `docs/roles-and-features.md` at the repository root for every job and
its verb). Every old address, bookmarks and links in old emails included, answers with a permanent redirect (308) to
the place that does the same job now. The query of the old address rides along, so a run, an object or a filter stays
in the address; where the old filter has a new name the redirect writes it (`check` becomes `rule`, `mine=1` becomes
`assigned=me`, `kind=approvals` becomes `filter=approvals`).

Two kinds of target need a word:

- `/o/_/{object}`: the old object pages named an object without its system. The object canvas replaces `_` with the
  system that holds the object (the one with the most records checked for it) and keeps the rest of the address.
- `?open=kind:id`: the thing opens in the inspector over the page (`/?open=help`, `/work?open=inbox`,
  `/?open=golden:G1`).

The `/v2` addresses are kept for one release, so links shared before October 2026 still open.

Administration kept its addresses: `/admin/users`, `/admin/roles`, `/admin/settings`, `/admin/licence`,
`/admin/billing`, `/admin/mappings`, `/admin/reference`, `/admin/audit`, `/admin/alerts` and
`/admin/notifications` open the same section as before, and `/rules` and `/runs` are the rules library and the runs. The redirects are defined in `frontend/next.config.ts`;
`frontend/__tests__/legacy-redirects.test.ts` checks that each of the 78 routes the old interface served opens a page,
and `frontend/e2e/redirects.spec.ts` follows a sample of them in the browser.

## The table

### The /v2 addresses

The landscape lived under /v2 before October 2026. Kept for a release so bookmarks and share links still open.

| Old address | When | New address |
|---|---|---|
| `/v2` | always | `/` |
| `/v2/:path*` | always | `/:path*` |

### Home pages and ways to get somewhere

Home pages, per persona, and pages that were a way to get somewhere: the landscape is the start for every role.

| Old address | When | New address |
|---|---|---|
| `/home` | always | `/` |
| `/home/:persona` | always | `/` |
| `/dashboard` | always | `/` |
| `/insights` | always | `/` |
| `/insights/exec` | always | `/` |
| `/design` | always | `/` |
| `/search` | always | `/` |
| `/features` | always | `/?open=help` |
| `/help` | always | `/?open=help` |
| `/docs` | always | `/?open=help` |
| `/me/preferences` | always | `/?open=preferences` |
| `/attention` | always | `/work` |
| `/command-centre` | always | `/runs` |

### Fix work, cleaning and remediation

Fix work, cleaning and remediation: the Work ledger with the same filter.

| Old address | When | New address |
|---|---|---|
| `/fix` | `?batch=…` | `/work?batch=:batch` |
| `/fix` | `?tab=batches` | `/work?filter=approvals` |
| `/fix` | `?tab=monitor` | `/runs` |
| `/fix` | `?tab=cleaning` | `/work?filter=proposed` |
| `/fix` | `?check_id=…` | `/work?rule=:check` |
| `/fix` | `?check=…` | `/work?rule=:check` |
| `/fix` | `?mine=1` | `/work?assigned=me` |
| `/fix` | `?sugg=1` | `/work?filter=proposed` |
| `/fix` | `?action=export` | `/work?export=1` |
| `/fix` | always | `/work` |
| `/fix/what-if` | always | `/work` |
| `/fix/proposals/:runId` | always | `/work?filter=proposed` |
| `/fix/:id` | always | `/work?filter=proposed` |
| `/cleaning` | always | `/work?filter=proposed` |
| `/remediation` | always | `/work?filter=approvals` |
| `/issues` | always | `/work?assigned=me` |

### The inbox, approvals and exceptions

The inbox, approvals and exceptions: the inbox panel, or the ledger's chip for the same rows.

| Old address | When | New address |
|---|---|---|
| `/inbox` | `?kind=approvals` | `/work?filter=approvals` |
| `/inbox` | `?kind=exception` | `/work?filter=exceptions` |
| `/inbox` | `?kind=issues` | `/work?assigned=me` |
| `/inbox` | `?due=…` | `/work?due=:due` |
| `/inbox` | always | `/work?open=inbox` |
| `/inbox/notifications` | always | `/work?open=inbox` |
| `/notifications` | always | `/work?open=inbox` |
| `/workbench` | `?batch=…` | `/work?batch=:batch` |
| `/workbench` | `?tab=batches` | `/work?filter=approvals` |
| `/workbench` | always | `/work?open=inbox` |
| `/workbench/triage` | always | `/work?open=triage` |
| `/workbench/progress` | always | `/people` |
| `/workbench/report` | always | `/reports` |
| `/workbench/record/:issueId` | always | `/work` |
| `/stewardship` | always | `/people` |
| `/stewardship/metrics` | always | `/people` |
| `/exceptions` | always | `/work?filter=exceptions` |
| `/exceptions/rules` | always | `/work?filter=exceptions` |
| `/exceptions/:id` | always | `/work?filter=exceptions` |

### Objects

Objects: the object canvas and its tabs.

| Old address | When | New address |
|---|---|---|
| `/objects` | always | `/` |
| `/objects/:object` | `?tab=history` | `/o/_/:object/runs` |
| `/objects/:object` | `?tab=(?:rules|records)` | `/o/_/:object/rules` |
| `/objects/:object` | `?check_id=…` | `/o/_/:object/rules?open=rule%3A:check` |
| `/objects/:object` | `?rule=…` | `/o/_/:object/rules?open=rule%3A:check` |
| `/objects/:object` | `?tab=fix` | `/o/_/:object/records` |
| `/objects/:object` | always | `/o/_/:object` |
| `/objects/:object/records/:key` | always | `/work?module=:object&open=record%3A:object%3A:key` |
| `/objects/:object/rules/:ruleId` | always | `/r/:ruleId` |
| `/analyse` | always | `/` |
| `/analyse/coverage` | always | `/` |
| `/analyse/finding/:id` | always | `/` |
| `/analyse/object/:module` | always | `/o/_/:module` |
| `/analyse/material/:matnr` | always | `/work?module=material_master` |
| `/analyse/rule/:checkId` | always | `/r/:checkId` |
| `/findings` | `?version_id=…` | `/run/:run` |
| `/findings` | always | `/runs` |

### Insights

Insights: each view is a tab of an object, the rules library, the runs or People.

| Old address | When | New address |
|---|---|---|
| `/insights/readiness` | `?module=…` | `/o/_/:module/readiness` |
| `/insights/readiness` | always | `/?view=waves` |
| `/insights/process/designer` | `?module=…` | `/o/_/:module/processes/design` |
| `/insights/process/designer` | always | `/` |
| `/insights/process` | `?module=…` | `/o/_/:module/processes` |
| `/insights/process` | always | `/` |
| `/insights/lineage` | `?module=…` | `/o/_/:module/lineage` |
| `/insights/lineage` | always | `/` |
| `/insights/impact` | `?module=…` | `/o/_/:module` |
| `/insights/impact` | always | `/` |
| `/insights/rules` | `?module=…` | `/o/_/:module/rules` |
| `/insights/rules` | always | `/rules` |
| `/insights/duplicates` | `?module=…` | `/o/_/:module/golden` |
| `/insights/duplicates` | always | `/` |
| `/insights/mining` | always | `/rules?view=drafts` |
| `/insights/owners` | always | `/people` |
| `/insights/reports` | always | `/reports` |
| `/insights/trends` | always | `/runs` |
| `/insights/forecast` | always | `/runs` |
| `/insights/progress` | always | `/runs` |
| `/insights/operations` | always | `/runs` |
| `/executive-report` | always | `/reports` |
| `/analytics` | always | `/runs` |
| `/config-impact` | always | `/` |
| `/business-process` | always | `/` |
| `/lineage` | always | `/` |
| `/mining` | always | `/rules?view=drafts` |
| `/relationships` | always | `/` |
| `/dedup` | always | `/` |

### Processes

Processes: the Processes tab of an object, and its designer.

| Old address | When | New address |
|---|---|---|
| `/process` | always | `/` |
| `/process/designer` | always | `/` |
| `/process/runs` | always | `/runs?view=jobs` |
| `/process/runs/:runId` | always | `/runs?view=jobs` |
| `/process/:l1` | always | `/` |

### Master data

Master data: the Glossary and Golden records tabs of an object; one term or golden record opens in the inspector.

| Old address | When | New address |
|---|---|---|
| `/mdm` | always | `/` |
| `/mdm/glossary` | always | `/` |
| `/mdm/glossary/:id` | always | `/?open=term%3A:id` |
| `/mdm/golden/merge` | `?id=…` | `/?open=golden%3A:id` |
| `/mdm/golden/merge` | always | `/` |
| `/mdm/golden` | `?object=…` | `/o/_/:object/golden` |
| `/mdm/golden` | always | `/` |
| `/mdm/golden/:id` | always | `/?open=golden%3A:id` |
| `/mdm/match-rules` | always | `/` |
| `/mdm/survivorship` | always | `/` |
| `/glossary` | always | `/` |
| `/glossary/:id` | always | `/?open=term%3A:id` |
| `/golden-records` | always | `/` |
| `/golden-records/:id` | always | `/?open=golden%3A:id` |
| `/golden-records/:id/merge` | always | `/?open=golden%3A:id` |
| `/match-rules` | always | `/` |
| `/match-rules/constraints` | always | `/` |
| `/match-rules/tuning` | always | `/` |

### Migration

Migration: the landscape's Waves view and the waves panel (gates, sign-off, certificate).

| Old address | When | New address |
|---|---|---|
| `/migration` | always | `/?view=waves&open=waves` |
| `/migration/dry-run` | always | `/?view=waves&open=waves` |
| `/migration/:waveId` | always | `/?view=waves&open=waves` |

### Rules

Rules: the rule canvas, the library and its drafts, contracts in People, scoring in Administration.

| Old address | When | New address |
|---|---|---|
| `/rules/contracts` | always | `/people?open=contracts` |
| `/rules/dictionary` | always | `/rules` |
| `/rules/drafts` | always | `/rules?view=drafts` |
| `/rules/learned` | always | `/rules?view=drafts` |
| `/rules/scoring` | always | `/admin/settings` |
| `/rules/:ruleId` | always | `/r/:ruleId` |
| `/contracts` | always | `/people?open=contracts` |
| `/settings/scoring` | always | `/admin/settings` |
| `/settings/rules` | always | `/rules` |
| `/ai/rules` | always | `/rules?view=drafts` |

### Runs

Runs: one run, and two runs compared.

| Old address | When | New address |
|---|---|---|
| `/runs/:a/vs/:b` | always | `/run/:a/vs/:b` |
| `/runs/:versionId` | always | `/run/:versionId` |
| `/versions` | always | `/runs` |
| `/data/runs/:id` | always | `/run/:id` |

### Systems

Systems: each system's canvas; connecting a new one; extracting from the landscape's system inspector.

| Old address | When | New address |
|---|---|---|
| `/systems` | `?connect` | `/s/new` |
| `/systems` | `?extract=…` | `/?open=system%3A:system` |
| `/systems` | always | `/` |
| `/systems/:id/extractions/:runId` | always | `/s/:id?tab=extractions` |
| `/systems/:id/versions/:versionId/profile` | always | `/run/:versionId` |
| `/systems/:id/pilot` | always | `/s/:id` |
| `/systems/:id` | always | `/s/:id` |
| `/connectivity` | always | `/` |
| `/run-sync` | always | `/` |
| `/data` | always | `/` |
| `/sync` | always | `/` |

### Data in

Data in: uploading a file is a block of Administration, Start and schedule.

| Old address | When | New address |
|---|---|---|
| `/import` | always | `/admin/runs` |
| `/upload` | always | `/admin/runs` |

### Administration

Administration: the same sections at /admin/{section}; the few that moved or were renamed.

| Old address | When | New address |
|---|---|---|
| `/admin/roles` | `?tab=keys` | `/admin/apikeys` |
| `/admin/jobs` | always | `/admin/system` |
| `/admin/sign-in` | always | `/admin/signin` |
| `/admin/triage` | always | `/work?open=triage` |
| `/admin/ai` | always | `/admin/settings` |
| `/settings/field-mapping` | always | `/admin/mappings` |
| `/settings/ai` | always | `/admin/settings` |
| `/settings/licence` | always | `/admin/licence` |
| `/settings/exception-billing` | always | `/admin/billing` |
| `/settings` | always | `/admin/settings` |

