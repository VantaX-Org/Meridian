# Meridian design system: "The Instrument", styled Isora

Source of truth for the visual layer. Values live in `frontend/design/tokens.css`, the only file that may hold colour, shadow, blur or motion literals. When this file and the code disagree, the code is right and this file needs updating.

## 1. Direction

Every data product on the market is cards on a canvas. Meridian is an instrument. Its mark is a measuring arc crossed by a meridian line, and that is the layout grammar: **one datum line per page, one ruler for every number, and the explanation written in the margin.**

1. **The Datum.** A page is two columns with one vertical line, the meridian, between them: the figures, charts and tables on the left; the margin on the right. The line carries a short accent tick at its top. Below the container's reading width the margin stacks first, so the explanation is still read before the figures. `Datum` draws it; `PageFrame` and the insight frame use it.
2. **The Rule.** One primitive draws every score: a ruler from 0 to 100 with the measured value as a filled run and a needle, the target as a tick, and the cap (a critical finding holding the score down) as a second tick with the measured value ghosted beyond it. The same geometry at three sizes: `hero` (the score sheet, labelled 0, Target and 100), `row` (a table cell beside the numeral) and `inline` (a mark in a sentence). A reader learns the instrument once. The 270 degree arc (`ScoreRing`) remains for the brand and the detail header; it is never beside a Rule for the same number.
3. **The margin.** The four sentences of a page (situation, what changed, why it matters, do next) are marginalia, not a banner: `Margin` sets them in the Datum's right column, each with a tone dot and at most one action, sticky while the figures scroll. Numbers left, meaning right, always in the same place.
4. **Isora surfaces.** Light is a cool blue-grey canvas (`#F5F7F8`) with white sheets: one hairline, a 12px radius and one soft shadow (`--m-elev-card`) under every card and the score sheet, slate-navy ink (`#26394B`). Dark is the same system in blue-slate graphite with no card shadow. Both come from one token set and both are first class. No gradients, no glow, no blur.
5. **One accent.** Steel blue (`#336F96`; sky blue `#84BADA` in dark) marks interaction only: the primary button, links, selection, focus, the datum's tick. The sky-blue family (`#E7F1F7`, `#A8CEE3`, `#84BADA`) is the sequential ramp and chart series 1. Hue otherwise means defect state: red, amber and green, plus an info blue for neutral notices; severity is colour plus shape, never colour alone.
6. **Type.** Inter for words and figures (400, 500, 600), tabular numerals, 14px body on a 4px grid; JetBrains Mono for SAP identifiers only. Sentence case everywhere.
7. **Icons.** Meridian's own set (`design/icons`), one 24 grid and one 1.6 stroke; nothing from a library, nothing decorative, no sparkle anywhere.
8. **Motion is measurement.** 120, 240 or 480 ms, ease-out; a draw-in settles like a needle, a count-up eases like a gauge, nothing bounces. Zero under `prefers-reduced-motion`.
9. **Every number opens the rows behind it** (`DrillLink`, `Stat href`), **the URL is state**, and **speed is a feature**: skeletons in the final geometry, virtualised tables above 200 rows, prefetch on hover.
10. **Plain speech.** Every sentence the product writes reads like a colleague said it: "Quality is at 72, with 2,661 findings across 343,209 records." No status-speak, no "Please note", no exclamation marks.

The benchmark is Linear, Stripe and Vercel for craft, Tufte for the margin, a good instrument panel for the rest.

## 2. Tokens

Light values on `:root`, dark under `[data-theme="dark"]` and under `prefers-color-scheme: dark` when no theme is set.

| Token | Light | Dark |
|---|---|---|
| `--m-canvas` | `#F5F7F8` | `#0F161C` |
| `--m-sheet` | `#FFFFFF` | `#16202A` |
| `--m-sheet-raised` | `#EEF2F5` | `#1D2935` |
| `--m-rail` | `#FFFFFF` | `#121B23` |
| `--m-ink`, `-2`, `-3` | `#26394B`, `#3E5468`, `#4C6479` | `#E6EDF2`, `#B3C2CF`, `#97A9B8` |
| `--m-line`, `--m-line-strong` | `#E0E7EC`, `#C3CED7` | `#263442`, `#364758` |
| `--m-accent`, `-soft`, `-ink` | `#336F96`, `#E7F1F7`, `#27587A` | `#84BADA`, `#1B3140`, `#A8CEE3` |
| `--m-critical`, `--m-high`, `--m-medium`, `--m-low`, `--m-pass` | `#C02630`, `#B34A0B`, `#8A6100`, `#5A6371`, `#1A7A47` | `#F0737C`, `#EE965A`, `#E2BE5C`, `#A3ABB7`, `#5CC78C` |
| `--m-info` | `#2659C9` | `#7FA2F3` |

Verdicts alias the scale: `--m-go` is pass, `--m-at-risk` is medium, `--m-no-go` is critical. `--m-hero-*` alias sheet, ink, line and the status hues. Other groups: DQS bands and caps, chart series `--m-viz-*`, space (4px grid), radii (`--m-radius-control` 8px, `-sheet` 12px, `-tile` 0, `-pill`), tracking (`--m-tracking-tight` on hero and stat numerals, `--m-tracking-title`), elevation (`m-elev-1..3`, `--m-elev-card`, `--m-elev-focus`), motion (`--m-motion-*`), layout (`--m-page-pad`, `--m-page-max`, `--m-margin-w`, `--m-rail-w`, `--m-topbar-h`, `--m-row-h`, `--m-control-h`).

Type scale (px, size/line): label 11/14, meta 12/16, body 14/20, heading 15/22, page title 22/28, stat 26/32, hero score 64/64 (88/88 in presentation mode). The root font size is 14px. Use the `m-text-*` utility classes, never `text-[Npx]` literals in pages.

Density: the user's preference (`/me/preferences`) lands on `<html data-density>` as `compact`, `default` or `comfortable`, and `tokens.css` retunes `--m-row-h` (34 / 40 / 48), `--m-row-h-dense`, `--m-control-h` (30 / 34 / 38), `--m-card-pad*` (16 / 24 / 28 by default), `--m-hero-pad`, `--m-stat-pad`, `--m-stat-h`, `--m-stat-hero-h`, `--m-section-gap` and `--m-page-pad` per tier. Cards, stat tiles, the hero and the insight page gap read those tokens, so no component carries a density branch. Presentation mode (`[data-present="1"]`) steps the type scale, the hero and the page padding up one size the same way.

Contrast: `npm run check:contrast` fails unless ink on every surface, accent on sheet and canvas, every defect and info hue on sheet, canvas and its soft tint, every domain hue, and the ramp inks are at least 4.5:1, in light, explicit dark and system dark.

## 3. Components

All in `@/design`; there is no second library. Pages compose these and draw nothing of their own.

- **Datum**: the page composition. `<Datum margin={<Margin .../>}>{figures}</Datum>`: a two-column grid above the container's reading width (`minmax(0,1fr) var(--m-margin-w)`), the meridian line as the margin's left edge with the accent tick at its top; stacked below it, margin first. `HomePage` and `InsightFrame` compose it; a page never draws the line itself.
- **Margin**: the four sentences as marginalia (`situation`, `changed`, `why`, `next`, the same cells as `InsightHeader`), each a micro label with a tone dot and a body sentence, the last with at most one small button. With `aiSummary` the model's paragraph replaces the four; the sentences are never shown twice. Sticky inside the Datum.
- **Rule**: the one instrument for a score (`value`, `target`, `cap`, `bands`, `size`). `hero` is a full-width ruler with ticks every 10, the measured run in the band hue, the needle in ink, "0", "Target 90" and "100" beneath (the end label yields when the target or cap sits near it), the cap as a red tick with a dashed ghost of the measured value beyond it. `row` is 96 by 12 for a table cell, `inline` 56 by 8 for a sentence; `width` stretches a row across a stat tile. The whole ruler is one `role="img"` naming the value, cap and target.
- **PageHeader**: `<h1>` title 22/28 semibold, one-line meta, optional status `Pill`, actions (one primary `Button` at most), tabs. Every page uses it.
- **Button**: primary, secondary, ghost, danger (confirm dialogs only). `pending` shows the inline dot and disables the button. Use `render={<Link>}` for navigation, never a button inside an anchor.
- **Field** with a control, **Select**, **Combobox**, **Checkbox**, **Menu**: 34px controls (`--m-control-h`), 8px radius, labels 12/16 medium, helper and error text under the control, never inside the label.
- **Card**: white sheet, 1px `--m-line` border on every side, `--m-radius-sheet` (12px), the `--m-elev-card` shadow, `--m-card-pad` (24px), optional title 15/22, meta and actions. Replaces every hand-rolled `rounded border` box.
- **Notice**: tinted note with a 3px tone bar (info, warning, danger, success). Replaces raw alert boxes.
- **Status**: the one status vocabulary (see "Status vocabulary" below). `<Status kind="verdict" value={api.verdict} />` renders the pill with the canonical label and tone; callers pass the API value and never write the label.
- **Pill, Badge, SeverityDot**: `Pill` is a free label (a tag, a role, "Baseline", a count sentence) in `neutral`, `info` or a verdict tone; when the text is a verdict, a severity or a lifecycle stage it is a `Status` instead. `Badge` is a count only (`tone="critical"` for counts of failing items). Pills are sentence case with no full stop.
- **Stat**: label, value (`min-width: 4ch`, tabular), delta, optional `href` or `onClick`, `loading` skeleton at the same height. `bar` with `rule` draws the Rule under the value (hero size in a hero tile, a stretched row rule in an ordinary tile, which then grows to fit); `Score size="hero"` is built on it.
- **Score hero** (`.m-hero`: Home's verdict row, the Insights and Executive summary `InsightHeader hero`): a white card holding the plain large score with the hero Rule under it, the verdict sentence and at most four stat-size tiles (two by two beside the score). No dark band, no glow, no gradient. The four sentences are not in the hero: they are the page's Margin.
- **Score**: the one way to draw a score, at one of three sizes. `hero`: the large number and the hero Rule (the Home verdict row, the Insights and Executive summary hero, the scoring what-if). `md` (default): the 48px ring with the logo geometry (270 degree arc open at the top) that carries the number, for a detail header or a stat tile; `explain` makes the ring open the breakdown (formula, inputs, cap reason, costliest rules), and `DqsScore` (`components/insight/dqs-score.tsx`) feeds it a run's DQS. `sm`: an inline Rule and the number, for a table cell. `cap` keeps the cap visible at every size: the ring fills only to the cap with a tick and a dashed ghost of the measured value and says "Capped at"; the hero says it under the bar. A block draws a score once: no ring beside a stat of the same number, no hero beside a ring. A KPI row may carry a score as a plain `Stat` number when it is compared with another one (before and after, baseline and latest).
- **DataTable**: fixed 40px (48 comfortable, 32 dense) rows, virtualised above 200, arrow-key row navigation, Enter opens, Space selects, Escape clears. Filters are removable chips. One empty row when a filter removes everything.
- **Async**: loading, empty and error for one region. `<Async query={q} skeleton="table" isEmpty={(d) => !d.items.length} empty={{ title, action }}>{(d) => ...}</Async>`. The state set is `AsyncState`: `loading`, `empty`, `error`, `ready`; `asyncStateOf(q, isEmpty, notFoundIsEmpty)` derives it from a query (a 404 from a list endpoint reads as empty with `notFoundIsEmpty`). A failed query reads through `apiErrorState` with Retry refetching it; a skeleton that never resolves becomes "This is taking longer than expected." with Retry. `skeleton` is a shape (`table`, `chart`, `stats`, `list`), a height in px, or a node in the final geometry; without `empty` copy an empty region renders its children (a card that prints its own one-line empty). Every template speaks the same set: `HomePage`, `ExplorerPage`, `ReportPage` and the insight frame take `state: AsyncState` and run their body through `Async`.
- **EmptyState** (title under 8 words, one detail sentence, one required action; `ghost` is one of `table`, `chart`, `grid`, `list`, `ring`, `stepper`), **ErrorState** (message plus Retry), **Skeleton** in final geometry: the parts `Async` composes, used directly only where a region is not one query. No raw `<p>` for loading, empty or error.
- **ConfirmDialog**: every confirmation. `tone="danger"` for deletes, `typeToConfirm` makes the user type the name first, buttons name the action and its inverse ("Delete team" / "Keep"). `window.confirm` is not used anywhere in `app/`.
- **Toasts** (`toast` from `@/design`, wraps sonner): `toast.undoable(message, { undo, timeoutMs })` adds an Undo action and only exists for actions whose API has a real inverse. No inverse endpoint, no undo.
- **Error surfaces**: `app/(app)/error.tsx` (inside the shell, reference id, Try again, Go home, Copy details), `app/global-error.tsx` (no shell, no Tailwind: `design/global-error.css` over the tokens), `app/(app)/not-found.tsx` and `app/not-found.tsx`. Every error is reported once per session to `POST /api/v1/client-errors` through `lib/client-errors.ts`; nothing goes to a third party.
- **Icons** (`design/icons`): Meridian's own set, the only icons in the product. One 24 grid, a 1.6 stroke, round caps and joins, `currentColor`, no fill except a dot or a hub, nothing outside 2.5..21.5. Every glyph stands for a place (the nav) or an action (a control); none is decoration, and there is no sparkle, star or wand anywhere: model-written text is labelled in words ("Summary, written by the model from the findings") and reads like every other sentence. `ICONS` lists every glyph by name for the gallery sheet. Add a glyph to the set rather than importing one: eslint's `no-restricted-imports` rejects `lucide-react` and the other icon libraries.
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
- **Wordmark**: the word "Meridian" type-set in Inter 600, letter-spacing -0.01em, ink colour. Never hand-drawn, never accented. The lockup is the mark plus the wordmark with a 10px gap at a 32px mark.
- **Assets** in `public/brand/` (see its README): marks, outlined lockups, PWA icons from `npm run brand:rasterise`. Colours are in `brand.json`. `app/apple-icon.tsx` draws the two-tone mark on a plain canvas tile and `app/opengraph-image.tsx` a white sheet on the canvas with the lockup; both read `design/brand/images.tsx`, which mirrors `brand.json`. There is no cover gradient anywhere.
- **Favicon**: `app/icon.svg` (stroke 3.5, ink and accent from `brand.json`, follows the OS colour scheme) with `app/icon.png` fallback. **Open Graph image**: `app/opengraph-image.tsx`, lockup plus "SAP data quality, measured".
- **Signed-out pages** (`components/auth/auth-frame.tsx`): a white brand panel (`.m-brand-panel`: lockup, the decorative score-ring instrument in the accent, two facts) beside one 400px card on the canvas with an `<h1>`, the form and the version string beneath.
- **Journey** (`JourneyStepper`): four stations on one rail (System connected, Configuration loaded, Data extracted, First score) with the set's icons; done stations fill in the pass hue, the current one is ringed in the accent, and the step under the rail says what to do now with its one button.
- **Rail** (`design/shell/Rail.tsx`): a light sheet with a hairline right edge. Each item shows its icon and text label, expanded by default (collapsed to icons below 1024px or when the user collapses it with the button or `[`). The active item is a soft blue tint with blue ink.

## Object names
An object (a module id such as `fi_gl`) is shown by its name from `formatModuleName` (`lib/format.ts`), never by an API `label` and never by title-casing the id; `lib/api/v1/objects.ts` renames the objects API's rows on read. `MODULE_LABELS` holds a name for every module with a rule file under `checks/rules/` and every module `sap/extraction_registry.py` extracts, worded as `api/routes/sync_trigger.py` `MODULE_REGISTRY` and cased by one convention:

- Sentence case: the first word capitalised, every other word lower case ("Material master", "Accounts payable", "Performance and goals"; "&" is written "and").
- SAP acronyms stay upper case wherever they fall: FI, MM, SD, HCM, MDG, GRC, WM, BP, CVI, PII, IDoc, S/4HANA ("FI general ledger", "HCM personnel administration", "SD sales orders"). The id's component prefix is spelled as the acronym plus the words, not expanded (`fi_gl` is "FI general ledger", not "Financial accounting general ledger").
- eWMS keeps its lower-case e, also at the start of a name ("eWMS stock").
- Product names keep SAP's spelling: Concur, Ariba, SuccessFactors ("Ariba suppliers"). Module names inside a product are ordinary words ("Employee central").

An id missing from the map is sentence-cased (`new_module` reads "New module"); `lib/__tests__/format-copy.test.ts` fails when a module of the coverage table or a rule file has no name, or when a name breaks the convention.

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
