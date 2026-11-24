# The market bar

The verdict on the current frontend was "looks better but falls far short of the other systems in the market".
The gap is not colour or type. It is interaction quality: how fast the screen answers, how far a number lets
you go, how much a grid lets you do without leaving it, and whether a fix moves the score in front of you.

This document sets the bar as a checklist that can be measured. A screen passes when every line that applies to
it passes. The two previews in `preview/` are designed to it, and `market-bar-build.md` is the build order.

## Where the benchmark comes from

Four public pages were fetched on 2026-11-23. Everything else is from my own knowledge of these products up to
mid 2026 and has not been checked against a live tenant. Treat product claims marked "knowledge" as a design
reference, not a sourced fact.

| Product | What it sets the bar for | Source |
| --- | --- | --- |
| Linear | Local-first speed: every action applies at once and syncs after; Cmd+K reaches every action; single-key shortcuts on the focused row; undo on every change; saved views shared with the team | Fetched `linear.app/docs/conceptual-model` (views and filters only). Speed, shortcuts and undo are knowledge |
| Stripe Dashboard | Every figure is a link to its list; filter chips with typed operators; `?` lists shortcuts; skeletons shaped like the content; exact number and currency formatting; column edit and export on every list | Fetched `docs.stripe.com/dashboard/basics` (filters, export, `?` shortcuts confirmed). The rest is knowledge |
| Datadog | Charts are controls: drag to zoom, cursor synced across every chart on the page, click a series to filter, time frame typed or picked | Fetched `docs.datadoghq.com/dashboards/guide/custom_time_frames` (typed time frames and arrow-key steps confirmed). Drag zoom and synced cursor are knowledge |
| Palantir Foundry | Object views where every aggregate opens its object set; pivot and group-by on any property; actions applied to a selection with a typed form; lineage one click away | Knowledge |
| Informatica IDMC and CLAIRE | AI proposals for rules and matches shown with a confidence; steward accepts or rejects in a task inbox | Knowledge |
| Ataccama ONE | Rule results with a sample of invalid records; AI term suggestions accepted or rejected by confidence; remediation is a separate module | Fetched `docs.ataccama.com/one/latest/data-quality/data-quality-overview.html`. It states that monitoring projects show "a sample of the data that failed", that "record-level data from monitoring projects is not stored", and that fixing means loading invalid records into ONE Data |
| Collibra | Score to rule to failing rows drill; ownership and workflow on every asset | Knowledge |
| Syniti | Migration cockpit: load-readiness per object, remediation reports, load files per target format | Knowledge |
| Profisee | Stewardship grid with inline edit, bulk update and match review | Knowledge |
| SAP MDG | Change requests with approval, validation against SAP config at entry, mass change with a simulation step | Knowledge |

What none of them does in one place, to my knowledge: show the failing records, the proposed value with its
evidence, the apply, the score moving, and the SAP load file on the same screen. The data quality products
stop at a sample of failing rows and hand off to a remediation module or a ticket. The master-data products
edit records but do not show a quality score move. The migration products make load files but from a separate
cockpit. That hand-off is where Meridian goes past them (section 9).

## How to read the checklist

Each line has an id, a pass test, and where Meridian stands today (`pass`, `part`, `fail`), judged from the code
on `origin/main` at d18d5f36f. Budgets are measured in fixture mode (`?fixture=1`) on a mid-range laptop with a
production build, and again against the Komatsu-size run (61,816 material records, 25,712 open work rows).

## 1. Speed

| Id | Pass test | Today |
| --- | --- | --- |
| S1 | Route change paints the new screen's frame (header, tabs, shaped skeleton or cached data) within 100 ms of the click | fail: `ObjectScreen` holds the whole screen behind `<Skeleton lines={8}>` |
| S2 | A screen visited before in the session paints its last data at once and refreshes behind it. A "refreshed 12 s ago" stamp shows the age. No spinner over data that is already on screen | part: TanStack Query caches, but screens gate on `isLoading` and stale times are not set per query |
| S3 | A mutation shows its result within 50 ms (optimistic). The server answer reconciles. On failure the row returns to its old state and a toast names the reason and offers "Try again" | fail: approve, reject, apply and roll back in `CleaningQueue` wait for the server and refetch every list |
| S4 | Loading uses a skeleton with the shape of what will arrive: table rows with column widths, chart frame with axes, score ruler outline. No centred spinner anywhere | fail: `Skeleton` draws generic lines |
| S5 | Grid scroll holds 60 frames a second at 100,000 rows; next page is fetched before the user reaches it | part: `DataTable` is virtualised; prefetch of the next page is not wired |
| S6 | Hover on a link that opens a record or rule prefetches it, so the panel opens with data | fail |
| S7 | Typing in a filter or search answers within 150 ms from the rows already loaded, then from the server | part |

## 2. Drill-down

| Id | Pass test | Today |
| --- | --- | --- |
| D1 | Every number on screen is a control. A click opens the records behind it, in place, with the filter that produced the number shown as chips | fail: tiles, severity strip, dimension bars and the hero sentence are static |
| D2 | The drill opens on the same screen (the grid below filters, or a panel opens beside). It never loads a different route for a count under 100,000 | fail: object detail links to `/o/.../fixes`, which links to `/work` |
| D3 | The count in the drill equals the number clicked. When the run kept only the first 100,000 keys (`truncated`), the grid says so in words | part: Work shows the truncated note |
| D4 | The drill is a URL. Copy it, send it, and the other person sees the same filter, sort and selected record | part: Work keeps `module` and `check` in the query string; other screens do not |
| D5 | Back returns to the exact scroll position and selection | fail |

## 3. Grid power

| Id | Pass test | Today |
| --- | --- | --- |
| G1 | Sort on any column, multi-sort with Shift+click | part: single sort |
| G2 | Filter on any column from its header: value list with counts for coded fields, range for numbers and dates, contains for text. Active filters show as removable chips above the grid | fail: no column filters |
| G3 | Group by any coded column with a count and a sum per group; groups collapse; a second level pivots (for example rule by plant) | fail |
| G4 | Bulk select: checkbox, Shift+click range, "select all 3,640 that match". The bulk bar states the count and the actions | pass: `DataTable` `multi` and `bulkActions` |
| G5 | Inline edit: Enter or double click opens the cell; coded fields offer the allowed values with their descriptions; Tab moves to the next editable cell; Esc cancels. The edit is a draft decision, never a silent write | fail |
| G6 | Saved views hold columns, order, widths, sort, filters, grouping and density. They are stored on the server, can be shared with the team, and one can be the default | part: server views exist for Work only (`GET/PUT/DELETE /views`); every other table saves to `localStorage` |
| G7 | Columns hide, reorder, resize and pin. Density toggles between 32 px and 28 px rows | part: no pin |
| G8 | Copy a cell or a selection as tab-separated text. Export the current view (filters applied) to xlsx and csv | part: export exists, copy does not |
| G9 | Every code shows its description beside it in the cell: rule id and name, field and business term, value and meaning, plant and plant name | part: rule and field do; values and plants do not everywhere |

## 4. Charts

| Id | Pass test | Today |
| --- | --- | --- |
| C1 | Hover shows the exact value, the unit, the run it belongs to and the change from the previous point. The cursor is shared by every chart on the screen that has the same axis | fail: `RunLines`, `ToneBars`, `WeeklyChart` are static SVG |
| C2 | Drag across a time chart to zoom. The range shows as a chip with a reset. Every chart and the grid follow the range | fail |
| C3 | Click a bar, a segment or a legend entry to filter the screen to it. Click again to clear | fail |
| C4 | Every chart has a direct label for its latest value, a unit on the axis, and a "show as table" switch for screen readers and for copying numbers | part |
| C5 | Colour carries meaning only: severity, gate zone, or series from the chart tokens. Never decoration | pass |
| C6 | A chart with no data says what will fill it and what to do ("No second run yet. Run the checks again to see the trend") | part |

## 5. Keyboard, command menu and undo

| Id | Pass test | Today |
| --- | --- | --- |
| K1 | Cmd or Ctrl+K opens the menu. It lists every action the current screen and selection allow, with its shortcut beside it, and searches records, rules, objects and runs | part: the palette navigates and searches; it does not run row actions |
| K2 | The focused grid row takes single keys: `J` and `K` move, `X` selects, `A` accepts the proposed value, `E` edits, `N` marks not an issue, `Enter` opens the record, `Esc` closes | fail |
| K3 | `?` opens the shortcut sheet for the current screen | fail |
| K4 | Every mutation returns an `action_id` and shows an undo toast for 8 seconds; Cmd or Ctrl+Z undoes the last one. Undo restores the row, the counts and the score | part: `POST /work/decide` returns `action_id` and `POST /actions/undo` exists; group accept, set value, approve, reject, apply and roll back have no undo in the UI, and `Toast` has no action slot |
| K5 | Focus is always visible, never lost after a panel closes, and moves to the next row after an action so the user can keep going | part |
| K6 | Everything reachable by pointer is reachable by keyboard, in a sensible order | part |

## 6. Motion, spacing and number grid

| Id | Pass test | Today |
| --- | --- | --- |
| M1 | Motion tokens exist per purpose and nothing else moves: `--mx-dur-instant` 80 ms (press, hover), `--mx-dur` 140 ms (reveal, tab), `--mx-dur-panel` 220 ms (panel and sheet enter), `--mx-dur-value` 600 ms (a number or the score marker moving to a new value). Curves: `--mx-ease` (enter), `--mx-ease-exit`, `--mx-ease-value` | fail: one duration and one curve |
| M2 | Motion always explains a change of state: where a panel came from, which value changed, where the score went. Reduced motion sets every duration to 0 and values jump | pass for reduced motion |
| M3 | A value that changes flashes its cell background once (`--mx-go-soft` or `--mx-stop-soft`) for `--mx-dur-value`; it does not bounce, scale or glow | fail: no value-change treatment |
| M4 | Spacing uses the six-step scale only (4, 8, 12, 16, 24, 32). Card padding 16, card gap 16, section gap 24, page gutter 24. Add `--mx-s7` 48 px for the gap between page regions | pass on scale; `--mx-s7` is new |
| M5 | Numbers: tabular figures everywhere; right-aligned in grids; counts with locale grouping; percentages to one decimal, never more; scores as integers on headlines and one decimal in the receipt; money as currency code plus compact value with the full value on hover; deltas always signed with a word, not colour alone ("+4.2 points") | part: `lc` formats counts; decimals and deltas vary by screen |
| M6 | One baseline grid: 4 px. Row heights 32 or 28. Control height 32. No off-grid values in kit.css | part |
| M7 | `DESIGN.md` matches `tokens.css`. Today it states body 15 px, control 36 px and radii 8 and 14 px while the tokens are 13 px, 32 px, 6 and 8 px | fail |

## 7. Empty and error states

| Id | Pass test | Today |
| --- | --- | --- |
| E1 | Every empty state has one sentence that says why it is empty and one button that is the next step ("No records fail this rule in run 8. See the rule's history") | part: several say only "Nothing here" |
| E2 | Every error state names what failed in plain words, keeps the rest of the screen working, and offers "Try again" plus one other way forward (open the run log, ask Aletheia) | part: `ErrorState` offers retry only and often replaces the whole screen |
| E3 | A failed mutation never loses typed input | part |
| E4 | A permission gap is said as one, with who can do it ("You can propose. Thabo Mokoena approves") | part |

## 8. AI in the cell

| Id | Pass test | Today |
| --- | --- | --- |
| A1 | A proposed value sits in the grid cell beside the current value: current struck through in ink-3, proposed in violet-ink with the Aletheia mark. No panel has to open to see it | fail: the proposal shows only in `RecordDetail`; the cleaning queue shows neither value |
| A2 | Each proposal carries its evidence one hover or one key away: the source (`rule`, `value_map`, `cleaning`), the confidence, the reason, and the SAP safety verdict for the value | part: `suggestion.source`, `confidence` and `why` exist in the API; the fixture leaves confidence and why null; the safety verdict lives in a separate tab |
| A3 | One click or `A` applies it as a draft decision. The row updates at once and the undo toast appears | part: accept exists in the panel, waits for the server |
| A4 | Bulk apply states exactly what it will do before it does it: "Set base unit of measure to EA (each) on 2,184 records. 1,456 have no proposal and stay open." It runs as one action with one `action_id`, one undo, and one audit entry that names the person, the rule, the count and the confidence floor | part: `POST /work/groups/{check}/accept-all` exists; no preview sentence, no undo toast, audit entry not linked from the result |
| A5 | A proposal the SAP dictionary would reject is never offered as one click. It shows the reason and asks for another value | part: the safety report exists (`GET /cleaning/queue/safety`), not joined to the row |
| A6 | Rejecting a proposal asks why in one line and the reason trains Aletheia (`POST /ai/feedback`) | pass in the queue; not in the grid |
| A7 | Violet is used only for Aletheia. A proposal that a rule produced deterministically is still shown in violet only if Aletheia made it; rule-derived values use the cobalt accent and say "from rule" | fail: no distinction today |

## 9. Beyond the market: one unbroken path

This is the line no benchmark product passes. Meridian must.

| Id | Pass test | Today |
| --- | --- | --- |
| B1 | From a failing rule on object detail, the user reaches the failing records, sees each proposed value with evidence, applies it, watches the score move, and downloads the SAP load file, without a route change and without losing the score from view | fail: three routes (`/o/.../`, `/o/.../fixes`, `/work`) and a nine-tab queue |
| B2 | The score ruler stays pinned at the top of the fix flow. It shows three markers: the measured score of the last run, the projected score with the decisions in the draft, and, after the next run, the actual score. The gap between projected and actual is explained in words | part: `DqsPair` shows source, projected and actual on the object screen only; `POST /simulations` computes a projection but takes a queued job |
| B3 | Each accepted fix moves the projected marker within 300 ms and the count of records left on the rule drops. The marker moves with `--mx-dur-value`; the gate it crosses is announced ("Clears the 70 gate") | fail: the screen does not call the existing `POST /api/v1/simulate/fix` as decisions are drafted |
| B4 | A critical rule that caps the score shows what clearing it releases ("Clearing MM003 lifts the cap from 70 to 85 and releases 1.8 points") beside its row, and that sentence updates as records are fixed | part: the release line exists on the object screen, static |
| B5 | The load file is one button on the same screen. It states its format (LSMW, BAPI, IDoc, SuccessFactors CSV, csv, xlsx), the record count, who approved, and what is held back and why | part: export formats exist in `cleaning.ts`; the action is a tab in the queue |
| B6 | Four-eyes approval happens in place: the approver sees the same grid filtered to the batch, with the same evidence, and approves the batch or sends rows back | part: `postApproveBatch`, `postSendBack` exist; shown on a different screen |
| B7 | After the next run, the screen shows projected against actual per rule, and lists the records that still fail with the reason | part: `WorkIssue.decision.still_failing` exists per issue; no per-rule roll-up |
| B8 | Every step is audited and the audit entry is one click from the thing it describes | part |

## Scoring a screen

Count the lines that apply to the screen. A screen ships when it passes every line in sections 1, 2, 5 and 7
that applies, and at least 80 percent of the rest. The two key screens (object detail and the fix flow) must
pass every line in section 9.

Today, by my reading of the code, object detail passes 7 of 41 applicable lines and the fix flow passes 9 of
52. I have not run the app to confirm each line; the counts come from reading the components.
