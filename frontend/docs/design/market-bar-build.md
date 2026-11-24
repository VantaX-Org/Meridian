# Market bar: build spec

This is the build spec for the two screens designed to the bar in `market-bar.md`. Read that file first: every
line here cites a checklist id from it (S speed, D drill-down, G grid, C charts, K keyboard, M motion and grid,
E empty and error, A AI in the cell, B beyond the market).

The designs to match are the two previews. Open them in a browser; they are interactive.

- `docs/design/preview/object-detail.html`
- `docs/design/preview/fix-flow.html`

The previews carry inline CSS and JS so they can stand alone. Do not copy that code. Build with the kit, the
`--mx-*` tokens, `lib/v2/i18n` strings in all three locales, and fixtures behind `?fixture=1`.

## Rules that hold for every batch

1. Extend the kit component that already exists. Do not add a second component that does the same job. The kit
   already has `ScoreRuler`, `KpiStrip`, `StatTile`, `DetailPanel`, `Evidence`, `TrendArea`, `BandChart`,
   `DimensionBars`, `SeverityStrip`, `BarList`, `DataTable`, `ExportMenu`, `CommandPalette`, `Toast`, `UndoToast`.
2. Never invent an SAP field, an API field, a module id or a rule id. Where a design needs data the API lacks,
   the gap is in the "Backend gaps" section. Until the endpoint ships, the cell shows the sentence given there
   and the feature stays off. No placeholder values.
3. The previews contain illustrative numbers (listed at the end). They are not fixtures. Fixtures come from
   `lib/api/v2/fixtures` and the real response shapes.
4. `npm run lint:tokens` must pass with no new line in `scripts/lint-tokens.allow.txt`. No raw hex, gradient,
   blur, ad hoc shadow or motion literal outside `ui/tokens.css`.
5. No U+00B7 anywhere under `frontend/`. Sentence case. Every code shows its description beside it.
6. Violet (`--mx-violet`) is Aletheia only. It marks a proposed value and nothing else.
7. Commit the test with the screen it tests. Report a blocked suite at once.

## New tokens

Add to `ui/tokens.css` under `.mx-root`. Each duration also goes to `0ms` in the existing
`prefers-reduced-motion` block, beside `--mx-dur`.

| Token | Value | Use | Checklist |
| --- | --- | --- | --- |
| `--mx-dur-instant` | `80ms` | hover, press, row focus, chip toggle | M1 |
| `--mx-dur` | `140ms` (exists) | popover, menu, toast in | M1 |
| `--mx-dur-panel` | `220ms` | side panel, sheet, bulk bar, dialog | M1 |
| `--mx-dur-value` | `600ms` | score marker travel, bar growth, number count | M1, B1 |
| `--mx-ease` | `cubic-bezier(0.2, 0, 0, 1)` (exists) | enter | M2 |
| `--mx-ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | exit; exits run at the next shorter duration | M2 |
| `--mx-ease-value` | `cubic-bezier(0.3, 0, 0.2, 1)` | value change | M2 |
| `--mx-s7` | `48px` | gap between page sections only | M4 |
| `--mx-row` | `32px` | grid row height, compact | G8 |
| `--mx-row-comfort` | `40px` | grid row height, comfortable | G8 |

Spacing stays on the 4px scale `--mx-s1` to `--mx-s7`. No other gap value in screen CSS. Update
`docs/design/DESIGN.md` in the same batch: it is out of step with `tokens.css` today.

## Batch 1: kit

All files are in `ui/kit`. Each change keeps the current props working, so screens that are not yet rebuilt do
not break.

| Component | Change | Checklist |
| --- | --- | --- |
| `DataTable.tsx` | Add: column sort on header click with `aria-sort`; a filter chip row driven by a `filters` prop; `groupBy` with collapsible group rows that show count and sum; sticky header and sticky first column; row selection with a header checkbox and a `bulkBar` slot that appears when one or more rows are selected; row keys J and K (same as arrow keys), X to select, Enter to open, Escape to clear; an `editable` column type (Enter or F2 to edit, Enter to commit, Escape to cancel); density prop `compact` or `comfortable`; `rowHref` so a row is a real link; virtualised body above 200 rows. All state (sort, filters, group, selection anchor) is controlled and comes from the URL through one hook, `useGridState(key)`. Keep the current arrow, Home, End, Enter and Space keys. | G1 to G9, K2, D4 |
| `useGridState.ts` (new, in `ui/kit`) | Reads and writes sort, filter, group and open row to the query string with `router.replace`. One hook for every grid. | D4, G6 |
| `StatTile.tsx`, `KpiStrip.tsx` | Add `href` or `onSelect`. With either, the tile renders as a link or button with focus ring and hover tone, and shows the filter it applies in its `title`. A tile with neither stays plain text. | D1 |
| `BarList.tsx`, `DimensionBars.tsx`, `SeverityStrip.tsx` | Add `onSelect(key)` and `selected`. Each bar or segment is a button; the selected one keeps full tone and the rest drop to `--mx-line-strong`. Add a hover tooltip with value and share. | D1, C2, C3 |
| `TrendArea.tsx`, `BandChart.tsx` | Add a crosshair and tooltip on hover, keyboard focus per point (left and right arrows), `onSelect(point)`, and an optional `gates` prop that draws the 70 and 85 lines with labels. Add `brush` (drag to set a range, reported through `onRange`). | C1 to C5 |
| `RunLines`, `ToneBars`, `WeeklyChart` | Move from `ui/screens/object/Board.tsx` into `ui/kit` as `RunLines.tsx`, `ToneBars.tsx`, `WeeklyChart.tsx`, then give them the same hover, focus and `onSelect` contract. | C1 to C3 |
| `ChartFrame.tsx` | Add a "Show as table" toggle that renders the same series in a `DataTable`, and the shaped loading, empty and error states for a chart. | C6, E1 |
| `ScoreRuler.tsx` | Add `projected` and `actual` markers beside `shown` and `measured`. The marker moves with `--mx-dur-value` and `--mx-ease-value`. Labels never overlap: when two markers are closer than 48px the labels sit on opposite sides. | B1, B2 |
| `Toast.tsx`, `UndoToast.tsx` | `Toast` gets an `action` slot (label and handler) and a `progress` line. `UndoToast` becomes a thin wrapper that passes Undo as the action and binds Ctrl Z or Cmd Z while it is open. | S4, K5 |
| `DetailPanel.tsx` | Becomes the one side panel: opens from the right in `--mx-dur-panel`, keeps the grid visible, traps focus, Escape closes, J and K move to the next and previous row without closing. Its open row is in the URL. | D2, D3 |
| `Evidence.tsx` | Add a popover form: source, confidence, the reason sentence, and the records it was learned from when the API gives them. Used by the proposal chip. | A2, A3 |
| `ProposalChip.tsx` (new) | Current value struck through, proposed value in violet, confidence as text. Tab or A accepts, R rejects with a reason menu, E edits. Opens `Evidence` on click or I. This is the only new visual component. | A1, A4 |
| `CommandPalette.tsx` | Add a `context` prop: the current screen registers its own actions (filter by, group by, accept all, create load file, open rule). Show the shortcut beside each action. | K1, K4 |
| `ShortcutSheet.tsx` (new) | Opens on `?`. Lists the shortcuts the current screen registered. Built on `Sheet`. | K3 |
| `states.tsx` | Add shaped skeletons: `GridSkeleton` (header plus rows at `--mx-row`), `ChartSkeleton`, `HeroSkeleton`. Add `EmptyState` with one sentence, one action and no illustration, and `ErrorState` with the failed request named, a Retry button and the last good data kept on screen. | S1, E1 to E4 |
| `kit.css` | Styles for the above from tokens only. | M3 to M7 |

Optimistic mutations: add one helper, `lib/v2/optimistic.ts`, that wraps a TanStack `useMutation` with
`onMutate` cache patch, rollback on error with an error toast, and the undo toast when the response carries an
`action_id`. Every decide, accept, reject and edit goes through it. Checklist S3, S4.

Kit tests (Vitest, beside each component): sort, filter, group and selection change the URL; J, K, X, Enter and
Escape on `DataTable`; `Toast` action fires and Ctrl Z calls undo; `ScoreRuler` label collision rule;
`ProposalChip` A, R, E keys; each chart calls `onSelect` from mouse and keyboard. Extend `e2e/ui-kit.spec.ts`
with one axe run per new state, light and dark.

## Batch 2: object detail

Route: `app/(app)/o/[system]/[module]/page.tsx` (stays thin). Screen: `ui/screens/object/ObjectScreen.tsx`,
`Board.tsx`, `ObjectExtras.tsx`, `useObjectData.ts`, `answers.ts`.

Target: `preview/object-detail.html`.

1. Replace the stack of about twelve cards with four regions: hero, KPI row, chart row, one rule grid.
2. Hero: object name with its description, the answer sentence from `answers.ts`, `ScoreRuler` with shown and
   measured, the cap reason as a sentence that links to the capping rules, and one primary action, "Fix the
   rules that cap the score", which opens the fix flow filtered to those rules.
3. KPI row: five `StatTile`s, each a drill-down that sets a grid filter (records, failing records, critical
   rules over tolerance, rules with a proposal, records back after clean). The last one reads
   `GET /api/v1/work/back-after-clean`.
4. Chart row, three cards, each one filters the grid on click and shows its filter as a removable chip:
   score per run with the 70 and 85 gates (`TrendArea` with `gates`), failing records by dimension
   (`DimensionBars`), failing records by severity (`SeverityStrip`).
5. One rule grid replaces the three rule lists and every "Top 10" slice. Columns: rule id with its name beside
   it, dimension, severity, failing records, share against tolerance, with proposal, trend. Sort, filter chips,
   group by dimension or severity, bulk bar, state in the URL. Row opens `DetailPanel` with the rule sentence,
   field with description, tolerance, sample failing records and "Fix these records".
6. Delete what the grid replaces in `Board.tsx` and `ObjectExtras.tsx`. The tabs under `ui/screens/object-tabs`
   stay as routes; the Rules and Fixes tab links from this screen go to the grid filter and the fix flow.
7. Loading shows `HeroSkeleton`, `ChartSkeleton` and `GridSkeleton` in place, never one line for the whole
   screen. Cached data paints first, then refreshes (`placeholderData: keepPreviousData`).

Data used, all existing: `GET /api/v1/objects/{module}`, `GET /api/v1/objects/{module}/receipt`,
`GET /api/v1/scores/history` (per-module series by run), `GET /api/v1/findings`,
`GET /api/v1/analytics/forecast/{module_id}`, `GET /api/v1/simulate/fix/top`,
`GET /api/v1/work/back-after-clean`.

Tests:

- Vitest, `ui/screens/object/ObjectScreen.test.tsx`: each KPI tile and each chart mark sets the expected URL
  filter and the grid row count changes; group by renders group rows with counts; the cap sentence names the
  capping rule ids; skeleton, empty and error states render from fixtures.
- Playwright, extend `e2e/object-tabs.spec.ts` or add `e2e/object-detail.spec.ts`: keyboard path J, Enter,
  Escape, G; Ctrl K lists the screen actions; reload keeps sort, filter, group and open row; axe passes light
  and dark; no horizontal scroll at 1280 and 1440.
- Budget check in the same spec: first paint from cache under 100ms in fixture mode, filter change under 50ms.

## Batch 3: fix flow

Route: `app/(app)/work/page.tsx` and the object tab `app/(app)/o/[system]/[module]/fixes/page.tsx`. Screens:
`ui/screens/work/Work.tsx`, `CleanBoard.tsx`, `CleaningQueue.tsx`, `CleaningPlan.tsx`, `RecordDetail.tsx`,
`BatchSend.tsx`, `SimulateSheet.tsx`, `UndoBar.tsx`, `sheets`, `shared.ts`, `clean.css`, and
`ui/screens/object-tabs/Fixes.tsx`.

Target: `preview/fix-flow.html`.

1. One screen from issue to load file. The path today crosses three routes and a nine-tab cleaning queue. The
   new screen has three regions: a pinned score strip, a rule rail on the left, a record grid on the right.
   `Fixes.tsx` renders the same screen scoped to its object.
2. Score strip, pinned under the top bar: `ScoreRuler` with shown, measured and projected; the sentence
   "N draft decisions in M rules"; the cap state ("capped at 70 by 2 critical rules", then "cap lifts to 85",
   then "no cap"); the primary action "Create load file, N records".
3. Projection: on each draft change, debounce 300ms and call `POST /api/v1/simulate/fix` with the drafted
   `records` (or `rules` when a whole rule is accepted). Show `after.score`, `after.raw_score`,
   `after.cap_level` and `delta.breaches_cleared`. While the call is in flight keep the last projection and
   show the progress line; never show a client-side guess. The body allows 5,000 records: above that send the
   rule ids for fully accepted rules and say so in the strip.
4. Rule rail: failing rules for the object, each with id, name, severity, failing count and count decided.
   Selecting a rule filters the grid. Order: capping rules first.
5. Record grid: record key with name, field with its description, current value, proposed value as
   `ProposalChip`, source, confidence, status. A accepts, R rejects with a reason, E edits inline, X selects,
   Shift A opens "Apply all N proposals" with a preview bar that lists count, rule and projected score before
   Enter confirms.
6. Every decision is optimistic through `lib/v2/optimistic.ts` and undoable from the toast and Ctrl Z, using
   `action_id` from `POST /api/v1/work/decide` and `POST /api/v1/actions/undo`.
7. Load file dialog replaces the separate send route for the common case: format picker from
   `GET /api/v1/cleaning/export-options`, the pre-check from the writeback batch check, then download or send.
   `BatchSend.tsx` stays for the full send history.
8. After the next run: the strip adds the actual marker beside projected and one sentence that explains the
   difference. This needs backend gap 8; until then the strip shows projected and the new shown score only.
9. Fold `Triage`, `Exceptions`, `Approvals` and the cleaning queue tabs into filters of this grid (status
   chips), keeping their routes as redirects with the filter set. No function is lost: each old tab maps to one
   chip, listed in the PR text.

Tests:

- Vitest, `ui/screens/work/Work.test.tsx`: A, R, E and Shift A paths patch the cache before the response; a
  failed decide rolls back and shows the error toast; undo restores the row and the strip sentence; the
  projection call carries the drafted record keys and the strip shows the response, not a local sum; plural
  strings for 1 and many in all three locales.
- Playwright, `e2e/fix-flow.spec.ts`: from object detail, "Fix the rules that cap the score" lands on the
  filtered grid; accept one, undo, accept all, create load file, all by keyboard; old routes redirect with
  their filter; axe passes light and dark.
- Budget check: keypress to row state change under 50ms; projection visible within 400ms of the last
  keypress in fixture mode.

## Batch 4: propagation

Apply the kit to every other screen, one folder per commit, in this order: `ui/screens/home`, `runs`, `rules`,
`load`, `mdm`, `insights`, `people`, `requests`, `systems`, `admin`, `orphans`, then the remaining
`ui/screens/object-tabs` (Records, Record, Rules, Runs, Trend, Profile, Readiness, Lineage, Golden, Glossary,
Processes, ProcessDesign, Blast, Lead, Material360).

Per screen, the acceptance list is short and the same:

1. Every number that counts rows is a link or button to those rows (D1).
2. Every table is `DataTable` with URL state through `useGridState`; no local table markup (G1 to G9).
3. Every chart has hover, keyboard focus, click to filter and "Show as table" (C1 to C6).
4. Every mutation is optimistic with undo where the API returns `action_id` (S3, S4).
5. Shaped skeleton, `EmptyState`, `ErrorState`; no full-screen single-line skeleton (S1, E1 to E4).
6. The screen registers its actions with the palette and the shortcut sheet (K1, K3).
7. Durations and curves from the tokens above only; spacing on the 4px scale (M1 to M7).

Tests: extend the existing spec for each folder (`e2e/home.spec.ts`, `runs`, `rules`, `load`, `mdm`,
`insights`, `people`, `systems`) with the keyboard path, reload-keeps-state and axe in both themes. Close the
batch by re-scoring both key screens and three others against `market-bar.md` and writing the scores into its
"Today" column.

## Backend gaps

Routes named "existing" were confirmed by reading `api/routes` on this branch. Nothing below is built in the
frontend until the endpoint ships.

| # | Need | Endpoint | Used by | Until it ships |
| --- | --- | --- | --- | --- |
| 1 | The failing field's current value, its description, the proposed value's description and the allowed values, on the list row. Today the row has `top_field`, `top_message`, `suggested_value` only; the values are on the detail call. | Extend `GET /api/v1/work/records` rows with `current_value`, `current_label`, `suggested_label`, `field_description`, `possible_values` | Fix flow grid, proposal chip | The grid loads `GET /api/v1/work/records/{module}/{record_key}` for visible rows only and shows "value loads on open" for the rest |
| 2 | Proposal evidence and the SAP safety verdict on the row. Today a suggestion has `source`, `confidence`, `why`; safety is a separate call. | Extend the same rows with `suggestion: {source, confidence, why, safety}`; or `GET /api/v1/work/records/evidence?module=&keys=` for a page of rows | Evidence popover | Popover shows source, confidence and why from the detail call; safety line reads "safety check not loaded" |
| 3 | Undo for cleaning and group actions. `action_id` comes back from decide only. | Return `action_id` from `POST /api/v1/cleaning/approve/{item_id}`, `reject/{item_id}`, `apply/{item_id}`, `bulk-approve`, `bulk-reject`, and from `POST /api/v1/work/groups/{check_id}/accept-all` and `set-value`; accept them in `POST /api/v1/actions/undo` | Bulk apply, undo toast | Bulk apply shows a confirm dialog with the count and has no undo; the toast says so |
| 4 | Server filter, group and count. | Add to `GET /api/v1/work/records`: `dimension`, `field`, `source`, `min_confidence` filters and `group_by=` returning `{key, label, count}`; same `group_by` on `GET /api/v1/findings` | Group by, filter chips above one page of data | Group and filter run in the client on the loaded page, and the grid states "grouped within the loaded N rows" |
| 5 | Saved views outside Work. | `GET`, `PUT`, `DELETE /api/v1/views` exist; confirm the `screen` key accepts any screen id, or add it | Saved views on every grid | Views stay in the URL only; no saved-view menu outside Work |
| 6 | Descriptions beside codes: plant name, value description. | `GET /api/v1/objects/{module}/value-labels?field=&values=` returning `{value, label}` from the extracted check tables | Every code cell | The cell shows the code and "description not in API" |
| 7 | Rules with a proposal, per rule. | Add `with_proposal` (count of failing records that have a suggested value) to each rule row of `GET /api/v1/findings` or `GET /api/v1/work/groups` | Object detail KPI and grid column, rule rail | Column hidden; KPI tile hidden |
| 8 | Projected against actual after the next run, per rule. | `GET /api/v1/simulate/fix/outcome?module=&run_id=` returning per rule: projected failing, actual failing, records reopened, and one reason code | Fix flow strip after a run | Strip shows the new shown score and no comparison |
| 9 | Measured (uncapped) score per run. `GET /api/v1/scores/history` gives the composite per module per run, not the raw score or cap level. | Add `raw_score` and `cap_level` to each entry of `modules[module]` in `GET /api/v1/scores/history` | Score per run chart: shown and measured lines | Chart draws the shown line only |
| 10 | Projection above 5,000 records. | Raise or page the `records` limit on `POST /api/v1/simulate/fix`, or accept a filter in place of a key list | Apply all on a large rule | Send rule ids for fully accepted rules; partial selections above 5,000 show "projection covers the first 5,000" |

Not a gap after all: a synchronous projection exists. `POST /api/v1/simulate/fix` takes rules, records and
batches and returns before, after and delta with score, raw score, cap level and breaches cleared. Its response
time under load was not measured; if it cannot meet 400ms, add a lighter `score_only=true` mode.

## Illustrative values in the previews

These were written for the previews and must not reach fixtures or strings: measured scores for runs before
run 8, "with proposal" counts per rule, the points each rule adds to the projection, current values,
confidence figures, evidence text, proposal sources, every run 9 figure, and "72 rules within tolerance". Of
the codes shown, only EA "Each" has a description known to the codebase; 0420, 3000 and P01 show
"description not in API" on purpose (gap 6).

## Batch order

1. Kit: tokens, `DataTable`, `useGridState`, charts, `ScoreRuler`, `Toast`, `DetailPanel`, `ProposalChip`,
   states, palette context, shortcut sheet, `optimistic.ts`, with kit tests.
2. Object detail, with its tests.
3. Fix flow, with its tests.
4. Propagation, one screen folder per commit, then the re-score.

All four batches go on `ux/market-bar` and into one later PR.
