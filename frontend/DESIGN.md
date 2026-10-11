# Meridian design system: "The Instrument"

Source of truth for the visual layer. Values live in `frontend/design/tokens.css` (the only file that may hold colour, shadow, gradient, blur or motion literals) and are typed in `design/tokens.ts`. Full spec: `docs/superpowers/specs/premium-redesign/spec.md`. When this file and the code disagree, the code is right and this file needs updating.

## 1. Direction
**Concept.** Meridian is a precision instrument for SAP data: it measures, it shows the reading, and it tells you what the reading means. The interface should feel like a well-made measuring device — a surveyor's theodolite, a lab balance, a flight instrument — not a dashboard template. Warm paper neutrals instead of the cool slate every competitor uses; one deep cobalt accent that behaves like the needle on a dial (it points at the thing that matters and nothing else); very large tabular numerals for readings; a serif display face reserved for the one sentence per page that states the verdict; monospace for every SAP identifier. Depth comes from a single thin "meridian" hairline that runs along the top of the shell and through the brand panel, from a soft glass top bar, and from exactly three elevation levels. The current app loses because everything is the same weight; this redesign wins by making one thing per screen loud and everything else quiet.

**Principles** (these replace rules 1–16 in the old `DESIGN.md`; the old ones that survive are folded in).

1. **One reading per screen.** Every page has one hero: a verdict sentence, a score gauge, a count-up number, or a graph. Nothing else on the page may exceed 15px type or carry the accent colour as a fill.
2. **Hue means defect state, cobalt means "you can act here".** Red, orange, amber, green are only ever severity or verdict. Cobalt (`--m-accent`) is only ever selection, focus, links, the primary button and the meridian hairline. No decorative colour.
3. **Severity is colour plus shape.** critical = square, high = triangle, medium = circle, low = ring (no hue), pass = check. Never colour alone.
4. **Show the cap.** When a Critical finding caps DQS at 85 or 70, the gauge shows both the measured value and the cap.
5. **Numbers are tabular, large, and open rows.** Every number on a page is a `DrillLink` to the rows behind it.
6. **Serif is for verdicts only.** `--m-font-display` appears in exactly four places: the home verdict sentence, the auth page headline, the report cover title, the OG image. Nowhere else.
7. **Mono is for SAP.** Check IDs, `TABLE.FIELD`, record keys, run IDs, sample values. Nothing else.
8. **Warm neutrals, cool accent.** The canvas is warm paper, the ink is warm graphite. The accent is cold cobalt. That contrast is the brand.
9. **Three elevations.** Flat (hairline border), raised (menus, popovers), floating (drawer, dialog, palette). Nothing in between.
10. **Glass is for chrome, never for content.** The top bar and the command palette backdrop may use `--m-glass-*`. Cards, tables and charts never do.
11. **Gradients are tokens, not decoration.** Exactly four gradient tokens exist (§2). A gradient that is not one of those four does not ship.
12. **Motion is 120 / 240 / 480 / 1400 ms, ease-out, and zero under `prefers-reduced-motion`.** Motion communicates one of: arrival (rise), change (count-up, draw), or waiting (sweep).
13. **Empty states are the product on day one.** Every empty state shows the ghost of what will fill in, one sentence saying what it will be, and the one action that gets there. No illustrations, no mascots.
14. **Sentence case everywhere. No all-caps eyebrows.** Hierarchy comes from size, weight and ink level.
15. **URL is state.** Filters, tabs, selected run, open drawer all live in the query string.
16. **Light and dark are equals.** Every token has both values; every screenshot in review is taken in both.

## 2. Tokens

Everything is a CSS variable in `design/tokens.css`, with a light value on `:root` and a dark value under `[data-theme="dark"]` (and `prefers-color-scheme: dark` when no theme is set). Existing `--m-*` names are never renamed; legacy aliases (`--m-ink-muted`, `--m-sheet-2`, `--m-warning`, `--m-fail`, `--m-motion-duration-*`, `--m-text-root`) are kept at the foot of the token block for old call sites and are not for new code.

| Group | Tokens |
|---|---|
| Surfaces | `--m-canvas`, `--m-sheet`, `--m-sheet-raised`, `--m-sheet-sunken`, `--m-rail`, `--m-line`, `--m-line-strong`, `--m-scrim` |
| Ink | `--m-ink`, `--m-ink-2`, `--m-ink-3` (minimum for body text), `--m-ink-4` (decorative, never text), `--m-ink-on-accent` |
| Accent (cobalt) | `--m-accent`, `-hover`, `-active`, `-soft`, `-soft-2`, `-ink`, `-ring` |
| Status | `--m-critical`, `--m-high`, `--m-medium`, `--m-pass`, each with `-soft` and `-ink`; `--m-low`, `--m-info`; verdicts `--m-go`, `--m-at-risk`, `--m-no-go` reuse the scale |
| DQS | `--m-dqs-target/warning/critical` (90/75/60), `--m-dqs-cap-one/two` (85/70), `--m-dqs-track`, `--m-dqs-cap-line` |
| Charts | `--m-viz-1..8`, `--m-viz-grid/axis/threshold/area`, `--m-viz-tooltip-bg/ink` |
| Type | `--m-font-sans/display/mono`, `--m-text-*` and `--m-leading-*` (hero, verdict, title, stat, section, body, meta, micro), `--m-tracking-*` |
| Space and shape | `--m-space-*` (4px grid), `--m-radius-control/sheet/tile/pill`, `--m-rail-w`, `--m-topbar-h`, `--m-row-h`, `--m-control-h` |
| Elevation | `--m-elev-0..3`, `--m-elev-focus`, `--m-elev-accent` (classes `m-elev-1..3`) |
| Gradients | Exactly four: `--m-grad-meridian`, `--m-grad-brand`, `--m-grad-brand-glow`, `--m-grad-fade-bottom` |
| Glass | `--m-glass-bg/blur/line` (class `m-glass`, chrome only) |
| Motion | `--m-motion-duration` 120ms, `-slow` 240ms, `-draw` 480ms, `-shimmer` 1400ms, `--m-motion-ease`; classes `m-motion-*`, `m-skeleton-sweep`, `m-meridian-live`; all zero under `prefers-reduced-motion` |

Contrast: `npm run check:contrast` (`scripts/check-contrast.mjs`) parses `tokens.css` and fails unless every ink/surface pair and every status colour on `--m-sheet` and on its own `-soft` tint is at least 4.5:1, in both themes.

The shadcn semantic vars in `app/globals.css` (`--background`, `--card`, `--border`, `--ring`, ...) are a one-time bridge onto these tokens. Components use `@/design` primitives or `--m-*` directly.

## 3. Typography
| Role | Family | Weights | `next/font` export | CSS var |
|

## 7. Primitives
All in `design/primitives/`. Export names unchanged. Styles come from classes defined in `globals.css` `@layer components` (which may only reference tokens) or inline `var()` — never literals.

### 7.1 Button (`Button.tsx`)
- Sizes: `sm` 28h / 12px type, `md` 32h / 13px (default), `lg` 40h / 13px. Padding 0 12 (sm 0 10, lg 0 16). Radius control. Gap 8. Weight 500. `m-motion-colors`.
- `primary`: bg `--m-accent`, text `--m-ink-on-accent`, `--m-elev-accent`; hover `--m-accent-hover`; active `--m-accent-active`.
- `secondary`: bg `--m-sheet`, border `--m-line-strong`, text `--m-ink`; hover bg `--m-sheet-raised`, border `--m-ink-3`.
- `ghost`: transparent, text `--m-ink-2`; hover bg `--m-sheet-raised`, text `--m-ink`.
- New variant `danger`: bg `--m-critical`, text white; only inside confirm dialogs.
- Disabled: opacity .5. Loading prop `pending`: spinner replaces leading icon. `render` prop unchanged.

### 7.2 IconButton
28×28 (`sm`) / 32×32 default, radius control, ghost styling, icon 16 `--m-ink-2`; hover `--m-ink`.

### 7.3 Field / Select / Combobox / inputs
- Control height 32 (`--m-control-h`), radius control, bg `--m-sheet`, border `--m-line-strong`, padding 0 10, 13/18, placeholder `--m-ink-3`. Hover border `--m-ink-3`. Focus: border `--m-accent` + `--m-elev-focus`. Invalid: border `--m-critical`.
- `Field` label 12/16 500 `--m-ink-2`, gap 6; error 12/16 `--m-critical` with critical square 8px.
- `Select` popup: `m-elev-2`, bg `--m-sheet`, radius sheet, padding 4; items 32h radius control; selected bg `--m-accent-soft` text `--m-accent-ink`; check icon right.
- Checkbox (DataTable select): 16px, radius 4, border `--m-line-strong`; checked bg `--m-accent` white check.

### 7.4 Card (new export `Card`, `design/primitives/Card.tsx`)
`Card({ title?, meta?, actions?, children, padding = "md", tone? })`. bg `--m-sheet`, radius `--m-radius-sheet`, `m-elev-1`, padding 20 (md) / 12 (sm) / 24 (lg). Header row: title 15/20 600, meta 12/16 `--m-ink-3` right, actions. Templates currently open-code this box (`InstrumentPanel`, `EmptyState`, object detail) — they switch to `Card`. **Rename list: none; `Card` is an addition.**

### 7.5 Pill
Height 22, padding 0 8, radius pill, 12/16 500. Filled soft style: bg `--m-{tone}-soft`, text `--m-{tone}-ink`, no border; leading 6px dot in `--m-{tone}` for go/at-risk/no-go. `neutral`: bg `--m-sheet-raised`, text `--m-ink-2`, border 1px `--m-line`. Tones unchanged (`neutral | go | at-risk | no-go`); add `info` (accent-soft / accent-ink).

### 7.6 Badge
Height 18, min-w 18, radius pill, 11/14 600 mono, bg `--m-accent`, text `--m-ink-on-accent`. In the Rail, when the row is active, invert: bg `--m-accent-ink` text `--m-accent-soft`.

### 7.7 Tabs
List: bottom hairline `--m-line`. Tab: height 36, padding 0 2, margin-right 20, 13/18 500 `--m-ink-3`; hover `--m-ink`; selected `--m-ink` 600 with a 2px `--m-accent` underline radius 1 that slides between tabs (`transition: transform var(--m-motion-slow)` via a single indicator element). Optional count in `Badge`-style neutral.

### 7.8 Table (`design/table/DataTable.tsx`)
- Wrapper: `Card` padding 0, overflow hidden.
- Header: height 36, bg `--m-sheet-raised`, 11/14 500 `--m-ink-3`, sorted column `--m-ink` with 12px arrow; bottom border `--m-line-strong`.
- Rows: height `--m-row-h` (36), border-bottom `--m-line`, 13/18 `--m-ink`; numeric cells right-aligned `m-numeric`; identifier cells `Mono`. Hover bg `--m-sheet-raised`. Selected bg `--m-accent-soft`. Row click cursor pointer; the first text cell gets `--m-accent` on hover when `onRowClick` exists.
- Density toggle `dense` → `--m-row-h-dense`.
- `Pager`: right-aligned 12/16 `--m-ink-3` "1–50 of 2,310" plus two IconButtons (ChevronLeft/Right).
- `BulkBar`: floats at the bottom of the viewport (sticky, bottom 16), width fit, bg `--m-ink`, text `--m-sheet`, radius pill, `m-elev-3`, padding 8 16, `m-motion-rise`; actions are ghost buttons inverted.

### 7.9 Stat / KPI tile (`Stat.tsx`)
`Stat({ label, value, delta, hint?, href?, tone? })` renders a tile: bg `--m-sheet`, radius `--m-radius-tile`, `m-elev-1`, padding 16 20, min-w 160. Label 12/16 `--m-ink-3`; value 26/30 600 tracking tight `m-numeric` `--m-ink`; delta row 12/16 (`Delta` + hint). Optional `tone` paints a 3px top bar in the tone colour. When `href` set the whole tile is a `DrillLink` and hovers to `--m-elev-2`. Stats placed in a `grid auto-fit minmax(160px,1fr) gap 12`. Existing call sites passing `delta` strings keep working (delta is `ReactNode`).

### 7.10 ScoreRing / DQS gauge (`ScoreRing.tsx`)
- Geometry = the logo: 270° arc open at 12 o'clock, track `--m-dqs-track`, value arc coloured by `dqsBand`, stroke = size/10 (min 3), round caps; a 1px vertical meridian line through the centre in `--m-line-strong` at sizes ≥ 96 only.
- Sizes: 24 (table), 48 (inline), 96 (card), 160 (hero). Centre number `m-numeric` 600 at size/2.8; at ≥96 add "/100" 12/16 `--m-ink-3` under it.
- **Cap**: new prop `cap?: number`. When set, a 2px `--m-dqs-cap-line` tick at the cap angle and the measured value drawn as a dashed ghost arc beyond the cap; label under the ring "Capped at 85 — 1 critical" 12/16.
- Draw on mount with `m-motion-draw` (`--m-draw-length` = circumference). Reduced motion: static.
- Export `DEFAULT_SCORE_BANDS` unchanged.

### 7.11 Counter
Unchanged behaviour; font 56/60 600 tracking tight (`--m-text-hero`), `m-numeric`.

### 7.12 Charts (`design/charts/*`)
- `chartTheme` additions: `area: mColor.vizArea`, `tooltipBg`, `tooltipInk`, `threshold: mColor.ink2`.
- Grid: horizontal only, `--m-viz-grid`, `strokeDasharray` none. Axes: no axis line, ticks 12/16 `--m-viz-axis`, `tickLine={false}`.
- Line: stroke 2 `--m-viz-1`, area fill `--m-viz-area` beneath (`Area` under `Line`), dots hidden except `activeDot` r 4 fill `--m-viz-1` with 2px `--m-sheet` ring. Threshold line `--m-viz-threshold` dashed 4 4 with a right-aligned label "Target 90".
- Bar: radius 3 top corners, fill `--m-viz-1`; bars below threshold fill `--m-high`; hover fill `--m-accent-hover`. Gap 40%.
- Waterfall: increases `--m-pass`, decreases `--m-critical`, totals `--m-ink-2`.
- Radar: stroke `--m-viz-1`, fill `--m-viz-area`, polygon grid `--m-viz-grid`.
- Heatmap: cells radius 3, gap 2, colours `--m-{go|at-risk|no-go}-soft` with a 6px dot of the full tone centred; hover ring `--m-accent`. Row/col labels 12/16.
- Sparkline: stroke 1.5, colour by direction, last point dot r 2.
- Graph (duplicates): nodes 8px circles `--m-viz-1`, master node 12px `--m-ink`, edges `--m-line-strong` width by confidence (1–3), labels mono 11.
- Tooltip (custom, all charts): bg `--m-viz-tooltip-bg`, ink `--m-viz-tooltip-ink`, radius control, padding 8 10, 12/16, value `m-numeric`; no arrow.
- Series palette order: viz-1…8. Never more than 8 series; collapse the rest into "Other" `--m-ink-4`.

### 7.13 Dialog
Panel 480w, bg `--m-sheet`, radius `--m-radius-sheet`, `m-elev-3`, `m-motion-scale-in`, padding 24. Title: `title` 22/28 for destructive confirms, `section` 15/20 for forms. Body 13/18 `--m-ink-2`. Footer right-aligned, gap 8, secondary then primary (or `danger`). Backdrop `--m-scrim`.

### 7.14 Drawer
Width 480 (was 420), bg `--m-sheet`, `m-elev-3`, `m-motion-slide-in-right`, inset 8px from top/right/bottom with radius `--m-radius-sheet` (floating sheet, Linear-style) at ≥ `lg`; full-height flush below. Header 56h: title 15/20 600, subtitle slot 12/16 `--m-ink-3` (e.g. check ID in Mono), close IconButton. Body padding 20. Optional sticky footer for actions.

### 7.15 Skeleton
bg `--m-sheet-sunken`, radius control, sweep layer `--m-sheet-raised` → use a 40% band; animated with `m-skeleton-sweep`. Compose page skeletons inside `m-motion-stagger`.

### 7.16 EmptyState
`EmptyState({ title, detail, action, ghost })` unchanged API. Visual: `Card` max-w 560; the ghost drawn in `--m-sheet-sunken` shapes with a `m-fade-bottom` overlay; below it title 15/20 600, detail 13/18 `--m-ink-2`, action primary `md`. Add ghost kinds `"ring"` (a 96px ScoreRing track with no value and a dashed meridian) and `"stepper"`. Page-level empty states should also set the verdict slot (home) or the summary slot (explorer) to a one-sentence sentence in `--m-ink-3`.

### 7.17 ErrorState
Same card as EmptyState with a 3px `--m-critical` top bar, title "Could not reach the server.", message mono 12 `--m-ink-3`, Retry secondary button.

### 7.18 Mono
`font-family: var(--m-font-mono)`, 12/16 inside 13px text, `--m-ink`, bg `--m-sheet-sunken`, padding 1 4, radius 4 when `inline` prop; bare otherwise.

## Routes
Live pages are under `app/(app)/`: `home`, `systems`, `objects`, `runs`, `rules`, `insights` (process, lineage, mining, readiness, forecast, exec, impact, duplicates), `mdm` (glossary, golden, match-rules), `inbox`, `fix`, `import`, `search`, `admin` (users, settings, mappings, ai, licence, billing, triage), and `design` (the component gallery). Every legacy URL (`/workbench`, `/command-centre`, `/analyse/...`, `/settings/...`, and so on) 301s into this tree via `next.config.ts`'s `redirects()`, asserted exactly by `frontend/__tests__/legacy-redirects.test.ts`.

## Depth
Meridian is read top-down. Every level answers one question and opens the level below in one click.

| Level | Question | Surface |
|---|---|---|
| Portfolio | How healthy is our SAP data, and what do I do next? | Home |
| Object | What is wrong with this object, and what does it break? | Object explorer |
| Check | Which rule fails, on how many records, and why does it matter? | Finding drawer |
| Record | Which rows, and who fixes them? | Sample table, steward inbox |

## Guardrails

- `npm run lint:tokens` rejects raw hex, gradients, backdrop blur, ad hoc shadows, motion and duration literals and all-caps text outside `design/tokens.css`. `scripts/lint-tokens.allow.txt` holds no entries. Never add a line to it.
- `npm run lint` runs `eslint . --max-warnings 0`.
- `npm run check:contrast` gates the colour pairs above.
- Reduced motion turns off every animation. Focus rings always show (`--m-elev-focus`).
- Every number is a `DrillLink`; one `h1` per route (rendered by `Breadcrumb`); dates go through the shared formatter; no raw ids as copy.

## Known exception
The process designer's BPMN canvas (`app/(app)/insights/process/designer/_components/`) still renders its React Flow nodes and tree rows through `aurora-*` classNames, defined in `app/styles/aurora-components.css` and imported once from `app/globals.css`. That stylesheet is no longer an Aurora/ui-core dependency: it was pruned to only the rule blocks the designer actually uses, and every value is a `var(--m-*)` token from `design/tokens.css`. Renaming the classNames themselves to drop the `aurora-` prefix is tracked as follow-up work; the token dependency is already resolved.
