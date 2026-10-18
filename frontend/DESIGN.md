# Meridian design system: "Calm enterprise"

Source of truth for the visual layer. Values live in `frontend/design/tokens.css`, the only file that may hold colour, shadow, blur or motion literals. Spec: `docs/superpowers/specs/2026-10-12-ui-polish-design.md`. When this file and the code disagree, the code is right and this file needs updating.

## 1. Direction

Meridian is calm enterprise software for SAP data quality: a steward reads down a table, an executive reads one number and one sentence. The canvas is a cool off-white (`#F7F8FA`) and light is the default; dark is a full alternative under `[data-theme="dark"]` in neutral graphite. Content sits on white cards with a 1px hairline border and an 8px radius. There are no gradients, no glow, no dark hero blocks and no shadows outside popovers and dialogs. One deep blue accent (`#1F4FD8`) marks interaction only (the primary button, links, selection, focus). Colour otherwise means defect status: red, amber and green, plus an info blue for neutral notices. The score is a plain large number with one horizontal bar under it, on the same white card as everything else. The benchmark is Linear, Stripe and Vercel for calm and craft; Ataccama, Collibra and Informatica for data quality.

Rules, all enforced by lint or review:

1. **Restrained decoration.** No glass, backdrop blur, gradients, illustrations, mascots, or icons that do not stand for a state. No tile without a drill-down.
2. **One accent.** `--m-accent` (deep blue) is selection, focus, links and the primary button, nothing else. There is no second signal colour: the old amber "ember" and the `--m-grad-hero*`/`--m-elev-hero` tokens are retired, and `lint:tokens` rejects any `var(--m-ember…)`, `var(--m-grad-…)` or `var(--m-elev-hero)` outside `tokens.css`. Hero zones (`.m-hero`, `.m-brand-panel`) are white sheets: the `--m-hero-*` names remain only as aliases of the ordinary sheet, ink, line and status tokens, so the hero follows the theme like every other card.
3. **Hue means defect state.** `--m-critical` (red), `--m-high` (deep amber), `--m-medium` (amber), `--m-low` (slate), `--m-pass` (green) and the verdicts `--m-no-go` (red), `--m-at-risk` (amber), `--m-go` (green) carry severity only, never selection or decoration. `--m-info` is the blue of neutral notices and info pills. Severity is colour plus shape (critical square, high triangle, medium circle, low ring, pass check), never colour alone. Object domain (`--m-dom-*`, via `domainOf(moduleId)`) and chart series (`--m-viz-*`, ramps `--m-seq-*`, `--m-div-*`) are separate, muted families that sit quietly on white and never stand for severity.
4. **Type.** IBM Plex Sans (regular width) for UI and numerals (400, 500, 600), JetBrains Mono for SAP identifiers only (check IDs, `TABLE.FIELD`, record keys, run IDs, sample values). Both load through `next/font` (`app/layout.tsx`). Body text is 14px. Numbers are tabular (`font-variant-numeric: tabular-nums` on `body`). Sentence case everywhere, no all-caps eyebrows. No serif face exists.
5. **Three elevations.** Flat (hairline), raised (menus, popovers), floating (drawer, dialog, palette).
6. **Motion is 120, 240 or 480 ms**, ease-out, and zero under `prefers-reduced-motion`. Entrance motion is for the first mount of a page frame, not for content that arrives after data.
7. **Show the cap.** When a critical finding caps the DQS at 85 or 70, the score shows the measured value, the cap and the rules that caused it.
8. **Every number opens the rows behind it** (`DrillLink`, `Stat href`).
9. **URL is state.** Filters, tabs, selected run and open drawer live in the query string.
10. **Light and dark are equals.** Every token has both values, including the domain, viz and ramp tokens; `check:contrast` covers each pair in light, dark and system dark. Every review screenshot is taken in both.
11. **Speed is a feature.** Skeletons in the final geometry (no layout shift, never a spinner except the inline `Button pending` dot), virtualised tables above 200 rows, prefetch on hover and focus, optimistic updates for reversible local mutations. Colour adds no layout: edges and bars are inset shadows, and count-up and draw-in reserve their final width and height. Reduced motion zeroes all of it.

## 2. Tokens

Light values on `:root`, dark under `[data-theme="dark"]` and under `prefers-color-scheme: dark` when no theme is set.

| Token | Light | Dark |
|---|---|---|
| `--m-canvas` | `#F7F8FA` | `#111418` |
| `--m-sheet` | `#FFFFFF` | `#181C21` |
| `--m-sheet-raised` | `#F1F3F6` | `#20252C` |
| `--m-rail` | `#FFFFFF` | `#14171B` |
| `--m-ink`, `-2`, `-3` | `#161A21`, `#474F5C`, `#5A6371` | `#E7E9EC`, `#B5BBC4`, `#99A1AD` |
| `--m-line`, `--m-line-strong` | `#E3E6EB`, `#C5CBD3` | `#2A3038`, `#3D444F` |
| `--m-accent`, `-soft`, `-ink` | `#1F4FD8`, `#EBF0FC`, `#1A44BC` | `#7398F5`, `#1C2741`, `#A4BCF8` |
| `--m-critical`, `--m-high`, `--m-medium`, `--m-low`, `--m-pass` | `#C02630`, `#B34A0B`, `#8A6100`, `#5A6371`, `#1A7A47` | `#F0737C`, `#EE965A`, `#E2BE5C`, `#A3ABB7`, `#5CC78C` |
| `--m-info` | `#2659C9` | `#7FA2F3` |

Verdicts alias the scale: `--m-go` is pass, `--m-at-risk` is medium, `--m-no-go` is critical. `--m-hero-*` alias sheet, ink, line and the status hues. Other groups: DQS bands and caps, chart series `--m-viz-*`, space (4px grid), radii (`--m-radius-control` 6px, `-sheet` 8px, `-tile` 0, `-pill`), tracking (`--m-tracking-tight` on hero and stat numerals, `--m-tracking-title`), elevation (`m-elev-1..3`, `--m-elev-focus`), motion (`--m-motion-*`), layout (`--m-page-pad`, `--m-page-max`, `--m-rail-w`, `--m-topbar-h`, `--m-row-h`, `--m-control-h`).

Type scale (px, size/line): label 11/14, meta 12/16, body 14/20, heading 15/22, page title 22/28, stat 26/32, hero score 64/64 (88/88 in presentation mode). The root font size is 14px. Use the `m-text-*` utility classes, never `text-[Npx]` literals in pages.

Density: the user's preference (`/me/preferences`) lands on `<html data-density>` as `compact`, `default` or `comfortable`, and `tokens.css` retunes `--m-row-h` (34 / 40 / 48), `--m-row-h-dense`, `--m-control-h` (30 / 34 / 38), `--m-card-pad*` (16 / 24 / 28 by default), `--m-hero-pad`, `--m-stat-pad`, `--m-stat-h`, `--m-stat-hero-h`, `--m-section-gap` and `--m-page-pad` per tier. Cards, stat tiles, the hero and the insight page gap read those tokens, so no component carries a density branch. Presentation mode (`[data-present="1"]`) steps the type scale, the hero and the page padding up one size the same way.

Contrast: `npm run check:contrast` fails unless ink on every surface, accent on sheet and canvas, every defect and info hue on sheet, canvas and its soft tint, every domain hue, and the ramp inks are at least 4.5:1, in light, explicit dark and system dark.

## 3. Components

All in `@/design`; there is no second library. Pages compose these and draw nothing of their own.

- **PageHeader**: `<h1>` title 22/28 semibold, one-line meta, optional status `Pill`, actions (one primary `Button` at most), tabs. Every page uses it.
- **Button**: primary, secondary, ghost, danger (confirm dialogs only). `pending` shows the inline dot and disables the button. Use `render={<Link>}` for navigation, never a button inside an anchor.
- **Field** with a control, **Select**, **Combobox**, **Checkbox**, **Menu**: 34px controls (`--m-control-h`), 6px radius, labels 12/16 medium, helper and error text under the control, never inside the label.
- **Card**: white sheet, 1px `--m-line` border on every side, `--m-radius-sheet` (8px), `--m-card-pad` (24px), optional title 15/22, meta and actions. Replaces every hand-rolled `rounded border` box.
- **Notice**: tinted note with a 3px tone bar (info, warning, danger, success). Replaces raw alert boxes.
- **Status**: the one status vocabulary (see "Status vocabulary" below). `<Status kind="verdict" value={api.verdict} />` renders the pill with the canonical label and tone; callers pass the API value and never write the label.
- **Pill, Badge, SeverityDot**: `Pill` is a free label (a tag, a role, "Baseline", a count sentence) in `neutral`, `info` or a verdict tone; when the text is a verdict, a severity or a lifecycle stage it is a `Status` instead. `Badge` is a count only (`tone="critical"` for counts of failing items). Pills are sentence case with no full stop.
- **Stat**: label, value (`min-width: 4ch`, tabular), delta, optional `href` or `onClick`, `loading` skeleton at the same height. `hero` and `bar` exist for `Score size="hero"`, which is how pages draw the 64px score with its one 8px bar in the verdict or DQS band hue.
- **Score hero** (`.m-hero`: Home's verdict row, the Insights and Executive summary `InsightHeader hero`): a white card holding the plain large score, its one bar, the verdict sentence and at most four stat-size tiles. No dark band, no glow, no gradient.
- **Score**: the one way to draw a score, at one of three sizes. `hero`: the large number and one bar (the Home verdict row, the Insights and Executive summary hero, the scoring what-if). `md` (default): the 48px ring with the logo geometry (270 degree arc open at the top) that carries the number, for a detail header or a stat tile; `explain` makes the ring open the breakdown (formula, inputs, cap reason, costliest rules), and `DqsScore` (`components/insight/dqs-score.tsx`) feeds it a run's DQS. `sm`: a 16px ring and the number, for a table cell. `cap` keeps the cap visible at every size: the ring fills only to the cap with a tick and a dashed ghost of the measured value and says "Capped at"; the hero says it under the bar. A block draws a score once: no ring beside a stat of the same number, no hero beside a ring. A KPI row may carry a score as a plain `Stat` number when it is compared with another one (before and after, baseline and latest).
- **DataTable**: fixed 40px (48 comfortable, 32 dense) rows, virtualised above 200, arrow-key row navigation, Enter opens, Space selects, Escape clears. Filters are removable chips. One empty row when a filter removes everything.
- **Async**: loading, empty and error for one region. `<Async query={q} skeleton="table" isEmpty={(d) => !d.items.length} empty={{ title, action }}>{(d) => ...}</Async>`. The state set is `AsyncState`: `loading`, `empty`, `error`, `ready`; `asyncStateOf(q, isEmpty, notFoundIsEmpty)` derives it from a query (a 404 from a list endpoint reads as empty with `notFoundIsEmpty`). A failed query reads through `apiErrorState` with Retry refetching it; a skeleton that never resolves becomes "This is taking longer than expected." with Retry. `skeleton` is a shape (`table`, `chart`, `stats`, `list`), a height in px, or a node in the final geometry; without `empty` copy an empty region renders its children (a card that prints its own one-line empty). Every template speaks the same set: `HomePage`, `ExplorerPage`, `ReportPage` and the insight frame take `state: AsyncState` and run their body through `Async`.
- **EmptyState** (title under 8 words, one detail sentence, one required action; `ghost` is one of `table`, `chart`, `grid`, `list`, `ring`, `stepper`), **ErrorState** (message plus Retry), **Skeleton** in final geometry: the parts `Async` composes, used directly only where a region is not one query. No raw `<p>` for loading, empty or error.
- **ConfirmDialog**: every confirmation. `tone="danger"` for deletes, `typeToConfirm` makes the user type the name first, buttons name the action and its inverse ("Delete team" / "Keep"). `window.confirm` is not used anywhere in `app/`.
- **Toasts** (`toast` from `@/design`, wraps sonner): `toast.undoable(message, { undo, timeoutMs })` adds an Undo action and only exists for actions whose API has a real inverse. No inverse endpoint, no undo.
- **Error surfaces**: `app/(app)/error.tsx` (inside the shell, reference id, Try again, Go home, Copy details), `app/global-error.tsx` (no shell, no Tailwind: `design/global-error.css` over the tokens), `app/(app)/not-found.tsx` and `app/not-found.tsx`. Every error is reported once per session to `POST /api/v1/client-errors` through `lib/client-errors.ts`; nothing goes to a third party.
- **Charts** (`design/charts`): horizontal grid only, no axis lines, series `--m-viz-1..8`, custom tooltip, each chart has a sentence under its title saying what it answers.

### Status vocabulary

Three fixed sets. Each value has one label and one tone; `Status` normalises the API's spellings (`at_risk`, `fail`, `red`, `blocked`, `agents_complete`, `warning` ...) with `toVerdict`, `toSeverity` and `toLifecycle`, and a value outside its set renders neutral with its own humanised text.

| Kind | Value | Label | Tone | Reads in place of |
|---|---|---|---|---|
| verdict | `go` | Go | `--m-go` (green), dot | Pass, Ready, Passing, Unaffected, Compliant |
| verdict | `at-risk` | At risk | `--m-at-risk` (amber), dot | Warn, Degraded, Failing, Some fields failing |
| verdict | `no-go` | No-go | `--m-no-go` (red), dot | Fail, Blocked, Blocking, Not ready |
| severity | `critical` | Critical | `--m-critical`, square | |
| severity | `high` | High | `--m-high`, triangle | |
| severity | `medium` | Medium | `--m-medium`, circle | Warning |
| severity | `low` | Low | `--m-low`, ring | Info |
| lifecycle | `queued` | Queued | neutral | Pending, Waiting |
| lifecycle | `running` | Running | `--m-info` | Processing, Extracting, Mining |
| lifecycle | `done` | Done | `--m-go`, dot | Complete, Completed, Agents complete |
| lifecycle | `failed` | Failed | `--m-no-go`, dot | Agents failed, Error |

`variant="solid"` is for the row's primary verdict or severity (one column per table). Other components speak the same values: `Stat tone` and `InsightHeader` cells take a verdict, `Card tone="critical"` and `Badge tone="critical"` take the severity value. `Notice` is a message, not a state, and keeps its message severities: `info` (neutral note), `success` (draws in the go hue), `warning` (the at-risk hue), `danger` (the no-go hue). "Capped" is not a status: the `Score` shows the cap.

Copy: no full stops in table cells, pills, tile labels or hints; no "Showing X." sentences; numbers through `toLocaleString`; currency with the tenant currency code.

## 4. Brand

- **Mark**: a 270 degree arc, open at the top, crossed by a vertical meridian line, on a 32 grid, stroke 3, round caps. The arc is ink, the line is the accent. In the app it is the inline SVG `MeridianMark` (`components/meridian/icons.tsx`).
- **Wordmark**: the word "Meridian" type-set in IBM Plex Sans 600, letter-spacing -0.01em, ink colour. Never hand-drawn, never accented. The lockup is the mark plus the wordmark with a 10px gap at a 32px mark.
- **Assets** in `public/brand/` (see its README): marks, outlined lockups, `apple-icon.svg` (the older cover-gradient design; the live icon is `app/apple-icon.tsx`, not yet redrawn for the calm palette), PWA icons from `npm run brand:rasterise`. Colours are in `brand.json`.
- **Favicon**: `app/icon.svg` (stroke 3.5, follows the OS colour scheme) with `app/icon.png` fallback. **Open Graph image**: `app/opengraph-image.tsx`, lockup plus "SAP data quality, measured".
- **Signed-out pages** (`components/auth/auth-frame.tsx`): a white brand panel (`.m-brand-panel`: lockup, the decorative score-ring instrument in the accent, two facts) beside one 400px card on the canvas with an `<h1>`, the form and the version string beneath.
- **Rail** (`design/shell/Rail.tsx`): a light sheet with a hairline right edge. Each item shows its icon and text label, expanded by default (collapsed to icons below 1024px or when the user collapses it with the button or `[`). The active item is a soft blue tint with blue ink.

## Routes
Live pages are under `app/(app)/`: `home` (redirects each role to its persona home: lead, steward, basis, process), `systems`, `objects` (tabs: overview, rules, fields, records, history), `runs`, `rules`, `insights`, `mdm` (glossary, golden, match-rules, survivorship), `migration`, `inbox`, `fix`, `import`, `search`, `admin` (users, roles, audit, settings, mappings, reference, notifications, jobs, ai, licence, billing, triage), and `design` (the component gallery).

Insights is five views on one spine. The rail lists the views; every insight page carries the tab strip of its view (`InsightTabs`) under the page header, the same action bar (`InsightActions`: Run analysis, Auto clean, Report library, Present, Export with the failing-records list), and the four-sentence `InsightHeader`.

| View | Question | Tabs |
|---|---|---|
| Summary | How are we, since when, what next | `/insights/exec`, `/insights`, `/insights/reports` |
| Progress | Did it get better, and why | `/insights/progress` (since baseline), `/insights/trends`, `/insights/forecast` |
| Explore | Where exactly is it, from every angle | `/insights/rules` (pivot by rule, object, field, dimension, severity, S/4; saved views), `/insights/impact`, `/insights/lineage`, `/insights/mining`, `/insights/duplicates` |
| Readiness | Can we load, can we run the process | `/insights/readiness`, `/insights/process`, `/migration` |
| Operate | Who does what today | `/insights/owners`, `/insights/operations`, `/runs`, `/fix`, `/rules/contracts` |

`?present=1` on any page drops the shell for a boardroom screen; Escape or the Exit button returns. Nav items carry `aliases` so the rail stays on a view while one of its tabs is open; `OFF_NAV_TITLES` keeps each tab's full page title.

`e2e/routes.json` lists every route, with a seeded id for each dynamic segment, and every e2e spec that walks routes reads that file. Every legacy URL (`/workbench`, `/command-centre`, `/analyse/...`, `/settings/...`, and so on) 301s into this tree via `next.config.ts`'s `redirects()`, asserted exactly by `frontend/__tests__/legacy-redirects.test.ts`.

## Depth
Meridian is read top-down. Every level answers one question and opens the level below in one click.

| Level | Question | Surface |
|---|---|---|
| Portfolio | How healthy is our SAP data, and what do I do next? | Home |
| Object | What is wrong with this object, and what does it break? | Object explorer |
| Check | Which rule fails, on how many records, and why does it matter? | Finding drawer |
| Record | Which rows, and who fixes them? | Sample table, steward inbox |

## Guardrails

- `npm run lint:tokens` rejects raw hex, gradients, backdrop blur, ad hoc shadows, motion and duration literals and all-caps text outside `design/tokens.css`. `scripts/lint-tokens.allow.txt` holds no entries. Never add a line to it. It also rejects the retired ember, hero-gradient and hero-elevation tokens anywhere outside `tokens.css`.
- `npm run lint` runs `eslint . --max-warnings 0`.
- **No inline style in `app/`.** `aurora-structure/no-inline-style` rejects every `style` prop under `app/**`; `design/` owns style. Pages use, in this order: a design component or prop (`Score`, `Status`, `Card`, `Stat`), the token utilities at the end of `tokens.css` (`.m-ink`, `.m-ink-2`, `.m-ink-3`, `.m-ink-accent`, `.m-ink-accent-ink`, `.m-ink-critical`, the `m-text-*` type pairs including `.m-text-verdict-line` and `.m-text-hero`), then a Tailwind class over a token (`[border-color:var(--m-line)]`, `aria-pressed:[color:var(--m-accent)]` for state). Utility classes sit in Tailwind's utilities layer, below the unlayered `tokens.css` classes, so on an element that carries one of those a utility takes the `!` suffix. A computed value goes through a design component that owns the style: `ProgressFill` for a progress width, `.m-domain-stripe[data-domain]` for a domain rule. There are no escapes left in `app/`: the Open Graph and Apple icon routes render `design/brand/images.tsx` (Satori reads inline style only, so that JSX lives in the library), and `app/global-error.tsx`, which has no Tailwind, styles through `design/global-error.css`.
- `npm run check:contrast` gates the colour pairs above.
- Reduced motion turns off every animation. Focus rings always show (`--m-elev-focus`).
- `e2e/visual.spec.ts` walks every route in `routes.json` in light, dark, reduced motion and a fresh-install empty pass. Each pass saves a full-page screenshot to `test-results` (no baselines are committed) and fails on any axe WCAG 2.1 A/AA violation. The reduced-motion pass also fails if any element, `::before` or `::after` has a computed `animation-name` other than `none`. Fix a failure in the library or the tokens, never with a per-page override or an axe rule exclusion.
- Every number is a `DrillLink`; one `h1` per route (rendered by `Breadcrumb`); dates go through the shared formatter; no raw ids as copy.

## Known exception
The process designer's BPMN canvas (`app/(app)/insights/process/designer/_components/`) is styled by its own scoped `designer.css`, whose values are `var(--m-*)` tokens from `design/tokens.css`. The old `app/styles/aurora-components.css` stylesheet and its `globals.css` import are gone.
