# PLAN_AURORA.md

> **Codename Aurora — "The Meridian Experience, Redesigned."**
> Target branch: `redesign/aurora`. Scope: frontend only. Supersedes v3.0 Pillar B §12–§20 in full. Backend Pillars A + C unchanged.

This plan operationalises the **Aurora Experience Spec** (Parts I–VI) and the **Aurora Operating Manual** (Parts A–D). It is the contract between the spec and the PRs that ship against it. Everything here is a decision or an explicit ambiguity — it does not restate the spec.

**Reference calibration** per workspace:

| Workspace | Calibrated against |
|---|---|
| Command Centre | Linear Inbox (three-section queue), Raycast (⌘K feel), Stripe (verdict typography) |
| Workbench | Attio (table-as-UI density), Linear (issue drawer, J/K cycling), Apple Finder Quick Look (drawer pattern) |
| Process | Celonis Process Intelligence (graph rendering, variant switching) — flatter, more confident, no drop shadows |
| Admin | Stripe Dashboard (flat scrollable settings), Vercel (destructive-action pattern) |

**Explicit anti-patterns to fail-close on:** generic shadcn/Tailwind template ("Vercel ecosystem B2B"), Collibra tree nav, Informatica desktop port, SAP Analytics Cloud card soup, Tableau tooltip-first, Ataccama multi-tab modal dialogs.

---

## 1. Stacked PR sequence

Nine PRs. One hotfix into `main`, eight workstreams stacked onto `redesign/aurora`. Only the final workstream (WS8) merges `redesign/aurora` back to `main`.

| # | Branch | Scope | Duration | Depends on |
|---|---|---|---|---|
| **PR-H** | `devin/<ts>-aurora-hotfix` off `main` | `/findings` + `/stewardship` `limit` mismatch; `INTERNAL_API_URL` missing in `docker/docker-compose.customer.yml`. **Must land before WS1.** | ~0.5 day | — |
| **WS1** | `redesign/aurora-ws1-tokens` → `redesign/aurora` | Design system foundations: Aurora token export, motion/duration/easing tokens, six-size type scale, 12+ custom SAP icons, dark-first `aurora.css` + `[data-theme="light"]`, CLAUDE.md design-system section rewrite. No components rendered. | 2 weeks | PR-H |
| **WS2** | `redesign/aurora-ws2-foundational` → `redesign/aurora` | Twelve foundational primitives under `components/aurora/`: Text, Icon, Stack, Divider, Button, Input, Select, Combobox, Textarea, Chip, Avatar, Banner. Storybook spins up. Playwright visual-baseline established. Gate 1 review. | 2 weeks | WS1 |
| **WS3** | `redesign/aurora-ws3-data` → `redesign/aurora` | Data primitives: virtualised Table (TanStack Virtual, 200k rows @ 60fps, J/K), ECharts-wrapped Chart family (Line/Bar/Area/Radar/Heatmap/Sparkline) with global Aurora theme, React-Flow-wrapped ProcessGraph (custom node/edge), Stat, KpiRail. | 2 weeks | WS2 |
| **WS4** | `redesign/aurora-ws4-shell` → `redesign/aurora` | AppShell (48px rail + 48px top bar), WorkspaceSwitcher (⌘1–⌘4), restyled CommandPalette (≤80ms open), Tabs (underline, not pills), Breadcrumb (in top bar), Drawer (right-slide, URL-routable, J/K, 40% viewport). | 1 week | WS3 |
| **WS5** | `redesign/aurora-ws5-moments` → `redesign/aurora` | **Design gate.** The twelve signature moments — VerdictCard, ProcessGraphEmergence, FixPlaybook, BulkActionPanel, AnalysisArrivalBanner, CommandPalette-open, AskStreamingCard, RowHoverPreview, KanbanDrop, ConnectionTestButton, SavedViewChip, EmptyState. Framer Motion choreography per moment. Gate 2 review. | 2 weeks | WS4 |
| **WS6** | `redesign/aurora-ws6-command-centre` → `redesign/aurora` | Command Centre workspace — Verdict area + four tabs (Inbox, Trends, Issues, Ask). Surfaces `/api/v1/metrics/llm-savings` via the Admin → AI tab shortcut but references savings in Command Centre verdict when in Tier 1.5/2 states (first-class signal, not hidden). | 1.5 weeks | WS5 |
| **WS7** | `redesign/aurora-ws7-workbench-process` → `redesign/aurora` | Workbench (triage table + record drawer + Fix Playbook + Record Report + saved-views rail + Golden Records/Glossary/Analyses/Reports tabs + Upload/Run-Analysis modal flows) **plus** Process workspace (Map/Variants/Cases/Config-Impact/**Process Report** tabs). Reviewed in two passes inside one PR. See **§2.5** for the Reports detail surface. | 2.5 weeks | WS5 |
| **WS8** | `redesign/aurora-ws8-admin-cutover` → `main` (squash) | Admin workspace (Users & Roles, Connections, Sync Monitor, AI, Rules, Licence, Settings + embedded Doctor + Audit Log); writing-system ESLint rule; Playwright perf budgets; visual-regression sweep; a11y audit; feature-flag cutover (move `/app/(dashboard)/` → `/app/(legacy)/`). Gate 3 review. **This is the umbrella PR that hits `main`.** | 2 weeks | WS6, WS7 |

**Total calendar: 10–12 weeks of frontend work. Nine PRs. One merge to `main`.**

---

## 2. Four-workspace mapping — 30 routes → 4 workspaces

Authoritative migration table. No route is lost; everything becomes a tab, filter, modal, or deep-link inside one of the four workspaces. `/app/aurora/*` is built behind a feature flag; `/app/(dashboard)/*` stays live until the WS8 cutover.

### 2.1 Command Centre (`/app/aurora/command-centre/`)

| Legacy route | Aurora home | Shape |
|---|---|---|
| `/` | Command Centre root | Verdict card + tab row |
| `/analytics` | Command Centre → **Trends** tab | Four small-multiples + dimension radar, shared crosshair |
| `/notifications` | Command Centre → **Inbox** tab (Overnight section) | Inline list, no separate page |
| `/findings` | Command Centre → **Issues** tab | Deep-link into Workbench filter; rendered inline as a compact queue |
| `/nlp` | Command Centre → **Ask** tab | Perplexity-style streaming card list + ⌘K `ask:` prefix |

### 2.2 Workbench (`/app/aurora/workbench/`)

| Legacy route | Aurora home | Shape |
|---|---|---|
| `/stewardship` | Workbench root | Triage table + record drawer |
| `/stewardship/metrics` | Workbench → filter-driven drawer stat block | Absorbed; not a separate page |
| `/exceptions` | Workbench (saved view: `type=exception`) | Saved filter chip |
| `/cleaning` | Workbench (saved view: `type=cleaning`) | Saved filter chip |
| `/dedup` | Workbench (saved view: `type=dedup`) | Saved filter chip |
| `/ai/rules` | Workbench (saved view: `type=ai-rule-review`) | Saved filter chip |
| `/golden-records` + `/golden-records/[id]` | Workbench → **Golden Records** tab | Tab; `[id]` opens in drawer, "Open Report" promotes to full Record Report (§2.5) |
| `/glossary` + `/glossary/[id]` | Workbench → **Glossary** tab | Tab; `[id]` opens in drawer |
| `/upload` | Workbench → action: "Upload" | Modal flow, not a page |
| `/run-sync` | Workbench → action: "Run Analysis" | Modal flow, not a page |
| `/versions` | Workbench → **Analyses** tab | Analyses list, each analysis has its own Analysis Report (§2.5) |
| `/reports` | Workbench → **Reports** tab | Report list + detail view (§2.5) |

### 2.3 Process (`/app/aurora/process/`)

| Legacy route | Aurora home | Shape |
|---|---|---|
| `/mining` | Process root (→ **Map** tab) | React Flow + Dagre, materialisation moment |
| `/business-process` | Process → **Processes** tab | Ranked variant/process table; each row promotes to a Process Report (§2.5) |
| `/config-impact` | Process → **Config Impact** tab | SPRO ↔ findings mapping; feeds the Process Report |
| `/relationships` | Process → **Relationships** tab | Network view |
| *(new)* | Process → **Report** tab | L1–L5 readiness document for the currently selected process (§2.5) |

### 2.4 Admin (`/app/aurora/admin/`)

| Legacy route | Aurora home | Shape |
|---|---|---|
| `/settings` | Admin root (→ **Settings** tab with embedded Doctor card) | Flat scrollable panel |
| `/settings/ai` | Admin → **AI** tab | LLM mode + proxy + budgets + usage charts |
| `/settings/rules` | Admin → **Rules** tab | Rule catalog management |
| `/settings/field-mapping` | Admin → **Settings** tab (sub-section) | Absorbed; not a separate tab |
| `/settings/licence` | Admin → **Licence** tab | Licence status + entitlements |
| `/systems` + `/connectivity` | Admin → **Connections** tab (merged) | Unified connector list |
| `/sync` | Admin → **Sync Monitor** tab | Job queue, failures, retry |
| `/contracts` | Admin → **Settings** tab (sub-section) | Absorbed into Settings |
| `/llm-savings` | Admin → **AI** tab (sub-panel) | Surfaced first-class in Command Centre verdict when savings ≥ threshold (backend `/api/v1/metrics/llm-savings`) |

### 2.5 Detailed Reports — per-record in Workbench, per-process in Process

Meridian's differentiator isn't the queue; it's the **report** it produces for each record or process. Aurora formalises this into two first-class report surfaces, each reachable from multiple entry points and each shareable as a standalone URL.

#### 2.5.1 Record Report (Workbench)

Every row in the triage table has a canonical **Record Report** — the narrative document a steward or auditor reads to understand *what is wrong with this specific master-data record, why it matters, and what to do about it*. Built in **WS7**, consumes WS2/WS3/WS5 primitives.

Entry points:
- Row hover → "Open report" affordance (signature moment #08 hover).
- Drawer header → "Open as report" (drawer is the triage view; report is the full surface).
- Deep link — `/workbench/record/<record-slug>/report` is URL-routable and shareable.
- ⌘K → `report <record-id>`.

Structure (scrolling single page, not a modal, not a tab group):

| Section | Content | Backend source |
|---|---|---|
| **1. Verdict header** | Display-lg verdict sentence ("Business partner BP-1203187 has three blocking data-quality defects") + severity chip + last-updated micro | Derived client-side from finding set |
| **2. Context strip** | Owning module (BP/MM/FI/…), system, golden-record link if applicable, process(es) the record participates in | `/api/v1/stewardship/queue/{id}`, `/api/v1/golden-records/{id}` |
| **3. What's wrong** | Per-check finding list with severity chip, field-level evidence, pass-rate bar, and **Fix Playbook** excerpt (signature moment #03) | `/api/v1/findings?record_id=<id>`, `/api/v1/fix_playbook?check_id=<id>` (backend ask — see §10) |
| **4. Config impact** | Feature-level downstream impact derived from 52 rules in `db/seeds/config_impact_rules.yaml` | `/api/v1/config-impact?record_id=<id>` |
| **5. Related records** | Dedup cluster, referenced-by relationships, golden-record peers | `/api/v1/match-scores?record_id=<id>` |
| **6. Fix history** | Prior fixes on this `check_id` for this tenant — how many times, avg duration, success rate | `/api/v1/fix_history?check_id=<id>` (backend ask) |
| **7. Activity** | Audit trail: assignments, status changes, comments | `/api/v1/stewardship/queue/{id}/activity` |
| **8. Action bar** | Escalate / Reject / Approve / Bulk-apply-to-siblings — sticky bottom bar | `/api/v1/stewardship/queue/{id}/transition` |

Print / PDF export available via header action; HTML → PDF rendering reuses existing `workers/tasks/render_pdf.py` (no new backend work). Typographically-led layout — a report reads like a Stripe receipt, not a dashboard tile.

Copy rule: every sentence teaches / directs / confirms. Zero placeholders. Lint-enforced by the Aurora writing rule from WS8.

#### 2.5.2 Process Report (Process)

Every process in the mining / business-process catalogue has a canonical **Process Report** — the L1–L5 readiness document Meridian already generates server-side via `services/process_writer.py`, now given a proper Aurora surface instead of a PDF-first dump. Built in **WS7**, Process Map materialisation plays on entry (signature moment #02).

Entry points:
- Processes tab row → "Open report".
- Process Map node → right-click / Enter → "Open report".
- Deep link — `/process/<process-slug>/report`.
- ⌘K → `process report <process-name>`.

Structure:

| Section | Content | Backend source |
|---|---|---|
| **1. Verdict header** | Display-lg verdict sentence ("Order-to-Cash for DE01 is 62% ready; two L3 gates are blocked"), readiness score chip, process owner | Derived from readiness scoring |
| **2. L1–L5 hierarchy** | Collapsible tree: L1 process → L2 sub-process → L3 process step → L4 activity → L5 field. Each level shows readiness %, owning module, and count of blocking findings | `/api/v1/business-process?process=<slug>` (existing) |
| **3. Process map** | Inline ProcessGraph for this process, Quality Overlay on by default (viz.diverging.redGreen) | `/api/v1/mining?process=<slug>` |
| **4. Variants** | Ranked variants with case count and quality score | `/api/v1/mining/variants?process=<slug>` |
| **5. Config alignment** | SPRO ↔ findings mapping filtered to this process | `/api/v1/config-impact?process=<slug>` |
| **6. Blocking findings** | List of findings blocking each L3 gate, each linking to its Record Report | Cross-joined: `/api/v1/findings?process=<slug>&severity=high` |
| **7. Readiness history** | Sparkline of readiness score over past 12 analysis versions | `/api/v1/business-process/history?process=<slug>` (backend ask) |
| **8. Recommendations** | Deterministic remediation list from agent flow (not LLM verbiage) | `/api/v1/business-process/recommendations?process=<slug>` |

Same PDF export path, same typographic treatment, same writing rules. Process Report is the surface a CFO or process owner receives ahead of a go-live review — it needs to read like a Linear changelog, not a slide deck.

#### 2.5.3 Shared infrastructure (both reports)

- One primitive: `components/aurora/report/report-surface.tsx` (section header + anchored scroll nav + print-style rules). Built in WS7.
- Anchored scroll navigation on the right (like Stripe docs). Each section is a stable slug; sharing a URL with `#activity` deep-links.
- Print stylesheet in WS7: dark-mode disabled on `@media print`, viz palette locked to print-safe sequential.
- Export actions: "Copy link", "Export PDF", "Export HTML", "Open in new tab".

#### 2.5.4 Backend asks (out of scope for Aurora PRs)

Any endpoint marked "backend ask" above does not exist today. These go into a **separate follow-on backend PR** authored by the backend pillar; Aurora never ships backend changes inside its own PRs. Concretely:

1. `api/routes/fix_playbook.py` — derives fix history from `record_fixes` table grouped by `check_id` (success-rate + avg duration).
2. `api/routes/business_process.py` extension — `/history?process=<slug>` for readiness-over-time sparkline.
3. Optional: `api/routes/findings.py` aggregation endpoint (`/aggregate?version_id=<id>`) returning severity counts + avg-pass, so the Issues list in Command Centre does not need client-side aggregation over partial pages (addresses the Devin Review feedback on PR-H — the proper fix is server-side aggregation, which Aurora WS6 depends on).

### 2.6 Global shell

48 px left rail (workspace switcher) + 48 px top bar (current workspace title, breadcrumb, ⌘K affordance, notifications bell, user menu). That is the entire persistent navigation. No long sidebar ever.

---

## 3. Phase-1 primitive triage

Fifteen primitives inherited from PRs #3/#6/#7/#8. Each gets one disposition: **KEEP** (refactor to Aurora tokens, API preserved), **ABSORB** (API folds into an Aurora primitive), **RETIRE** (deleted, replaced by a new primitive).

| Phase-1 primitive | Disposition | Rationale / successor |
|---|---|---|
| `kpi-rail.tsx` | **KEEP** (WS3) | Restyled to Aurora tokens; becomes a Layer-2 data primitive |
| `hero-kpi.tsx` | **ABSORB** (WS5) | Folds into `VerdictCard` — signature moment #01, display-lg verdict sentence replaces the hero KPI pattern |
| `narrative-strip.tsx` | **ABSORB** (WS5) | Collapses into the VerdictCard's metric strip below the verdict sentence |
| `dense-data-table.tsx` | **RETIRE** (WS3) | Replaced by Aurora `Table` — TanStack Virtual, 200k rows @ 60 fps, J/K nav, URL-routable drawer on row open |
| `detail-panel.tsx` | **ABSORB** (WS4) | Folds into Aurora `Drawer` — 40% viewport, right-slide, URL-routable, J/K cycles rows |
| `command-palette.tsx` | **KEEP** (heavily restyled, WS4) | Becomes `components/aurora/command-palette.tsx`; ≤80 ms open; signature moment #06 |
| `empty-state.tsx` | **KEEP** (rewritten, WS5) | Typographic-only per §12.12; 30+ specified strings; no illustrations ever |
| `filter-chip-bar.tsx` | **KEEP** (WS7) | Restyled; still powers Workbench filter chips |
| `saved-view.tsx` | **KEEP** (WS5) | Adds moment #11 elastic slide-in animation |
| `section-header.tsx` | **KEEP** (WS2 type, WS3 usage) | Type scale updated to Aurora's six sizes |
| `info-hint.tsx` | **KEEP** (WS2) | Prefer inline labels over tooltips per §16.5 — `InfoHint` stays but is used sparingly |
| `breadcrumb.tsx` | **ABSORB** (WS4) | Folds into the 48 px top bar |
| `tabs.tsx` | **RETIRE** (WS4) | Replaced by Aurora `Tabs` (underline, not pills) |
| `badge.tsx` | **RETIRE** (WS2) | Replaced by Aurora `Chip` (neutral/accent/success/warning/danger/info) |
| `alert.tsx` | **RETIRE** (WS2) | Replaced by Aurora `Banner` (inline top-of-canvas status) |
| `scroll-area.tsx` | **RETIRE** (WS2) | Replaced by native overflow |
| `separator.tsx` | **RETIRE** (WS2) | Replaced by Aurora `Divider` |
| `sheet.tsx` | **ABSORB** (WS4) | Becomes Aurora `Drawer` |
| `charts/annotated-sparkline.tsx` | **ABSORB** (WS3) | Merged into `components/aurora/chart/sparkline.tsx` — threshold bands + anomaly dots retained |
| `charts/drift-sparkline.tsx` | **ABSORB** (WS3) | Merged into `chart/sparkline.tsx` |
| `charts/small-multiples.tsx` | **KEEP** in spirit (WS3) | Rebuilt as a Chart composition helper; powers Command Centre → Trends |
| `charts/config-sankey.tsx`, `pattern-treemap.tsx`, `severity-bar-chart.tsx` | **ABSORB** (WS3) | Re-expressed as Aurora Chart compositions |
| `dialog.tsx` | **KEEP** (WS2) | Reserved exclusively for destructive-confirm (typed MERIDIAN-CONFIRM per §10.3) |
| `dropdown-menu.tsx`, `popover.tsx`, `tooltip.tsx`, `progress.tsx`, `textarea.tsx`, `sonner.tsx`, `skeleton.tsx` | **KEEP** (WS2) | Restyled to Aurora tokens; API preserved |
| `card.tsx` | **KEEP** (WS2) | Elevation rewired — brightness shift on dark canvas, shadow on light |
| `button.tsx` | **KEEP** (WS2) | Integrated spinner + success check per §12.10 |
| `table.tsx` | **RETIRE** (WS3) | Absorbed into Aurora `Table` |

**Net effect:** of the 29 current `components/ui/*` primitives, **18 keep their concept** (restyled), **7 are absorbed** into Aurora primitives with different names, and **11 retire**. The 9 phase-1 primitives I wrote all survive in some form — most as KEEP, a couple as ABSORB.

---

## 4. Design tokens — what WS1 ships

The spec dictates every value. WS1's job is to commit them as CSS variables + TS exports with no substitutions. Full fidelity, no paraphrasing.

### 4.1 Colour

- **Ink scale** (`--aurora-ink-{0,50,100,200,300,400,500,600,700,800,900,950}`) — 12 stops from `#FFFFFF` to `#05070F`.
- **Canvas (dark default)** — `base #0A0E1A`, `raised #111726`, `elevated #172034`, `overlay #1E2A42`, `line #2A3654`.
- **Canvas (light alternative)** — `base #F7F8FA`, `raised/elevated #FFFFFF`, `overlay #EEF2F7`, `line #D5DADD`.
- **Accent** (SAP Fiori Horizon blue, one shade deeper) — `50 #EAF3FE` through `500 #0057D2` (primary) to `900 #001F50`.
- **Semantic status** — success `#0B7341`, warning `#C78420`, danger `#BB0000`, info `#0057D2` (alias of accent-500). Each has `bg` (alpha 0.12–0.14) and `border` (alpha 0.30–0.36) pair. Used exclusively for status.
- **Viz categorical (12)** — luminous blue, Fiori orange, mint, peach, violet, rose, cyan, gold, fern, coral, periwinkle, orchid.
- **Viz sequential** — blue and amber ramps (6 stops each).
- **Viz diverging** — red-green 7-stop for trend deltas.
- **One gradient in the entire product**: `--aurora-verdict-halo` (accent → cyan → rose radial, 15% opacity). Any other gradient anywhere is a bug.

### 4.2 Typography

Six sizes. Not seven.

| Token | Size | Line-height | Tracking | Use |
|---|---|---|---|---|
| `text-micro` | 11 | 14 | +0.08em | Chips, metadata |
| `text-small` | 13 | 18 | +0.02em | Compact tables, secondary UI |
| `text-body` | 14 | 20 | 0 | Default body |
| `text-lead` | 17 | 24 | 0 | Drawer titles, secondary headings, Report section headers |
| `display-sm` | 24 | 30 | -0.01em | Workspace titles, modal titles |
| `display-lg` | 40 | 44 | -0.02em | Verdict sentence (§12.1 only), Record/Process Report headers |

Faces: **display** = Söhne (licensed, ~$2,400 one-time + $400/yr) or **Inter 600** as fallback. **UI** = Inter 400/500/600/700. **Mono** = JetBrains Mono 400/500. Generic Google sans (Poppins / Montserrat / DM Sans / Geist) are explicitly rejected as Vercel-template aesthetic.

Numbers use `font-feature-settings: "tnum" 1, "lnum" 1, "ss02" 1`. Currency prefixes ISO code (`ZAR 1,247.50`, not `R 1,247.50`).

### 4.3 Spacing

Four-pixel base grid. Tokens: `space-1..8, 12, 16, 24` (4, 8, 12, 16, 20, 24, 32, 48, 64, 96 px).

Density tiers: `compact` (28 px rows, 12 px card padding, text-small) / `default` (36 px, 16 px, text-body) / `comfortable` (44 px, 24 px, text-body). User-selectable; affects padding only, not IA.

### 4.4 Motion

Three durations, three easings, two springs. That is the entire motion vocabulary.

```ts
duration = { instant: 80, fast: 160, medium: 240, slow: 360 }  // ms
easing   = { standard: 'cubic-bezier(.2,.8,.2,1)', enter: 'cubic-bezier(0,0,.2,1)', exit: 'cubic-bezier(.4,0,1,1)' }
spring   = { drawer: { damping: 26, stiffness: 240, mass: 1 }, kanban: { damping: 20, stiffness: 300, mass: 0.8 } }
```

`prefers-reduced-motion` disables: verdict entrance, graph materialisation, drawer spring, kanban drop. Never disables focus rings, state toggles, hover colour.

### 4.5 Elevation

Five levels. Dark canvas: brightness shift (no shadow). Light canvas: `shadow-sm` → `shadow-xl`. Never mix.

### 4.6 Iconography

Lucide as base, audited per-icon. ≥12 hand-drawn SAP icons (BP, MM, FI, SD, HR, Material Master, GL Account, Company Code, Plant, Storage Location, Sales Area, Purchasing Org) committed to `lib/aurora/icons/` as React SVG components.

---

## 5. Signature moments catalogue (12) — PR assignment + calibration

Per spec §12 — none is optional. Gate 2 reviews all twelve live.

| # | Moment | Owned by | Reference | Reduced-motion behaviour |
|---|---|---|---|---|
| 01 | **Verdict Materialisation** (900 ms: halo fade → word-by-word typewriter → metric strip slide-up) | WS5 / used in WS6, WS7 Reports | Stripe (verdict typography), Linear (decisive hero) | Halo + sentence fade together at 200 ms; no word-by-word |
| 02 | **Process Graph Emergence** (nodes fade in by Dagre layer, edges draw via SVG path-length, 800 ms) | WS5 / used in WS7 (Map tab + Process Report) | Celonis Process Explorer — flatter | Single 200 ms fade, no stagger |
| 03 | **Fix Playbook Reveal** (drawer settles, playbook block types in sentence-by-sentence) | WS5 / used in WS7 Record Report | Apple Finder Quick Look | Block fade-in, no typing |
| 04 | **Bulk Action Confirmation** (inline panel slides from toolbar, CONFIRM text input gates the button) | WS5 / used in WS7 | Linear (destructive-confirm pattern) | Panel appears without slide |
| 05 | **Analysis Completion Arrival Banner** (slides down from top, 8 s life, optional chime) | WS5 / global shell | Linear toast | Banner appears without slide |
| 06 | **Command Palette Open** (≤80 ms open: fade + 0.96→1 scale + -8→0 translateY) | WS4 build, WS5 polish | Raycast | Instant open, no scale/translate |
| 07 | **Ask Response Stream** (accent-500 border pulses during stream, stills on complete) | WS5 / used in WS6 | Perplexity | No pulse; border stays static during stream |
| 08 | **Row Hover Preview** (4–6 % luminance shift, 400 ms hover → popover at row edge) | WS5 / used in WS7 | Attio | Disabled on touch + under reduced-motion |
| 09 | **Kanban Drop** (2° tilt on drag, spring settle, re-flow) | WS5 / used in WS7 | Linear board | Instant drop, no spring |
| 10 | **Connection Test Button** (three-state integrated spinner/check/error, no toast) | WS5 / used in WS8 | Vercel deploy button | State change without spinner animation |
| 11 | **Saved View Chip Animation** (200 ms elastic slide into rail) | WS5 / used in WS7 | Linear saved views | Chip appears without elastic |
| 12 | **Empty State** (typographic, display-sm italic centred, ≥30 specified strings) | WS5 / used everywhere | Stripe Dashboard empty states | No motion |

Each moment is pinned in `frontend/lib/aurora/moments/<slug>.ts` with its timing as a typed constant — the spec explicitly forbids letting these drift.

---

## 6. Hotfix PR (PR-H) — scope

Lands **before** WS1 so Aurora surfaces do not inherit dead list panels.

1. **`frontend/app/(dashboard)/findings/page.tsx:144`** — cap `limit: 2000` → `200` (matches API `Query(..., le=200)`).
2. **`frontend/app/(dashboard)/stewardship/page.tsx:140`** — cap `limit: 1000` → `200` (matches API `Query(..., le=200)`).
3. **`docker/docker-compose.customer.yml`** — add `INTERNAL_API_URL=http://api:8000` to the frontend service env (base `docker-compose.yml`, `docker-compose.dev.yml`, and the Helm chart already set it; the customer compose file was the gap that caused the Next.js rewrites proxy to fall back to `localhost:8000` inside the container).
4. No backend changes. No feature work. CI green before WS1 branches.

**Known follow-up** (not in PR-H — addressed by Aurora WS6/WS7): both surfaces compute client-side KPIs, narrative, and bulk-approve candidate lists as if the whole dataset is loaded, while fetching only the first 200. The proper fix is server-side aggregation endpoints (see §2.5.4 backend asks); Aurora WS6 (Command Centre) and WS7 (Workbench) consume those. PR-H deliberately does not paper over this — it restores a working list from a 422 state, which is strictly better than the current dead panel.

---

## 7. Branching discipline

- `redesign/aurora` is cut from `main` **now**, at the commit that merged PR #9. PR-H (hotfix) is cut from `main` separately and lands on `main` fast; once it is in, `main` is merged into `redesign/aurora` so WS1 starts on top of the hotfix.
- Every workstream (WS1–WS8) opens **one PR against `redesign/aurora`**. No drip-fed follow-ups inside a workstream.
- Legacy `/app/(dashboard)/*` stays live for the whole 10–12 weeks. Aurora builds under `/app/aurora/*` behind the `?aurora=1` cookie flag (user-level toggle in the user menu).
- WS8 performs the atomic cutover: `mv /app/(dashboard) /app/(legacy)`, flip flag default, update root layout/nav, squash-merge `redesign/aurora` → `main`. Legacy routes are deleted 30 days later in a follow-up commit.
- PR #9 (cmdk lockfile fix) is already on `main`; nothing more needed there.

---

## 8. CLAUDE.md update — scheduled for WS1

The current `CLAUDE.md` "Frontend design system — Fiori Horizon (hybrid glass)" section documents a **light-only Fiori Horizon** palette (`#0070F2` primary, `#F5F6F7` canvas, `.vx-card` / `.vx-glass`, Inter + JetBrains Mono). That section directly contradicts Aurora (`#0057D2` accent, `#0A0E1A` canvas, dark-first, no glassmorphism, `components/aurora/*`). WS1 ships a replacement section titled "Frontend design system — Aurora (dark-first)" that points at `lib/aurora/tokens.ts` + `styles/aurora.css` and deprecates the Fiori block. The v2.2 glass classes remain documented under a "Legacy (pre-Aurora)" heading until the WS8 cutover.

---

## 9. Open questions (non-blocking; answer before WS1 opens)

1. **Söhne licence.** ~$2,400 one-time + $400/yr. Do I procure, or fall back to Inter for the display face throughout the 10–12 weeks?
2. **LLM savings surfacing.** Command Centre verdict mentions savings only when Tier 1.5/2 is active. Is there a savings-threshold the user wants as the trigger (e.g. "≥ $X this month"), or always mention in verdict when any savings exist?
3. **Admin → `/contracts`.** Spec maps it under "Admin → Contracts tab" but §10.1 lists seven tabs without Contracts. Confirmation: absorb into **Settings** tab as a sub-section (my default), or keep as an eighth tab?
4. **`stewardship/metrics`** (introduced post-spec). Confirmation: absorb into Workbench drawer's stat block, not a separate surface.
5. **Gate reviewers.** Spec requires three design reviews (after WS2, WS5, WS8). Reshigan is named as the fallback reviewer — confirm availability, or nominate a delegate.
6. **Writing-system lint scope.** Should the lint rule also police copy inside `components/ui/__deprecated__/*` during the transition, or only `components/aurora/*` and `app/aurora/*`?
7. **Report PDF engine.** Record/Process Reports export to PDF. Reuse the existing `workers/tasks/render_pdf.py` path (WeasyPrint/wkhtmltopdf, whichever is current), or escalate to a backend ask for a proper server-side renderer?

---

## 10. Do not touch (guardrails)

- `api/`, `agents/`, `checks/`, `sap/`, `workers/`, `db/`, `llm/` — backend is frozen for Aurora. If a signature moment or report needs a backend endpoint, add it to a dedicated **"Phase-A-follow-on backend asks"** section of the relevant workstream's PR description for a separate backend PR. Never ship a backend change inside an Aurora PR. Current known asks (all surfaced in §2.5.4): `/api/v1/fix_playbook`, `/api/v1/business-process/history`, `/api/v1/findings/aggregate`.
- `cloudflare/` — out of scope.
- `scripts/deploy-update.sh` and related deploy scripts — unchanged by Aurora.

---

## 11. Definition of done

Aurora ships when all of these are simultaneously true, per spec §4 + §15:

- 8 of 10 SAP-literate users pass the five-second test (unmoderated, n=10).
- Every legacy page reachable within 5 clicks from Command Centre, 90% success rate on never-seen-Aurora users.
- Every workspace landing page surfaces its verdict/primary insight within the first 800 px without interaction.
- Time-to-interactive P95 < 500 ms on Command Centre, Workbench, Admin; < 900 ms on Process Map (includes materialisation).
- 100 representative keyboard actions execute end-to-end with zero mouse.
- Writing-system ESLint rule passes with zero violations across the Aurora scope.
- All 12 signature moments implemented and reviewed by design director.
- Dark-first everywhere; light mode is a working alternative (not default).
- Lighthouse ≥ 95 on all four workspace landing pages.
- Record Report and Process Report surfaces (§2.5) render, print cleanly, and carry every section enumerated.
- Cutover commit atomic; legacy moved to `/app/(legacy)/`.

Only then is `redesign/aurora` squash-merged to `main`.
