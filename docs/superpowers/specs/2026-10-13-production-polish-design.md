# Production polish: resilience, help, tours, missing feature UIs, preferences

**Date:** 2026-10-13
**Status:** approved, in build
**Scope:** frontend (`frontend/`) plus two small backend additions (user preferences, client error log)
**Design system:** "The Instrument" (`frontend/DESIGN.md`, `frontend/design/`). Every rule in DESIGN.md applies to every surface below: tokens only, primitives only, one `h1`, URL is state, every number drills, skeletons in final geometry, light and dark equal, reduced motion zero, axe clean.

This spec is written for the building agents. Each lane is self-contained; lanes 2, 3 and 4 may build in parallel once lane 1 has merged.

---

## Lane 1: Resilience and gates

### 1.1 Error surfaces
- `app/(app)/error.tsx` (client component): renders inside the shell frame. Uses `ErrorState` with title "This page hit an error", the error digest as a `Mono` reference id ("Reference `<digest>`"), a primary `Button` "Try again" calling `reset()`, a secondary "Go home" link, and a "Copy details" ghost button that copies `{digest, message, pathname, time}` to the clipboard. Logs the error through `lib/client-errors.ts` (1.3).
- `app/global-error.tsx`: minimal document (`<html><body>`), no shell, same copy, inline styles using the token variables only (`tokens.css` must still be imported).
- `app/(app)/not-found.tsx`: `EmptyState` "There is nothing at this address", one detail sentence, actions: "Go home" and "Search" (links to `/search`). Also `app/not-found.tsx` for signed-out paths.
- Dynamic routes that already 404 through `isNotFound` keep doing so; `notFound()` from `next/navigation` renders the new page.

### 1.2 Vitest and token gates in CI
- `.github/workflows/aurora-e2e.yml`: add steps `npm run test -- --run --coverage`, `npm run lint:tokens`, `npm run check:contrast` after lint and before Playwright. Coverage floor in `vitest.config.ts`: `lines: 60, functions: 55, branches: 50, statements: 60` (measure first; if the current numbers are lower, set the floor 2 points below current so the gate holds the line, and say so in the PR).
- Fail the job on any `console.error` in unit tests (`vitest.setup.ts`: throw on `console.error` unless a test opts out with `allowConsoleError()`).

### 1.3 Client error log (no third party)
- Backend: `api/routes/client_errors.py`, `POST /api/v1/client-errors` body `{digest, message, stack?, pathname, user_agent, time}`, any authenticated user, rate-limited (existing `rate_limiter`), writes to `audit_log` with `action="client_error"` (no new table). Register in `api/main.py`. Test in `tests/test_client_errors.py`.
- Frontend: `lib/client-errors.ts` `reportClientError(err, ctx)` with a 1-per-digest-per-session guard; called from `error.tsx`, `global-error.tsx` and a `window.onunhandledrejection` hook in the app layout.

### 1.4 Confirm and undo
- `design/primitives/ConfirmDialog.tsx`: `title`, `body`, `confirmLabel`, `tone: "danger" | "default"`, optional `typeToConfirm: string` (the user must type the value, e.g. the team name), `pending`. Built on `Dialog`. Test file beside it.
- Replace the three `window.confirm` calls in `app/(app)/admin/triage/page.tsx` (lines ~129, 257, 371) and any other `window.confirm`/`confirm(` in `app/` with `ConfirmDialog`; deletes use `typeToConfirm`.
- `design/shell/Toaster.tsx`: support `toast.undoable(message, { undo: () => Promise<void>, timeoutMs = 8000 })` that renders an "Undo" action; wire it where the API has an inverse: inbox dismiss/assign (`lib/inbox-keys.ts` handlers), rule enable/disable, learned-rule approve/reject. No fake undo: if there is no inverse endpoint, no undo.

### 1.5 Accessibility baseline (small, ships with lane 1)
- Skip link as the first focusable element in `app/(app)/layout.tsx` ("Skip to content", target `#main`).
- `design/tokens.css`: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition-duration: 0ms !important } }` in addition to the JS helper.
- `Field`: when `error` is set, the control gets `aria-invalid="true"` and `aria-describedby` pointing at the error text id.

**Done when:** `npm run typecheck && npm run lint && npm run lint:tokens && npm run check:contrast && npm run test -- --run && npx playwright test e2e/aurora-a11y.spec.ts` all pass; a deliberate `throw` in a page shows the new error page in light and dark; `/nope` shows the not-found page.

---

## Lane 2: Help, tours and onboarding

### 2.1 Help menu and shortcuts
- `design/shell/HelpMenu.tsx`: a `?` `IconButton` in `TopBar` (prop `helpMenu`) opening a `Menu` with: "Tour this page" (when a tour exists for the route), "Keyboard shortcuts" (opens 2.2), "What's new" (2.4), "Documentation" (opens `/docs` route below), "Report a problem" (opens a `Dialog` that prefilled-copies the page URL, run id and version string to the clipboard and shows the support e-mail from `NEXT_PUBLIC_SUPPORT_EMAIL`, default `support@meridian.local`; no network call).
- `design/shell/ShortcutSheet.tsx`: opened by `?` anywhere outside an input, and from the help menu. Lists shortcuts grouped: Navigation (from `lib/nav.ts` `shortcut` fields), Tables (arrow keys, Enter, Space, Escape, from DataTable), Inbox (from `lib/inbox-keys.ts`), Global (`⌘K`, `[`, `?`). One source of truth: `lib/shortcuts.ts` exporting the registry; the inbox drawer at `app/(app)/inbox/page.tsx` must read from it (delete its private list).

### 2.2 Contextual help
- `lib/help/glossary.ts`: `{ term, short (≤120 chars), long (≤400 chars), href? }` for: DQS, cap (85/70), dimension (six), basis, scope, applicability (applies / does not apply / by default / not available), grain, population exclusion, field status, unmaintained field, root cause (bad data / bad config), proven cost, variant, happy path, conformance, fitness, golden record, survivorship, match rule, contract, wave, dry run, Z-object, ghost config, drift.
- `design/primitives/HelpHint.tsx`: a 14px `Info` icon button with `aria-label="About <term>"`, opening a `Tooltip` on hover and a popover (`Card`, raised elevation) on click with the long text and optional "Learn more" link. `Stat` gains an optional `help: GlossaryKey` prop that renders `HelpHint` beside the label. Apply `help` on every `Stat` and `ScoreRing`/`DqsScore` label across `app/(app)` where the label is a glossary term (grep for the terms; do not invent new ones).
- `app/(app)/docs/page.tsx`: renders `docs/user-guide/*.md` (new folder, written by this lane: one page per workspace: Home, Systems, Objects, Runs, Rules, Insights, MDM, Migration, Inbox, Fix, Admin; 150–300 words each, plain language, screenshots not required). Markdown rendered with a tiny in-house renderer (headings, paragraphs, lists, code, links) on the design system, no new dependency. Left rail lists the pages; `?page=` is the state.

### 2.3 Tours
- `design/shell/Tour.tsx`: in-house spotlight tour. API: `startTour(id)`, steps `{ target: string (data-tour attribute value), title, body, placement }`. Renders an overlay with a cut-out around the target (`position: fixed`, mask via four panels, no backdrop blur), a `Card` with step N of M, Back / Next / Done, Escape closes, focus trapped in the card, reduced motion = no transitions. Persists completion in the user preferences (lane 4; until then `localStorage` `m-tour:<id>`).
- `lib/help/tours.ts`: four persona tours, each 5–7 steps, targets added as `data-tour="..."` attributes on existing elements:
  - `steward`: inbox queue, finding drawer, sample records, fix batch, keyboard keys.
  - `lead`: home verdict, DQS cap explainer, trends, executive report export, owners.
  - `basis`: systems list, connect, extraction run, config load panel, schedules.
  - `process`: process L1 list, variants, conformance, designer, Signavio/PowerPoint export.
  Plus `first-run` (3 steps: rail, run selector, command palette) offered once on the persona home.
- First-run checklist: `design/templates/FirstRunChecklist.tsx` on each `home/<persona>` page, shown while any item is incomplete, dismissible: items are derived from real state (system connected: `getSystems().length`, first run complete: versions with a finished status, first fix: `getFixBatches` non-empty, team invited: users > 1, alert channel set). Each item links to its page. Hidden entirely once all are complete.

### 2.4 What's new
- `frontend/whats-new.json`: `[{ version, date, items: [{ title, body, href? }] }]`; this lane seeds it with the current release's entries (read the last 30 commits on `main` for material).
- `design/shell/WhatsNew.tsx`: drawer listing versions; the help-menu item shows a dot when `whats-new.json[0].version` ≠ the stored seen version (preferences, else localStorage `m-seen-version`). Version string from `lib/version.ts` (exists; if not, from `package.json`).

**Done when:** every persona tour runs end to end on the sim stack without a missing target; `?` opens the sheet on every route; `/docs` renders all pages; HelpHint appears on every glossary-term Stat; axe clean; unit tests for Tour, ShortcutSheet, HelpHint, glossary coverage (every `help=` key exists).

---

## Lane 3: Missing feature UIs

All endpoints below already exist in `api/routes/`. Add typed wrappers in `lib/api/*.ts` first, then the UI. Every mutation: `Button pending`, toast, query invalidation; destructive ones through `ConfirmDialog`.

### 3.1 Rules authoring
- `/rules/drafts`: becomes an editable list. Row drawer: name, object, field, check class, severity, dimension, conditions (JSON editor with validation), "Dry run" (`POST /rule-authoring/dry-run`, shows matched rows and a sample), "Publish" (creates the rule and removes the draft), "Delete". "New draft" primary action: a form, plus "Generate with AI" (`POST /rule-authoring/generate` with a prompt field; the result lands in the form as a draft, never published directly; show the AI notice from `AiSummary`).
- `/rules/[ruleId]`: version lifecycle: list versions with state, "Transition" menu calling `POST /rules/{id}/versions/{v}/transition` with the allowed targets from the API.
- `/rules/learned`: "Mine now" primary action (`POST /learned-rules/mine`) with job progress through the job tray.

### 3.2 Z-object intelligence (`systems/[systemId]/custom-objects-tab.tsx`)
- "Detect now" (`POST /z-objects/detect`) with progress.
- Registry rows editable in a drawer (`PUT` registry: owner, purpose, documented flag).
- Anomaly rows: "Expected" / "Investigate" feedback buttons (anomaly feedback endpoint).
- New "Rules" sub-tab: list and create Z rules (`GET`/`POST /z-objects/rules`).
- "Report" export button and "Mapping" sub-tab (FK mapping of Z fields to standard fields) from the existing endpoints.

### 3.3 Config intelligence (`systems/[systemId]/config-tab.tsx`)
- "Discover now" (`POST /config/discover`) with progress.
- Inventory: clicking a module opens `/config/inventory/{module}` in a drawer (elements, counts, status chips: implemented / customer-specific / configured-not-used / dormant).
- Alignment: per-module drawer from `/config/alignment/{module}`.
- Finding drawer (`design/templates/FindingDrawer.tsx`): a "Root cause" section calling `/config/root-cause/{finding_id}` when the finding has one, showing bad data / bad config / both with the value lists.

### 3.4 What-if (`/fix/what-if`)
- "Create fix batch from this simulation" (`POST /remediation/batches/from-simulation`) → navigates to `/fix/[batchId]`.
- Per-rule table: resolved / introduced / improved / regressed / side effects with drill to records; per-record drawer.

### 3.5 Process exports
- `/process/[l1]` and `/insights/process` export dialog: add "PowerPoint" next to Signavio (`/process-designer/.../export/pptx` and `/models/{id}/export/pptx`) via `downloadAuthenticated`.

### 3.6 Owners and mining
- `/insights/owners`: "Send digest now" per owner and "Schedule digests" (existing digest endpoints; if only the worker task exists, expose `POST /owners/digests/send` in `api/routes/` as a thin wrapper over `workers/tasks/send_owner_digests.py`).
- `/insights/duplicates`: add the mining duplicates, anomalies and relationships (`GET /mining/duplicates`, `/anomalies`, `/relationships`) as three tabs with DataTables and drill to records.

### 3.7 S/4 readiness tab (`migration/[waveId]/s4-tab.tsx`)
- Summary row (`Stat`s: ready / blocking areas / failing records), per-area remediation text from the pack (`s4_impact`, `related` rules), "Open findings" and "Create fix batch" actions per area.

**Done when:** each new control exercises its endpoint on the sim stack with zero API errors (screenshots in the PR), wrappers typed (no `any`), unit tests for each new wrapper and component, routes added to `e2e/routes.json`, axe clean.

---

## Lane 4: Preferences, notifications and forms

### 4.1 Server-side user preferences
- Migration `081_user_preferences.py`: `users.preferences JSONB NOT NULL DEFAULT '{}'`.
- `api/routes/preferences.py`: `GET /api/v1/me/preferences`, `PATCH /api/v1/me/preferences` (JSON merge; keys: `theme`, `density`, `locale`, `timezone`, `saved_views` (by table id), `tours_done` (ids), `seen_version`, `notifications` `{ digest: "daily"|"weekly"|"off", immediate_critical: bool, channels: {...} }`). Pydantic model, validated, current user only. Tests.
- Frontend `lib/preferences.ts` + `hooks/use-preferences.ts`: load once after sign-in, cache in React Query, write-through to localStorage so the first paint has no flash; `use-theme.ts`, density, `design/table/views.ts`, Tour and WhatsNew read and write through it.
- `/admin/settings` gains nothing; a new user-level page `/me/preferences` (reachable from the user menu "Preferences"): theme, density, locale (`Intl` locales list), timezone (`Intl.supportedValuesOf("timeZone")`), notification digest and immediate-critical toggles, "Replay tours", "Reset saved views".
- `lib/format.ts`: `formatDate`/number helpers read locale and timezone from preferences (fallback browser).

### 4.2 Notification bell
- `design/shell/NotificationBell.tsx` in `TopBar` (prop `notifications`): unread count badge from `GET /notifications/unread-count` (poll 60 s, and refetch on job completion from `useJobs`), popover listing the latest 10 with type pill, title, relative time, mark-read on open, "Mark all read", "Open all" → an in-app page `/inbox/notifications` (list with filters by type and unread, mark read, links).

### 4.3 Forms
- `lib/forms.ts`: a tiny schema helper (`required`, `email`, `url`, `int(min,max)`, `oneOf`) returning `{ errors, valid }` — no new dependency. Apply to the four largest forms: connect system, invite user, new contract, alert channel. Inline errors through `Field error`, `aria-invalid` (from lane 1), submit disabled until valid.

### 4.4 Print
- `design/print.css` (imported in the app layout, `@media print`): hide rail, top bar, job tray, buttons; sheets full width; page breaks before `h2` on `ReportPage`. "Print" item in `ExportMenu` on report pages calling `window.print()`.

**Done when:** preferences survive a sign-out and a different browser; bell shows real notifications on the sim stack; the four forms reject invalid input inline; a report page prints without chrome; tests for preferences route, hook, forms helper, bell.

---

## Lane 5: Verification (after lanes 1–4 merge)
- `e2e/routes.json`: add `/docs`, `/me/preferences`, `/inbox/notifications`, `/rules/drafts` (editable), each new tab via query.
- New specs: `e2e/errors.spec.ts` (error and not-found pages), `e2e/help.spec.ts` (help menu, `?` sheet, HelpHint, a tour end to end), `e2e/preferences.spec.ts`.
- Visual pass in light, dark, reduced motion; axe on every route; the sim-stack capture script over every new surface with zero API errors.
- CI green; adopt CI's Chromium renders where glyph drift appears (established procedure).

---

## Conventions for the building agents
- Branch per lane from `main`: `claude/polish-lane-<n>`; one draft PR per lane; PR body lists each spec item with its file and a screenshot.
- No new runtime dependency without saying so in the PR; none is expected.
- Copy: sentence case, no full stops in cells/pills/labels, imperative button labels naming the action ("Create draft", never "Submit"/"OK"/"Cancel" → use "Keep" / "Not now" / the inverse action).
- Nothing leaves the customer boundary: no external URLs at runtime except the documented support e-mail text.
- Run the full gate list from lane 1 before every push.
