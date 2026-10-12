# UI polish design: slop inventory, per-page spec, brand

Date: 2026-10-12. Scope: every page under `frontend/app/(app)/`, the sign-in pages, logo and favicon. Design only; no application code changed in this branch. All paths are relative to `frontend/`.

Bar: Linear, Vercel, Stripe, Datadog for craft; Ataccama, Collibra, Informatica CDQ for data quality; Celonis and Signavio for process. The hard rules from `CLAUDE.md` apply everywhere: light default, dark full alternative, one indigo accent `--m-accent` for selection, focus and links only, hue means defect state, no gradients, glass or blur, Public Sans for UI, JetBrains Mono for SAP identifiers only, tabular figures, sentence case, `lint-tokens.allow.txt` stays empty, no `any`, no customer names.

## 0. Performance requirements (apply to every task)

Every task below inherits these. An implementer should treat a page as not done until each holds.

1. Skeletons, never spinners, for anything that takes longer than one frame. The only spinner allowed is the inline `Button pending` dot while a form submits. Delete `AuthSpinner` (`components/auth/auth-frame.tsx:47`) and use `Button pending`.
2. No layout shift. Every skeleton has the final height of the thing it replaces (`Stat` 88px, `DataTable` row 36px, `InsightHeader` 112px, chart cards their fixed `height`). Hero numbers reserve width with `min-width: 4ch` so a value arriving does not reflow its neighbours. Never render a `<p>Run…</p>` placeholder in a slot that becomes a 48px header (`runs/[versionId]/page.tsx:422`).
3. Virtualise tables above 200 rows, not 2000 (`design/table/DataTable.tsx:59 VIRTUALIZE_ABOVE = 2000`). Fix the row height at 36px compact and 44px comfortable so the virtualiser never measures.
4. Prefetch on hover and focus for every drill-down. `DrillLink`, `Stat href`, `onRowClick` rows and `NextActions` call `router.prefetch(href)` on `pointerenter` and `focus`, and `queryClient.prefetchQuery` for the first query the target page runs (run detail, object detail, record page). Add one shared `usePrefetch(href, queryKey?, queryFn?)` hook in `design/` and use it from `DrillLink` and `DataTable`; pages then only pass the key and function.
5. Optimistic UI where a mutation is reversible and local: inbox assign and resolve, fix approve and reject, rule enable and disable, baseline pin, rail collapse, theme and density, column and view choice. Use `onMutate` with `setQueryData` and roll back on error with a `Notice`. Never optimistic for extraction, discovery, delete user, apply fixes to SAP.
6. Fewer round trips. Each page lists its waterfalls below; the rule is one request per screen region, started in parallel on mount, and dependent requests only when the parent id truly comes from a request (not from the URL). Where a page needs a count the list already carries, derive the count on the client.
7. First paint budget: the shell (rail, top bar, breadcrumb) renders from the layout with no data; `RunSelectorSlot` and `CommandPaletteSlot` load after paint. Page bodies must not block on `getSystems` or `getObjects("latest")` unless they display them.
8. Motion only on the tokens 120/240/480 ms. No `m-motion-rise` on content that arrives after data; only on first mount of the page frame.

## 1. Where we win

Each line is a requirement, not a claim. The per-page specs reference these by number.

| # | Page | Best-in-class today | Meridian does this better, concretely |
|---|------|---------------------|---------------------------------------|
| W1 | Home | Ataccama ONE dashboard, Datadog overview | The verdict is one sentence with the number that caused it, and every number on the page (DQS, cap, each severity count, each heatmap cell, each tile) opens the failing SAP records in one click. Ataccama stops at the rule. |
| W2 | Home, run overview | Collibra DQ score, Informatica CDQ score | Explainable score: `DqsScore` shows the formula, the six weighted dimension inputs, and names the critical rules that capped the score at 85 or 70, each a link to its records. No competitor shows a cap reason inline. |
| W3 | Objects list | Ataccama catalogue, Collibra assets | Readiness is a verdict per SAP object (Go, At risk, No-go) with the blocking rule named in the row, sorted worst first by default. Collibra shows a percentage and makes you dig. |
| W4 | Object detail | Informatica CDQ scorecard | Rules, fields and records are three tabs on one URL; a failing record opens with the root cause (config table, transaction, owner) and a fix sheet already proposed. |
| W5 | Runs | Monte Carlo incidents, Soda checks | Any two runs compare at rule and record level (`/runs/a/vs/b`); a regression names the rule and the first records that newly fail. Soda compares aggregates only. |
| W6 | Process | Celonis, Signavio Process Intelligence | Process steps carry their DQ defects: a step node shows the rules failing on the documents that pass through it, and clicking opens those records. Celonis has no DQ layer; Signavio has no record drill-down. |
| W7 | Insights | Ataccama, Collibra | Every insight page starts with four sentences (situation, what changed, why it matters, do next) and the next action is a button. Nothing is a chart without a sentence saying what it answers. |
| W8 | Inbox, fix | Collibra workflows, Ataccama stewardship | Keyboard-first triage: `j`/`k` move, `a` assign, `r` resolve, `x` select, `Enter` open, `Esc` close, `?` lists keys. Approve and resolve are optimistic. No competitor's stewardship queue works without a mouse. |
| W9 | Shell | Linear, Vercel | Command-K reaches every page, object, system, run and rule with a typed grammar (`object material`, `system prd`, `run last`), and shows the shortcut next to each. `[` collapses the rail; `?run=` in the URL is the only run state. |
| W10 | All | Stripe, Linear | Zero decoration. Three elevations, one accent, no gradients, no icons that do not stand for a state, no tile without a drill-down. Numbers are tabular everywhere. |
| W11 | All | Datadog | Speed: skeletons with final height, no layout shift, prefetch on hover, virtualised tables, optimistic stewardship actions. Pages feel loaded before the data arrives. |

## 2. Slop inventory

Grouped by the task that fixes it. Line numbers are from `origin/main` at `fe258a73`.

### Foundations (tokens, fonts, shell)

- `design/tokens.css:119-123` four gradient tokens; `125-129` brand panel tokens; `131-134` glass tokens; `230-240` `.m-glass`, `.m-scrim-glass` use `backdrop-filter`; `241-244` `.m-meridian-line` gradient; `245-254` `.m-brand-panel` gradient; `255` `.m-fade-bottom` gradient; `260` `.m-display` serif. All violate "no gradients, glass or blur" and "Public Sans".
- `app/layout.tsx:2,10-12` loads Instrument Sans and Instrument Serif, not Public Sans. `:43` theme key `aurora:theme` (legacy name, harmless, rename when touched).
- `app/globals.css:11` imports `./styles/aurora-components.css` for the process designer only.
- `design/shell/TopBar.tsx:10` `className="m-glass"` on the header.
- `app/(app)/layout.tsx:113-117` `MeridianLine` gradient hairline under the top bar, animated while jobs run.
- `design/primitives/EmptyState.tsx:100` ghost uses `m-fade-bottom` gradient mask.
- `design/shell/Rail.tsx:311` `hover:!text-[var(--m-ink)]` important hack; `:407` group header padding literal `20px 16px 6px`.
- `design/primitives/SeverityDot.tsx:11` pass state is a text "✓" glyph, not an SVG shape; renders at inconsistent baselines.
- `design/table/DataTable.tsx:223-230, 204-205` hand-rolled `<input className="mb-2 rounded border px-3 py-1.5 text-[13px]">` instead of `Field`; `:94-109` raw checkboxes; `:173-209` Columns and Views popups do not close on Escape or outside click; `:282-294` row keyboard is Tab plus Enter only, no arrow keys; `:328` drawer title hard-coded "Detail"; no empty row state when a filter removes every row.
- `design/primitives/Stat.tsx` has no `onClick`, which is why `home/_persona-home.tsx:43` wraps it in a `<button>` (nested interactive content when `href` is also set).
- 95 occurrences of hand-rolled `rounded border` boxes in `app/` and `components/` (`grep -rn "rounded border"`), and 430 inline `text-[13px]`-style literals across `app/(app)/` (admin 132, rules 89, systems 82, insights 67, mdm 63). These are per-page cards, inputs and micro-headings that `Card`, `Field`, `Notice` and the type scale already cover.
- `app/(app)/design/page.tsx:17` gallery itself uses `rounded border` and a bare `<h2>`.
- `hooks/use-theme.ts:6-12` storage keys `aurora:*`.

### Home

- `design/templates/HomePage.tsx:117-128` verdict set in Instrument Serif `.m-display`; `:146` raw run id fallback in the header; `:217-226` `Placeholder` block; `:236-338` `InstrumentPanel` draws a decorative ring and four stacked charts regardless of which answer the persona needs.
- `app/(app)/home/_persona-home.tsx:43` `Tile` nests `Stat` inside `<button>`; `:46-48` `TileGrid` auto-fit card grid; `:169-204` tiles "Failing checks", "Affected records", "Open inbox" are counts with no verdict; `:210-228` "Worst objects" list hand-rolled as `<Link className="flex … border-t px-3 py-1.5 text-[13px]">` with four unlabeled spans and a sparkline, not a table.
- `app/(app)/home/_live.tsx:32-38` hand-rolled `Section` box; `:66, 78` `EmptyState` with no action ("No systems connected yet.", "Nothing is running.").
- `app/(app)/home/process/page.tsx:35` bare `Skeleton height={320}` for the whole page; `:39` `grid gap-4` with no page padding; `:41` `max-w-xs` select floating under the insight header.
- Round trips: `_persona-home.tsx:62-67` six queries plus `useDayOne` plus `useJobs`; `getObjects("latest")` is also fetched by `CommandPaletteSlot` (`app/(app)/layout.tsx:41`), fine when keys match, but `getVersions()` is fetched by both `RunSelectorSlot` and the home page with the same key, good, and `getShellCounts` is only used for two tiles.

### Runs

- `app/(app)/runs/page.tsx:113-123` summary Stats "Runs" (count of rows on the page), "Latest DQS", "Failed"; `:125-143` per-system sparkline chips hand-rolled as `<button className="rounded border px-2 py-1 text-[13px]">` and selection marked with `<Pill tone="go">Filtered</Pill>` (defect hue used for selection); `:52-74` "Compare" secondary button in every row; `:166-180` bulk bar text "Select exactly two runs to compare"; `:184-189` empty state fine.
- `app/(app)/runs/[versionId]/page.tsx:401-410` header is a `<p>` "{label ?? versionId} — started {datetime}." with the raw id; `:412-413` `<Link><Button>` nested interactive; `:422` loading placeholder `<p className="p-6 pb-0">Run…</p>`; `:200-211` the composite score is said three times (sentence, `DqsScore`, `Stat`); `:212-214` "Cost at risk" has no currency; `:228` "Next actions (all systems)" on a single-run page; `:236` history empty as raw `<p>`; empty states without an action at `:139, 169, 319, 445`; `:228-247` four `<h2 className="text-[13px] font-semibold">` micro headings; FindingsTab caps at 200 rows with no pager; Steps error column renders a `<p role="alert">` per row (alerts fire on every render).
- Waterfall: `:81` and `:152` `enabled: systemId != null` wait for the version request to return before the system and history requests start; `:342` findings wait for `version.isSuccess`. The version id is in the URL; findings and steps can start immediately. System id needs the version, so fetch it once in the page and share by key.

### Objects

- `app/(app)/objects/page.tsx:63` `SeverityDot "high"` for any failing count above zero (shape lies about severity); `:87-91, 99-106` `emptyProps.summary` key that `EmptyState` ignores; `:99` empty title is two sentences; `:127-133` hero Stats "Objects", "Ready", "Not ready" are counts of the table; `:137-142` filter bar sentence "Showing ready objects." plus "Show all objects" secondary button.
- `app/(app)/objects/[object]/page.tsx:391-392` header is `<strong>` not `<h1>`, readiness Pill prints the raw enum "pass", "warn", "fail"; `:378` "PDF analysis" vs "Analysis report (PDF)" on the list page; `:116-121` trend cell prints a sentence with a full stop inside a table cell, coloured with `--m-fail`; `:131, 143, 147` three different empty messages for one tab; `:222-224` `<h2 className="text-[13px] font-semibold"><Mono>table</Mono></h2>`; `:246` "masked: reason" lowercase label; `:296-302` "Open fix sheet" as a bare accent link where the primary action should be a button; `:313, 371, 410` empty states with no action; `:331-333` "{n} record(s) fail {checkId}." sentence in a cell header.
- Round trips: seven queries gated on `!!run` (`:61, 73, 173, 209, 266, 362, 367`); run is in the URL so they are parallel, good, but `:61` and `:73` both fetch object-level summaries the list page already holds. Seed the detail cache from the list row on row click.

### Insights

- `app/(app)/insights/page.tsx:96-110` nine `<Link className="m-card">` tiles in an `auto-fit minmax(220px, 1fr)` grid; `:69-74` static filler metrics "Review clusters", "Score outlook by module", "Field dependencies and guards", "Relationships, patterns, anomalies", "Business process coverage"; `:70` "Run {version_id}" raw id; vanity metrics "N no-go", "N at risk", "N below threshold" with no currency or action; `:24-41` `TileMetric` error "Couldn't load." with an underlined ghost button; nine independent fetches on mount (one per tile).
- `app/(app)/insights/exec/page.tsx:84-103` two `Card title="Return on investment"` blocks (loading and loaded) with "ROI multiple", "Payback", "Risk mitigated", "Annual subscription" Stats; `:105-107` three stacked `DataTable`s with no heading and no sentence.
- `app/(app)/insights/process/page.tsx:180, 316, 332, 347, 363` bare `<h3 className="font-semibold mb-2">`; `:177, 247, 344, 357, 433` empty states with no action; `:247` empty title is a two-sentence paragraph.
- `app/(app)/insights/process/designer/**` still on `aurora-*` classes (`_components/nodes.tsx:29-53`, `canvas.tsx:95-113`, `tree.tsx:77-110`, `level-table.tsx:39-58`, `attributes.tsx:159-170`) and `ui-link-button`.

### Process

- `app/(app)/process/page.tsx:29` `grid gap-4` with no page padding; `:32` `InsightHeader` loading hack passes empty sentences; `:33` `max-w-xs` select; bare `Skeleton height={240}`.
- `app/(app)/process/_components/shared.tsx:119` `CatalogueGrid` card grid `auto-fill minmax(260px, 1fr)` with four `Figure`s per card ("Cases", "Variants", "Fitness", "Median"); `fmtFitness` prints fitness to two decimals as a bare number; "Never run" footer text.
- `app/(app)/process/[l1]/page.tsx:108` no page padding; `:111-122` hand-rolled breadcrumb `<ol>` with "›" and `ui-link-button`; `:71` bare `Skeleton height={480}`; `:168-171` raw `<input type="date" className="m-input">` inside `Field`; `:155` next-action sentence "Click a step to drill into it, or export {l1} for Signavio."; `:192` "Not in the reference model" with no action.

### Systems

- `app/(app)/systems/page.tsx:214-227` Stats "Systems" (count), "Healthy" with hint "N need attention", "Configuration loaded" with an underlined `Link` inside a Stat value; `:197-206` filter bar sentence plus secondary button; `:190-196` per-row "Test" secondary button; `:230-235` empty title two sentences plus detail "Or import a file if you have an export." with no action.
- `app/(app)/systems/[systemId]/page.tsx:162-163` header is `<p className="text-[20px] font-semibold">`; `:191, 484, 507, 517` hand-rolled `rounded border` boxes; `:285, 299, 315, 486, 518` `<p className="text-[13px] font-medium">` micro headings; `:287, 301, 319, 409, 520` empty states with no action; `:573` raw `<input>` in the edit drawer; `:142` loading grid of four 88px skeletons while the header renders text (shift).

### Rules

- `app/(app)/rules/page.tsx:241` raw search `<input className="rounded border px-3 py-1.5 text-[13px]">`; `:273-275` Stats "Rules", "Enabled", "Disabled" with hint "Every rule is active"; `:277` permission notice as a raw `<p>`; `:287` micro heading; `:308` empty title is a 20-word paragraph; `:319-346` drawer dumps `JSON.stringify(conditions)` in `<pre>`; `:346` "Open rule page" as an underlined link at the bottom of the drawer instead of the drawer action.
- Eleven URL filter states (`:82-92`) with no visible "Clear filters" chip row.

### MDM

- `app/(app)/mdm/page.tsx:50-52, 54` raw `<p className="text-[13px]">No current snapshot yet.</p>` and "No history yet." instead of `EmptyState`; `:58-67` eight `Stat`s in a `grid-cols-4` with no drill-down except the first; "Active systems" and "Backlog" are vanity.
- `app/(app)/mdm/golden/page.tsx:81, 92` raw confidence inputs; filters not in the URL (`useState`, `:41-45`), so a shared link loses them.

### Inbox and fix

- `app/(app)/inbox/page.tsx:412-425` eight Stats across two branches ("Unread notifications", "Open", "Overdue", "SLA compliance", "Due today", "Unassigned", "Resolved this week"); `:466, 523, 567-591` five raw `<input>`/`<textarea>`; focused-row index in state (`:115`) but no `j`/`k` keys bound.
- `app/(app)/fix/page.tsx` fine structurally; "Dedup" tab label is an abbreviation (use "Duplicates"); `Pager` only renders above 100 rows.

### Import

- `app/(app)/import/page.tsx:121-123` Stats "Files imported", "Records imported", "Last import" link to `/runs`; `:128` drop zone `rounded border p-6 text-center`; `:145, 178, 183` three hand-rolled `role="alert"` boxes; `:140` `job.step.replace(/_/g, " ")` shows raw step names.

### Admin

- `app/(app)/admin/users/page.tsx:139-141` Stats "Users", "Active this week", "Never signed in"; `:184, 201` `<h2 className="text-[13px] font-semibold mb-2">`; `:145, 181, 232` error strings cast with `as Error`.
- `app/(app)/admin/triage/page.tsx:63` `<h2 className="text-[14px]">` section heading; `:127` hand-rolled note box; `:175` raw `<td>` tables outside `DataTable`.
- `app/(app)/admin/**` carries 132 inline type literals; everything is forms and tables that `Field`, `Select`, `DataTable`, `Card` already cover.

### Auth and brand

- `components/auth/auth-frame.tsx:60` `FACTS` marketing bullets ("800+ SAP checks", "29 modules, 7 system types"); `:67-96` `BrandInstrument` decorative 320px ring with serif tagline; `AuthFrame` `<aside className="m-brand-panel">` gradient panel; `m-meridian-line` gradient; `<h1 className="m-display text-[28px]">` serif; footer repeats the FACTS line; `PasswordField` label concatenates `${label} — ${helper}`; `authInputClass` duplicates `Field`.
- `public/brand/brand.json` cobalt `#2B4BE0` on warm paper `#F4F3EF`; `apple-icon.svg` linear gradient fill; `og-image.svg` two gradients, Instrument Serif tagline, uppercase tracked mono line; `lockup-light.svg`, `wordmark-light.svg` draw "MERIDIAN" as hand-traced monoline strokes with the two "I"s in accent (reads as a logo-generator output, not a type-set wordmark).
- `app/icon.svg` and `manifest.webmanifest` carry the cobalt values.

## 3. Foundations (Task 1)

Files: `design/tokens.css`, `app/layout.tsx`, `app/globals.css`, `DESIGN.md`, `public/brand/brand.json`, `design/shell/TopBar.tsx`, `app/(app)/layout.tsx`, `design/primitives/EmptyState.tsx`, `design/primitives/SeverityDot.tsx`, `design/primitives/Stat.tsx`, `design/table/DataTable.tsx`, `design/templates/ExplorerPage.tsx`, new `design/hooks/usePrefetch.ts`, new `design/primitives/PageHeader.tsx`.

Tokens (`tokens.css`, the only file with literals):

```
--m-canvas: #F5F6F8;        --m-sheet: #FFFFFF;        --m-sheet-raised: #F9FAFB;
--m-ink: #15171C;           --m-ink-2: #4B5160;        --m-ink-3: #7A8191;
--m-line: #E3E6EB;          --m-line-strong: #C9CED6;
--m-accent: #4F46E5;        --m-accent-soft: #EEF0FD;  --m-accent-ink: #FFFFFF;
--m-critical: #C2410C;  --m-high: #D97706;  --m-medium: #CA8A04;  --m-low: #64748B;  --m-pass: #15803D;
--m-go: var(--m-pass);  --m-at-risk: var(--m-high);  --m-no-go: var(--m-critical);  --m-info: var(--m-ink-2);
dark: --m-canvas #0F1115; --m-sheet #171A20; --m-sheet-raised #1D2129; --m-ink #ECEEF2; --m-ink-2 #A6ADBB; --m-ink-3 #737B8A; --m-line #262B35; --m-accent #818CF8; --m-accent-soft #23264A; defect hues lifted one step (#F97316, #F59E0B, #EAB308, #94A3B8, #22C55E).
```

Delete lines 119-134 (gradient, brand panel, glass tokens) and 230-260 (`.m-glass`, `.m-scrim-glass`, `.m-meridian-line`, `.m-meridian-live`, `.m-brand-panel`, `.m-fade-bottom`, `.m-display`). `npm run check:contrast` must pass for ink on sheet and canvas, accent on sheet, every defect hue on sheet (text use) at 4.5:1.

Fonts: `app/layout.tsx` loads `Public_Sans` (weights 400, 500, 600, `--font-ui`) and `JetBrains_Mono` (400, 500, `--font-mono`) through `next/font/google`. `tokens.css` `--m-font-ui: var(--font-ui)`, `--m-font-mono: var(--font-mono)`. `font-variant-numeric: tabular-nums` on `body`. Type scale: 11/14 label, 12/16 meta, 13/18 body, 15/20 heading, 20/26 page title, 28/32 hero number, 44/48 verdict number. Delete every `text-[Npx]` in `app/` in favour of `m-text-label`, `m-text-meta`, `m-text-body`, `m-text-h`, `m-text-title` utility classes defined in `tokens.css`.

Shell:

- `TopBar.tsx:10` replace `m-glass` with `style={{ background: "var(--m-sheet)", borderBottom: "1px solid var(--m-line)" }}`. Height 48px.
- `app/(app)/layout.tsx:113-117` delete `MeridianLine`. Job activity is already in `JobTray`; add a 2px `--m-accent` progress bar at the top of the content column only while a job runs (`width` from `job.percent`, transition 240ms), solid colour, no animation when idle.
- `Rail.tsx:311` remove the `!important` hover; set hover colour on the item class. `:407` move the padding to `--m-rail-group-pad`.
- `SeverityDot.tsx:11` draw the pass check as an 8px SVG path, same box as the other shapes.
- `EmptyState.tsx:100` remove the fade mask; ghosts are flat `--m-line` outlines at 40% opacity. Make `action` required in the type so TypeScript flags every call site in the inventory; the implementer then supplies a real action per site (listed per page below).
- `Stat.tsx` add `onClick?: () => void`; render `<button className="m-stat m-stat-link">` when given. Add `width` reservation: value cell `min-width: 4ch`. Add `loading?: boolean` that renders a 28px skeleton in the value slot at the same height.
- `PageHeader` (new): `title` (20/26 semibold, `<h1>`), `meta` (13/18 ink-2, one line), `status?: Pill`, `actions?: ReactNode` (right, max one primary `Button` plus secondaries), `tabs?: ReactNode`. Every page uses it; no page draws its own header again.
- `DataTable.tsx`: `VIRTUALIZE_ABOVE = 200`; fixed row height 36/44; arrow keys move the focused row (`aria-activedescendant`), `Enter` opens, `Space` toggles selection, `Home`/`End` jump, `x` toggles selection where `bulkActions` are set, `Escape` clears selection and closes the drawer; global filter and view name use `Field` with `Input`; selection uses the `Checkbox` primitive; Columns and Views popups use `Menu` so they close on Escape and outside click; `drawerTitle?: ReactNode` prop replaces "Detail"; empty filtered result renders one row "No rows match this filter" with a "Clear filter" ghost button; header cells 11/14 medium ink-3, sentence case.
- `ExplorerPage.tsx`: delete the unused `summary` key in `emptyProps`; add `header?: ReactNode` slot (renders `PageHeader`); loading state renders a 36px header skeleton plus seven 36px rows (no shift to the real table).
- `usePrefetch(href, query?)`: `router.prefetch(href)` and `queryClient.prefetchQuery(query)` on `pointerenter` and `focus`, debounced 80ms. `DrillLink`, `Stat`, `NextActions` and `DataTable` rows use it.
- `hooks/use-theme.ts` rename storage keys to `meridian:theme`, `meridian:density`; read the old key once and migrate.

Empty, loading, error pattern for every page: loading = skeleton in final geometry; empty = `EmptyState` with a title under 8 words, one detail sentence, one primary action; error = `ErrorState` with the message and Retry. No raw `<p>` for any of the three.

Copy rules: sentence case everywhere, including nav and column headers. No full stops in table cells, pills, tile labels or hints. No "Showing X." sentences; filters appear as removable chips. Numbers formatted with `toLocaleString`; currency always with the tenant currency code; percentages with one decimal unless integer.

## 4. Home (Task 2)

Files: `design/templates/HomePage.tsx`, `app/(app)/home/_persona-home.tsx`, `app/(app)/home/_live.tsx`, `app/(app)/home/{lead,steward,basis,process}/page.tsx`, `components/insight/dqs-score.tsx`.

Question answered: "Can we go live, and if not, what is the one thing I do now?" (W1, W2).

Layout (page padding `--m-page-pad`, max `--m-page-max`, 24px gap):

1. `PageHeader`: title "Home", meta "Run {label} · {relative time}" where `label` is never a raw id (fallback "{modules} · {date}", the formula already used in `app/(app)/layout.tsx:108`), actions: `ExportMenu` "Executive report (PDF)".
2. Verdict row (sheet, elev-1, 24px padding): left, the DQS number 44/48 semibold tabular with `Delta` and "vs {previous label}"; under it one sentence from `buildNarrative` sentence 1 in 15/20 regular, ink; if capped, one line "Capped at {cap} by {n} critical {rule names, max 2, each a DrillLink}". Right, a `Button` with the single next action from `NextActions` (steward: "Open worst object", lead: "Open objects not ready", basis: "Open failed system"). Delete the serif `.m-display`, the ring and `InstrumentPanel`'s decorative frame.
3. Dimensions strip: six `Stat`s in one row, label = dimension, value = score with one decimal, `tone` by band, each `href` to `/objects?run=&dimension=`; unmeasured dimensions show "—" with hint "Not measured".
4. Two-column (7/5): left "Objects, worst first" as a `DataTable` (dense, `hideToolbar`, max 8 rows, columns Object, DQS with `ScoreRing 16`, Readiness `Pill` Go/At risk/No-go, Blocking rule (`Mono` check id, DrillLink to records), Affected (`m-numeric`), Trend `Sparkline 60x16`); footer link "All objects". Replace the hand-rolled rows at `_persona-home.tsx:210-228`. Right: "Score over runs" `Line` chart 200px high with run points clickable; under it the dimension heatmap (`Heatmap`, rows = worst 8 objects, cols = six dimensions) only for lead and steward.
5. Work row: three `Stat`s maximum per persona, each with `href` and a hint that is a verdict, not a count: lead "Objects not ready 3 of 12", "Blocking findings 41", "Inbox overdue 6"; steward "Inbox due today 4", "Cleaning proposals 120", "Worst object {label}"; basis "Systems unhealthy 1 of 4", "Configuration missing 2 systems", "Jobs running 1" (opens tray via `onClick`). Delete "Affected records" and "Failing checks" tiles (counts without a verdict).
6. Basis only: `LiveSection` becomes two `Card`s with `DataTable hideToolbar` (Systems: Health pill, System, Last extracted; Jobs: Status, Job, Progress). Empty actions: "Connect a system" (`/systems?new=1`), "Run extraction" (`/systems`).
7. Process home (`home/process/page.tsx`): same frame; `InsightHeader` first, then `SystemSelect` inside `PageHeader.actions`, then a `DataTable` of processes (Process, Coverage pill, Fitness with one decimal and tone, Variants, Cases, Last run, Action "Run discovery" ghost) replacing `CatalogueGrid`; "Latest runs" card below.

States: loading renders the exact frame with skeletons (verdict 48px, six 88px stats, table 8 × 36px, chart 200px); no-data renders the `JourneyStepper` in the verdict slot with the current step's action as the primary button; error `ErrorState` in the verdict slot, rest hidden.

Keyboard: `g h` goes home (CommandPalette already has `⌘1`); table rows arrow-navigable; `Enter` on the verdict action.

Responsive: below 1024px the two columns stack; below 640px the dimension strip scrolls horizontally with scroll snap; stats wrap two per row.

Performance: keep the six parallel queries but drop `getShellCounts` for lead (its two numbers come from `getObjects` and the inbox count the rail already loads); seed `queryKeys.objects(latest.id)` from `getObjects("latest")` so clicking an object row opens without a fetch; prefetch `/objects/{module}` on row hover; `Line` and `Heatmap` lazy-load their chart bundle with a fixed-height skeleton.

## 5. Runs and results (Task 3)

Files: `app/(app)/runs/page.tsx`, `app/(app)/runs/[versionId]/page.tsx`, `app/(app)/runs/[versionId]/vs/[b]/page.tsx`, `design/templates/ReportPage.tsx`.

### Runs list

Question: "Which run is current, did it get worse, and which two do I compare?" (W5).

- `PageHeader` title "Runs", actions: `ExportMenu`, primary "Run analysis" (disabled with tooltip when no system).
- Summary: two `Stat`s only: "Latest DQS {n}" with `Delta` vs previous and `href` to the run; "Failed runs {n}" tone no-go, `href=/runs?status=failed`, hidden when zero. Delete the "Runs" count.
- Replace the per-system sparkline chip row (`:125-143`) with a `Select` "System" in the filter bar plus one `Line` chart ("Score per run, {system}") 160px high above the table; selection state is the `?system=` param. Never a `Pill tone="go"` for selection; a chosen chip is `--m-accent-soft` background with `--m-accent` text.
- Columns: Run (label, never the id; the id is in the drawer), Status `Pill`, Started, System, Objects (count), DQS `DrillLink` with `Delta` in the same cell, Baseline (`Pill neutral "Baseline"` or empty). Delete the per-row "Compare" button; comparison is selection of two rows then a bulk-bar primary "Compare" (`bulkActions`); bar copy "Select two runs" when one is selected.
- Filter chips: Status, System, removable; no "Showing failed runs." sentence.
- Empty: "No runs yet" / "Run the first extraction from Systems." / primary `DayOneAction`.
- Keyboard: rows arrow-navigable, `x` selects, `c` compares when two selected.
- Performance: list query only; `?system=` filtering client-side (`:92 enabled: system !== ""` becomes a derived filter); prefetch `/runs/{id}` and `queryKeys.run(id)` on hover.

### Run detail

Question: "What did this run find, what capped the score, what do I fix first?" (W2).

- `PageHeader`: title = run label, meta "Started {datetime} · {system} · {duration}", status `Pill`, actions: secondary "Compare with previous" (`Button render={<Link>}`, not nested), ghost "Pin as baseline" (optimistic), `ExportMenu`.
- Tabs via `entityTabs` (`?tab=`): Overview, Objects, Findings, Steps, Configuration.
- Overview: one `DqsScore` (formula, six inputs, cap reason naming the critical rules with DrillLinks). Delete the intro sentence (`:200-203`) and the duplicate `Stat "Composite score"` (`:205-211`). Right of it three `Stat`s: "Blocking findings" (critical + high, `href=?tab=findings&severity=critical`), "Affected records", "Cost at risk {currency}". Then "Score by dimension" `Bar` and "Where findings concentrate" `Heatmap` as two `Card`s side by side, `Card title` 15/20 (delete the `<h2 className="text-[13px]">` headings). Delete "Next actions (all systems)"; `NextActions` here is scoped to this run (`versionId`). "Composite over runs" `Line` with the history empty rendered as `EmptyState` "Only one run so far" with action "Run analysis".
- Findings: `DataTable` virtualised, server pager 100 per page (replace the 200 cap), columns Severity (dot + label), Rule (`Mono`), Object, Dimension, Records, Message; filter chips Severity, Dimension, Object; row opens `FindingDrawer` via `?finding=`. Empty with filters: "No findings match" plus "Clear filters"; empty without: "No findings in this run" plus "Open steps".
- Objects: same table as the Objects list, scoped to the run; empty "No objects scored" plus "Open steps".
- Steps: `DataTable`, columns Step, Status pill, Started, Duration, Error (truncated, full text in drawer; no `role="alert"` per row). Empty "No steps recorded" plus "Re-run analysis".
- Loading: header skeleton 48px plus body skeleton in the tab's geometry. Never the `<p>Run…</p>` line.
- Performance: start `getVersion(id)`, `getFindings(id)`, `getSteps(id)` in parallel on mount (all keyed by the URL id). `getSystem(systemId)` and score history wait for the version only; render those two cards as skeletons meanwhile. Baseline pin is optimistic.

### Compare (`vs/[b]`)

- `PageHeader` title "{a} vs {b}", meta the two dates. Three `Stat`s: DQS a, DQS b, Delta. Table of rules that changed, sorted by largest regression: Rule, Object, Records before, Records after, Delta, with a drawer that lists the first 50 newly failing records (W5). Prefetch the second run on the list hover when two rows are selected.

## 6. Objects (Task 4)

Files: `app/(app)/objects/page.tsx`, `app/(app)/objects/[object]/page.tsx`, `app/(app)/objects/[object]/records/[key]/page.tsx`, `app/(app)/objects/[object]/rules/[ruleId]/root-cause.tsx`, `components/insight/finding-context-panel.tsx`.

### Objects list

Question: "Which objects block go-live, and what blocks each?" (W3).

- `PageHeader` title "Objects", meta run label, actions `ExportMenu` ("Objects (.xlsx)", "Analysis report (PDF)").
- Summary: one `Stat` "Not ready {n} of {total}" tone by result, `href=?readiness=fail`; one `Stat` "Blocking findings {n}". Delete "Objects" and "Ready".
- Columns: Object, DQS (`ScoreRing 16` + `DrillLink`), Readiness `Pill` (Go, At risk, No-go), Blocking rule (`Mono` id of the worst critical, DrillLink to records; "—" when none), Failing checks (`m-numeric`; severity dot uses the worst actual severity, not always "high"), Affected records, Trend `Sparkline`. Default sort: readiness worst first then DQS ascending.
- Filter chips Readiness, Dimension, Owner. Delete the "Showing ready objects." bar.
- Empty: "No objects in this run" / "Run an analysis on a connected system." / `DayOneAction`.
- Performance: one request; seed per-object cache on row click; prefetch on hover.

### Object detail

Question: "Why is this object not ready, and which records do I fix?" (W4).

- `PageHeader`: `<h1>` label, meta "{n} records · {system} · run {label}", status `Pill` mapped Go/At risk/No-go (never the raw enum), actions: `OwnerPicker` (as a secondary button with avatar), `ExportMenu` ("Analysis report (PDF)" matching the list label).
- Tabs: Overview, Rules, Fields, Records.
- Overview: `DqsScore` (explainable, W2) left; right three `Stat`s "Blocking rules", "Affected records", "Cost at risk {currency}"; below, `Bar` by dimension in a `Card`; dimension empty as `EmptyState` "No dimension scores" plus "Open rules".
- Rules: `DataTable` columns Severity, Rule (`Mono`), Name, Dimension, Records failing, Pass rate, Trend (`Delta` component only, no sentence), Action ("Open records" ghost). Filter chips Severity, Dimension, "Blocking only" toggle (replaces the `Notice`). One empty state: "No rules match" plus "Clear filters", or "No rules ran for this object" plus "Open run steps".
- Fields: group heading is `Card title={<Mono>TABLE</Mono>}` with meta "{n} fields"; columns Field, Description, Rules, Failing, Masked (`Pill neutral "Masked"` with reason in tooltip; no lowercase "masked: reason").
- Records: `FindingContextPanel` becomes a `Card` with title "{rule name}" and meta `<Mono>{checkId}</Mono> · {n} records`; primary `Button` "Open fix sheet" in `Card.actions` (W4); `DataTable` virtualised with server pager 50; `RootCauseSection` as a `Card title="Root cause"` with the config table, transaction and owner as DrillLinks. Empty states: no rule chosen "Choose a rule" plus "Open rules"; no run "No run selected" plus "Open runs"; no failing records "All records pass this rule" plus "Open rules".
- Keyboard: tabs `1`-`4`, rows arrow-navigable, `f` opens fix sheet from a record row.
- Performance: cache seeded from the list; rules and overview requests start in parallel on mount; records request only when `?rule=` present; prefetch `/objects/{m}/records/{key}` on row hover.

## 7. Insights (Task 5)

Files: `app/(app)/insights/page.tsx`, each `insights/*/page.tsx`, `design/templates/InsightHeader.tsx`, `design/templates/ReportPage.tsx`.

### Index

Question: "Which insight needs my attention this week?" (W7).

Delete the nine-tile grid. The index is a `DataTable hideToolbar` (dense): columns Insight (name, 13/18 ink, link), Headline (one sentence from the page's own `situation` cell, ink-2), Changed (`Delta` or "—"), Updated (relative). Rows sorted by tone (no-go first). Above it, `InsightHeader` for the tenant (situation from readiness, changed from forecast, why from impact in currency, next = the single worst page's action). Loading: header skeleton plus 12 × 36px rows. Empty: "No insights yet" / "Insights appear after the first analysis." / `DayOneAction`.

Performance: one new aggregated endpoint request (`GET /api/v1/insights/summary`, the backend already computes each tile) replaces nine; until it exists, run the nine in parallel with `useQueries` and render each row's headline cell as a skeleton, never the whole page. Prefetch each insight page on row hover.

### Shared per insight page

Every insight page: `PageHeader` (title, meta run label, actions), `InsightHeader` (four sentences, the next action as a button), then at most two `Card`s per row, each with a title that is the question it answers ("Which waves are blocked", "Which features lose money"). Every chart has a sentence under the title. No bare `<h3>`. Every number is a `DrillLink`. Tables use `DataTable`. Empty states have an action. Currency values show the code.

Page-specific:

- Readiness: wave × object `Heatmap` first, cell click opens `/objects/{m}?run=&wave=`; "Blockers" table.
- Value at risk (`impact`): `Waterfall` of cost by feature, then table Feature, Status pill, Blocking rule, Cost.
- Executive summary: one `Card "Return on investment"` with the four `Stat`s (loading uses `Stat loading`); the three tables get `Card` titles "Readiness by wave", "Features at risk", "Owners"; primary action "Executive report (PDF)".
- Owners, Duplicates, Operations, Forecast, Lineage, Mining: same frame; forecast's chart is the first card with the predicted DQS at the go-live date in the `situation` sentence.
- Process readiness: delete the five `<h3>`; `Card`s "Gates", "Blocking findings", "Recommendations", "Rules by step"; each empty state gets an action ("Open rules", "Open inbox"); step nodes show failing rule count and open records (W6).
- Process designer: migrate `aurora-*` classes to `@/design` (nodes become `Card padding="sm"` variants; toolbar uses `Button`/`IconButton`; tree rows use the `Rail`-style row), delete `app/styles/aurora-components.css` and the `globals.css:11` import; `ui-link-button` becomes `Button variant="ghost"`.

## 8. Process (Task 6)

Files: `app/(app)/process/page.tsx`, `app/(app)/process/_components/shared.tsx`, `app/(app)/process/[l1]/page.tsx`, `app/(app)/process/runs/*`.

Question: "Which processes are discovered, how well do they fit, and which DQ defects break them?" (W6).

- Catalogue: `PageHeader` title "Processes", meta system name, actions `SystemSelect` (as a `Select` in actions, not a floating `max-w-xs`), primary "Run discovery". `InsightHeader`. Then a `DataTable` (replace `CatalogueGrid`): Process (L1 name with `Mono` code as meta), Coverage `Pill`, Fitness (one decimal, tone, `DrillLink` to L1), Variants, Cases, Median duration, DQ defects (count of failing rules on the process's document tables, `DrillLink` to `/objects?process=`), Last run. `ViewAsTable` toggle deleted. Page padding from `ExplorerPage`.
- L1 page: `PageHeader` title L1 name, meta "{cases} cases · {variants} variants · fitness {n}", status `Pill` by fitness, actions: secondary "Export to Signavio", primary "Run discovery". `Breadcrumb` from the shell (delete the hand-rolled `<ol>`). Filters: `Field label="From"`/`"To"` with the `DateInput` primitive (add one; wraps `<input type="date">` with the `m-input` class and token padding), `Select`s. Tabs Flow, Variants, Conformance, Cases, Reference. Flow nodes carry a defect badge (`Badge count` in `--m-critical` when critical) and clicking opens the records drawer. Empty "Not in the reference model" gets "Open designer".
- Runs: `DataTable` as now with `PageHeader`.
- Loading: header plus `InsightHeader` skeleton (112px) plus table rows; never a single 480px block.
- Performance: catalogue and runs requests in parallel; `refetchInterval` 5s only while a run is in progress (already); prefetch L1 on row hover; the flow graph lazy-loads React Flow with a 480px fixed skeleton.

## 9. Systems (Task 7)

- List: `PageHeader` "Systems", primary "Connect system". Summary: `Stat "Unhealthy {n} of {total}"` tone by result, `Stat "Configuration missing {n}"` href `?config=not_loaded`; delete "Systems" count and the underlined link inside a Stat. Columns: System, Type, Health pill, DQS with `Delta`, Last extracted, Next run, Configuration pill; row click opens the system; "Test" moves to the detail page header. Filter chips. Empty: "No systems yet" / "Connect an SAP system or import a file." / primary "Connect system", secondary "Import file".
- Detail: `PageHeader` `<h1>` name, meta "{type} · {environment} · {host}", health `Pill`, actions: secondary "Test connection", "Edit", primary "Extract". Four `Stat`s (Health, Objects loaded, DQS, Open findings) with `loading` state so the header never paints before them. Replace every `rounded border` box with `Card`, every `<p className="text-[13px] font-medium">` with `Card title`. Empty actions: trend "Run a second analysis"; objects "Extract"; runs "Extract"; discovery "Discover design"; config "Load configuration". Edit drawer uses `Field`.
- Performance: list plus config plus schedule requests in parallel; detail requests keyed by the URL id in parallel.

## 10. Rules (Task 8)

- `PageHeader` "Rules", meta "{n} rules · {enabled} enabled", primary "New rule" (when `canManage`), `ExportMenu`. Permission note as `Notice tone="info"`. Summary `Stat`s: "Disabled {n}" (href) and "Not run yet {n}" only. Search uses `Field`/`Input`. Filter chips for the eleven states with a "Clear all" chip. Columns: Rule (`Mono`), Name, Object, Dimension, Severity dot+label, State (`Switch`, optimistic toggle), Last run, Not applicable. Drawer: title rule name, meta `Mono` id, body `Card`s "Definition" (rendered condition in prose and a `Mono` block, not raw JSON), "Thresholds" (table), primary action "Open rule" in the drawer footer. Empty: "No rules match" plus "Clear filters".

## 11. MDM, inbox, fix, import, admin (Task 9)

- MDM overview: `PageHeader`, `ScoreExplainer` in one `Card`, `Line` in another, four `Stat`s (Coverage, Match confidence, Steward SLA, Backlog, each with href); delete "Active systems", "Sync coverage", "Golden records" count. Empty via `EmptyState` with "Open golden records".
- Golden, match rules, survivorship, glossary: `ExplorerPage` with URL-state filters (`useUrlState`), `Field` inputs, `PageHeader`.
- Inbox (W8): `PageHeader` "Inbox", meta "{open} open · {overdue} overdue". Two `Stat`s only: "Overdue {n}" (no-go when above zero, href `?view=breached`), "Due today {n}". Kind toggle as segmented `Tabs`. Table with `j`/`k`/`a`/`r`/`x`/`Enter`/`Esc`/`?`; assign and resolve optimistic; reason drawer uses `Field`/`Textarea`. Exception rules drawer uses `Field`. Empty "Inbox is clear" plus "Open objects".
- Fix: rename "Dedup" to "Duplicates"; `PageHeader`; approve/reject optimistic; pager always visible when total is above the page size.
- Import: `PageHeader` "Import file", primary "Choose file". Drop zone is a `Card` with a dashed `--m-line-strong` border and the sentence "Drop a CSV or XLSX, or choose a file"; progress is a 2px `--m-accent` bar plus step label from a label map (no `replace(/_/g)`); errors use `Notice tone="no-go"`. Summary `Stat`s "Last import {relative}" (href to the run) only. Empty "No imports yet" plus "Choose file".
- Admin (all twelve pages): `PageHeader` per page; `Card` for every section; `DataTable` for every table (`triage/page.tsx:175`); `Field` for every input; `Notice` for every note box; error text through `apiErrorMessage`, no `as Error`. Users summary: one `Stat` "Never signed in {n}". Delete the other counts.
- Design gallery: a `Card` per section and `PageHeader`; add rows for `PageHeader`, `InsightHeader`, `EmptyState` with action, `DataTable` keyboard demo, light and dark side by side.

## 12. Sign-in, logo, favicon (Task 10)

Files: `components/auth/auth-frame.tsx`, `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/[[...sign-up]]/page.tsx`, `app/forgot-password/page.tsx`, `components/auth/set-password-form.tsx`, `components/meridian/icons.tsx`, `public/brand/*`, `app/icon.svg`, `public/manifest.webmanifest`, `public/brand/README.md`, new `app/opengraph-image.tsx`.

### Sign-in

Assessment: the frame is a two-panel marketing layout (gradient brand panel, FACTS bullets, decorative ring, serif tagline), which is the opposite of the product's instrument direction. Replace with a single centred card.

- Canvas `--m-canvas`. One card, 400px wide, `--m-sheet`, elev-1, radius `--m-radius-sheet`, 32px padding, vertically centred, `m-motion-rise` on mount only.
- Card top: `MeridianMark size={28}` left of the word "Meridian" 15/20 semibold (same lockup the rail uses). Below, `<h1>` 20/26 semibold "Sign in". No tagline, no FACTS, no ring, no serif, no footer sentence. Version string `v{appVersion}` 11/14 ink-3 mono under the card, right-aligned, since Basis uses it when reporting issues.
- Form: `Field label="Work email"` with `Input type="email" autoComplete="username"`, `Field label="Password"` with `Input type="password" autoComplete="current-password"` and the visibility `IconButton` inside the field (helper text goes in `Field helper`, never concatenated into the label). Primary `Button className="w-full" pending={loading}` "Sign in". Links row: "Forgot password" left (accent link, 13/18). Error: `Notice tone="no-go"` above the form with the `describeError` title and detail, focused on appear. Notices (reset, invited) `Notice tone="info"`.
- Sign-up, forgot password, set password: same card, titles "Create account", "Reset password", "Set password". Delete `authInputClass`, `authInputStyle`, `authFormClass`, `authActionsClass`, `AuthSpinner`, `BrandInstrument`, `FACTS`, `useAuroraPrefs`.
- Keyboard: Enter submits; Escape clears the error notice. Responsive: below 480px the card is full width with 16px gutters and 24px padding.
- Performance: the page ships no data queries; theme is applied by the inline script before paint, so no flash.

### Logo

Keep the mark geometry (270° arc plus vertical meridian line on a 32 grid, stroke 3, round caps). It is distinctive and reads at 16px. Change only colour and the wordmark.

- Colours from `brand.json`: `{"accent":"#4F46E5","accentDark":"#818CF8","canvas":"#F5F6F8","canvasDark":"#0F1115","ink":"#15171C","inkDark":"#ECEEF2"}`.
- `mark-light.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
  <path d="M21.74 7.81A10 10 0 1 1 10.26 7.81" stroke="#15171C" stroke-width="3" stroke-linecap="round"/>
  <path d="M16 3V29" stroke="#4F46E5" stroke-width="3" stroke-linecap="round"/>
</svg>
```

`mark-dark.svg` identical with `#ECEEF2` and `#818CF8`. `mark-mono.svg` both paths `currentColor`.

- Wordmark: delete `wordmark-*.svg` and `lockup-*.svg` (hand-traced monoline letters). The lockup is the mark plus the word "Meridian" set in Public Sans 600 at the mark's cap height, letter-spacing -0.01em, ink colour, gap 10px at 32px mark. In the app it is HTML (`Rail.tsx:388-395` already does this); for static assets export `lockup-light.svg` and `lockup-dark.svg` from that HTML with the text converted to outlines (Public Sans is OFL, outlining is permitted). Keep the accent on the meridian line only; no accent letters.
- `README.md`: update colours, drop the "I in accent" rule, add "the wordmark is always type-set Public Sans 600; never redraw letters".

### Favicon and icons

- `app/icon.svg` (favicon): the mark at 32 grid, stroke 3.5 for small sizes, ink `#15171C` arc and accent `#4F46E5` line on transparent. Dark-mode favicon through `<link rel="icon" media="(prefers-color-scheme: dark)">` using the dark mark. Add `app/icon.png` 32×32 fallback.
- `apple-icon.svg`: 180×180, flat `#4F46E5` background, radius 0 (iOS masks it), mark at 4× in white, both paths white (the accent line would vanish on the accent ground). No gradient.
- `manifest.webmanifest`: `theme_color` `#F5F6F8`, `background_color` `#F5F6F8`, icons `icon-192.png`, `icon-512.png`, `maskable-512.png` generated from the apple icon with 20% safe zone.
- OG image: delete `og-image.svg`; add `app/opengraph-image.tsx` with `ImageResponse` 1200×630, `#F5F6F8` ground, lockup at 64px mark top-left, one line 48px Public Sans 600 "SAP data quality, measured" and one line 24px 400 ink-2 "Deterministic checks, explained scores, S/4 readiness per object", nothing uppercase, no mono line, no gradients.

## 13. Implementation tasks, in order

1. Foundations: tokens, fonts, shell, `PageHeader`, `DataTable` keyboard and virtualisation, `usePrefetch`, `EmptyState` required action, `Stat onClick/loading`. Everything else depends on this.
2. Home (four personas, `HomePage` template, `_live`).
3. Runs list, run detail, compare, `ReportPage`.
4. Objects list, object detail, record page, root cause.
5. Insights index and every insight page, including the designer migration off `aurora-*`.
6. Process catalogue, L1, runs.
7. Systems list and detail.
8. Rules.
9. MDM, inbox, fix, import, admin, design gallery.
10. Sign-in pages, brand assets, favicon, OG image, `DESIGN.md` rewrite to match the hard rules.

Each task ends with `npm run lint:tokens`, `npm run check:contrast`, `npm run typecheck`, and a light and dark screenshot of the page at 1440 and 390 wide attached to the PR. Do not run `npm run build`. Do not touch port 3100.
