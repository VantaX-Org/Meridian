# Meridian design system: "The Instrument", drawn on the Canvas

Source of truth for the visual layer. Values live in `frontend/design/tokens.css`, the only file that may hold colour, shadow, blur or motion literals. When this file and the code disagree, the code is right and this file needs updating.

## 1. Direction

Every data product on the market is cards on a canvas. Meridian is an instrument. Its mark is a measuring arc crossed by a meridian line, and that is the layout grammar: **one datum line per page, one ruler for every number, and the explanation written in the margin.**

1. **The work surface.** There is no sidebar. The index bar (`Rail`) is one row: the brand, the six places a person goes as pills (Home, Objects, Fix, Inbox, Runs, Insights, Systems; the process persona gets Processes in place of Fix) with live counts, "More" for every other page grouped as the nav defines them (Settings stands for its tabs; no href twice), and search, notifications, help and the user on the right. Under it the scope bar (`TopBar`) carries the page's h1 (the Breadcrumb) and the scope parts a page publishes. A page is then one column: the figure that answers its question first, the ledger of what moves it second, and the one action that follows. Nothing is shown twice.
2. **The Rule.** One primitive draws every score: a ruler from 0 to 100 with the measured value as a filled run and a needle, the target as a tick, and the cap (a critical finding holding the score down) as a second tick with the measured value ghosted beyond it. The same geometry at three sizes: `hero` (the score sheet, labelled 0, Target and 100), `row` (a table cell beside the numeral) and `inline` (a mark in a sentence). A reader learns the instrument once. The 270 degree arc (`ScoreRing`) remains for the brand and the detail header; it is never beside a Rule for the same number.
3. **The four sentences.** Situation, what changed, why it matters, do next: `InsightHeader` sets them in one row under the figure (embedded in the Home hero, with the score band on an insight page), each with a tone bar and at most one action. They are never a card of their own and never repeated by a summary card below.
4. **Canvas surfaces.** Light is a bright blue-grey canvas (`#F4F6F8`) with white sheets: one hairline, a 16px radius and one soft shadow (`--m-elev-card`) under every card and the score sheet, near-black ink (`#1A2233`), soft tints for state (red, amber, green, blue) and pill-shaped controls. Dark is the same drawing in blue graphite with no card shadow. Both come from one token set and both are first class. No gradients, no glow, no blur.
5. **One accent.** Cobalt (`#2563EB`; `#7FA8FF` in dark) marks interaction only: the primary button, links, selection, focus, the active pill. The cobalt family (`#E8F1FF`, `#BFD6FF`, `#7FA8FF`) is the sequential ramp and chart series 1. Hue otherwise means defect state: red, amber and green, plus an info blue for neutral notices; severity is colour plus shape, never colour alone. The object map (`ObjectMap`) draws every object as a tile whose area is its record count and whose tint is its verdict.
6. **Type.** Manrope for words and figures (400 to 800), tabular numerals, 14px body on a 4px grid, the score numeral at 120px on Home; JetBrains Mono for SAP identifiers only. Sentence case everywhere.
7. **Icons.** Meridian's own set (`design/icons`), one 24 grid and one 1.6 stroke; nothing from a library, nothing decorative, no sparkle anywhere.
8. **Motion is measurement.** 120, 240 or 480 ms, ease-out; a draw-in settles like a needle, a count-up eases like a gauge, nothing bounces (the hover lift eases out, no spring) and a count-up runs the 480 ms draw. The one exception is a loop, not a transition: the skeleton sweep and the spinner turn on `--m-motion-shimmer` (1400 ms). Zero under `prefers-reduced-motion`.
9. **Every number opens the rows behind it** (`DrillLink`, `Stat href`), **the URL is state**, and **speed is a feature**: skeletons in the final geometry, virtualised tables above 200 rows, prefetch on hover.
10. **Plain speech.** Every sentence the product writes reads like a colleague said it: "Quality is at 72, with 2,661 findings across 343,209 records." No status-speak, no "Please note", no exclamation marks.

The benchmark is Linear, Stripe and Vercel for craft, Tufte for the margin, a good instrument panel for the rest.

## 2. Tokens

Light values on `:root`, dark under `[data-theme="dark"]` and under `prefers-color-scheme: dark` when no theme is set.

| Token | Light | Dark |
|---|---|---|
| `--m-canvas` | `#F4F6F8` | `#0F1420` |
| `--m-sheet` | `#FFFFFF` | `#171D2B` |
| `--m-sheet-raised` | `#EEF1F5` | `#1F2635` |
| `--m-rail` | `#FFFFFF` | `#141A27` |
| `--m-ink`, `-2`, `-3` | `#1A2233`, `#3F4A5C`, `#5A6578` | `#E8ECF3`, `#B6BFCE`, `#98A3B5` |
| `--m-line`, `--m-line-strong` | `#E6EAF0`, `#CBD2DC` | `#2A3344`, `#3B475C` |
| `--m-accent`, `-soft`, `-ink` | `#2563EB`, `#E8F1FF`, `#1B4FD6` | `#7FA8FF`, `#1C2A4A`, `#9DBDFF` |
| `--m-critical`, `--m-high`, `--m-medium`, `--m-low`, `--m-pass` | `#C62828`, `#A64D07`, `#9A5B00`, `#5A6578`, `#1B7544` | `#F0737C`, `#EE965A`, `#E2BE5C`, `#A3ABB7`, `#5CC78C` |
| `--m-info` | `#2563EB` | `#7FA2F3` |

Verdicts alias the scale: `--m-go` is pass, `--m-at-risk` is medium, `--m-no-go` is critical. `--m-hero-*` alias sheet, ink, line and the status hues. Other groups: DQS bands and caps, chart series `--m-viz-*`, space (4px grid), radii (`--m-radius-control` 10px, `-sheet` 16px, `-tile` 0, `-pill`), tracking (`--m-tracking-tight` on hero and stat numerals, `--m-tracking-title`), elevation (`m-elev-1..3`, `--m-elev-card`, `--m-elev-focus`), motion (`--m-motion-*`), layout (`--m-page-pad`, `--m-page-max`, `--m-topbar-h`, `--m-scopebar-h`, `--m-row-h`, `--m-control-h`).

Type scale (px, size/line): label 11/14, meta 12/16, body 14/20, heading 15/22, page title 22/28, stat 26/32, hero score 64/64 (88/88 in presentation mode). The root font size is 14px. Use the `m-text-*` utility classes, never `text-[Npx]` literals in pages.

Density: the user's preference (`/me/preferences`) lands on `<html data-density>` as `compact`, `default` or `comfortable`, and `tokens.css` retunes `--m-row-h` (34 / 40 / 48), `--m-row-h-dense`, `--m-control-h` (30 / 34 / 38), `--m-card-pad*` (16 / 24 / 28 by default), `--m-hero-pad`, `--m-stat-pad`, `--m-stat-h`, `--m-stat-hero-h`, `--m-section-gap` and `--m-page-pad` per tier. Cards, stat tiles, the hero and the insight page gap read those tokens, so no component carries a density branch. Presentation mode (`[data-present="1"]`) steps the type scale, the hero and the page padding up one size the same way.

Contrast: `npm run check:contrast` fails unless ink on every surface, accent on sheet and canvas, every defect and info hue on sheet, canvas and its soft tint, every domain hue, and the ramp inks are at least 4.5:1, in light, explicit dark and system dark.

## 3. Components

All in `@/design`; there is no second library. Pages compose these and draw nothing of their own.

- **Rail** (the index bar) and **TopBar** (the scope bar): the shell's two rows, rendered once by the (app) layout. A page never draws navigation. The "More" panel is a disclosure of plain links grouped by nav group, closed by Escape, a click outside or focus leaving it.
- **ObjectMap** (`design/charts/ObjectMap.tsx`): one tile per object, area by record count, tint by verdict, the score as the numeral; every tile opens its object. Home and the Objects list draw it beside the ledger.
- **Ledger**: a `DataTable` whose rows are ranked by what moves the score (records affected, then severity) and whose last column is the row's one action as a link ("Fix", "Assign", "Open"). The blocking rule sits in the row as `Mono` id plus plain words.
- **Workbench**: an object's detail is a split pane (`grid-template-columns: 400px minmax(0,1fr)`): the failing rules ranked by records on the left, each a selectable row with a severity bar; the selected rule's records on the right with filter chips, bulk selection and the rule's one action. The dimension bars are a strip under the rules, not a chart of their own.
- **Rule**: the one instrument for a score (`value`, `target`, `cap`, `bands`, `size`). `hero` is a full-width ruler with ticks every 10, the measured run in the band hue, the needle in ink, "0", "Target 90" and "100" beneath (the end label yields when the target or cap sits near it), the cap as a red tick with a dashed ghost of the measured value beyond it. `row` is 96 by 12 for a table cell, `inline` 56 by 8 for a sentence; `width` stretches a row across a stat tile. The whole ruler is one `role="img"` naming the value, cap and target.
- **PageHeader**: `<h1>` title 22/28 semibold, one-line meta, optional status `Pill`, actions (one primary `Button` at most), tabs. Every page uses it. The document's one `h1` is rendered by the `Breadcrumb` (screen-reader-only while a `PageHeader` is mounted). A detail page whose URL alone cannot name it (`/systems/[id]`, `/process/[l1]`, `/rules/[ruleId]`, `/process/runs/[runId]`) publishes its entity's name with `useBreadcrumbTitle` from `@/design`, beside its `PageHeader`: `useBreadcrumbTitle(system ? { label: system.name, parent: { label: "Systems", href: "/systems" } } : null)`. The name becomes the h1 and the list page the crumb before it; `null` publishes nothing while the entity loads. `useBreadcrumbScope([...])` adds the scope parts after the title.
- **Button**: primary, secondary, ghost, danger (confirm dialogs only). `pending` shows the inline dot and disables the button. Use `render={<Link>}` for navigation, never a button inside an anchor.
- **Field** with a control, **Select**, **Combobox**, **Checkbox**, **Menu**: 34px controls (`--m-control-h`), 10px radius, labels 12/16 medium, helper and error text under the control, never inside the label.
- **Card**: white sheet, 1px `--m-line` border on every side, `--m-radius-sheet` (16px), the `--m-elev-card` shadow, `--m-card-pad` (24px), optional title 15/22, meta and actions. Replaces every hand-rolled `rounded border` box.
- **Notice**: tinted note with a 3px tone bar (info, warning, danger, success). Replaces raw alert boxes.
- **Status**: the one status vocabulary (see "Status vocabulary" below). `<Status kind="verdict" value={api.verdict} />` renders the pill with the canonical label and tone; callers pass the API value and never write the label.
- **Pill, Badge, SeverityDot**: `Pill` is a free label (a tag, a role, "Baseline", a count sentence) in `neutral`, `info` or a verdict tone; when the text is a verdict, a severity or a lifecycle stage it is a `Status` instead. `Badge` is a count only (`tone="critical"` for counts of failing items). Pills are sentence case with no full stop.
- **ChoiceGroup** and **Choice** (`.m-choice`): every toggle pill. A named `group` of `aria-pressed` buttons, single choice or `multiple`; the pressed pill wears the accent tint (interaction), never a status hue. `Choice` is one on/off filter on its own. A radio group of pills (the theme switch) uses the same class with `role="radio"`.
- **Stat**: label, value (`min-width: 4ch`, tabular), delta, optional `href` or `onClick`, `loading` skeleton at the same height. `bar` with `rule` draws the Rule under the value (hero size in a hero tile, a stretched row rule in an ordinary tile, which then grows to fit); `Score size="hero"` is built on it.
- **Score hero** (`.m-hero`: Home's verdict row, the Insights and Executive summary `InsightHeader hero`): a white card holding the plain large score with the hero Rule under it, the verdict sentence and at most four stat-size tiles (two by two beside the score). A soft cobalt wash (`--m-grad-hero`), no dark band, no glow. The four sentences sit under the band behind one hairline (`.m-hero-cells`).
- **Score**: the one way to draw a score, at one of three sizes. `hero`: the large number and the hero Rule (the Home verdict row, the Insights and Executive summary hero, the scoring what-if). `md` (default): the 48px ring with the logo geometry (270 degree arc open at the top) that carries the number, for a detail header or a stat tile; `explain` makes the ring open the breakdown (formula, inputs, cap reason, costliest rules), and `DqsScore` (`components/insight/dqs-score.tsx`) feeds it a run's DQS. `sm`: an inline Rule and the number, for a table cell. `cap` keeps the cap visible at every size: the ring fills only to the cap with a tick and a dashed ghost of the measured value and says "Capped at"; the hero says it under the bar, prints the capped composite as `value` and takes the uncapped value as `measured`, drawn only as the ghost beyond the cap tick, never as the numeral. A block draws a score once: no ring beside a stat of the same number, no hero beside a ring. A KPI row may carry a score as a plain `Stat` number when it is compared with another one (before and after, baseline and latest).
- **DataTable**: rows of `--m-row-h` (40px; 34 compact and 48 comfortable by the density preference; `dense` or the toolbar toggle steps down to `--m-row-h-dense`), virtualised above 200, arrow-key row navigation, Enter opens, Space selects, Escape clears. Filters are removable chips. One empty row when a filter removes everything.
- **Plain table** (`<table className="m-table">`): a small matrix or comparison that is not a ledger (a role matrix, a threshold list, a snapshot diff) reads as a DataTable: the `--m-row-h` row, hairline rules, the label-size header over the strong rule, tabular figures. A list people sort, filter or open rows from is a `DataTable`.
- **Async**: loading, empty and error for one region. `<Async query={q} skeleton="table" isEmpty={(d) => !d.items.length} empty={{ title, action }}>{(d) => ...}</Async>`. The state set is `AsyncState`: `loading`, `empty`, `error`, `ready`; `asyncStateOf(q, isEmpty, notFoundIsEmpty)` derives it from a query (a 404 from a list endpoint reads as empty with `notFoundIsEmpty`). A failed query reads through `apiErrorState` with Retry refetching it; a skeleton that never resolves becomes "This is taking longer than expected." with Retry. `skeleton` is a shape (`table`, `chart`, `stats`, `list`), a height in px, or a node in the final geometry; without `empty` copy an empty region renders its children (a card that prints its own one-line empty). Every template speaks the same set: `HomePage`, `ExplorerPage`, `ReportPage` and the insight frame take `state: AsyncState` and run their body through `Async`.
- **EmptyState** (title under 8 words, one detail sentence, one required action; `ghost` is one of `table`, `chart`, `grid`, `list`, `ring`, `stepper`), **ErrorState** (message plus Retry), **Skeleton** in final geometry: the parts `Async` composes, used directly only where a region is not one query. No raw `<p>` for loading, empty or error.
- **ConfirmDialog**: every confirmation. `tone="danger"` for deletes, `typeToConfirm` makes the user type the name first, buttons name the action and its inverse ("Delete team" / "Keep"). `window.confirm` is not used anywhere in `app/`.
- **Toasts** (`toast` from `@/design`, wraps sonner): `toast.undoable(message, { undo, timeoutMs })` adds an Undo action and only exists for actions whose API has a real inverse. No inverse endpoint, no undo. The viewport sits bottom-right, offset above the Ask Meridian launcher (`TOAST_OFFSET`), so a toast never covers it.
- **Keyboard shortcuts** (`lib/shortcuts.ts`, the one registry): written with "⌘" and spelled for the viewer's platform by `shortcutLabel` (⌘ on macOS, Ctrl elsewhere) wherever a key is shown: the `?` sheet, the palette and a tour step. Groups: Navigation (from `lib/nav.ts`), Tables, Inbox, Designer (⌘S Save model), Global.
- **Model-written text** is labelled in words above the text ("Written by the model from aggregated findings" in Ask Meridian), never after it and never as "AI-generated".
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

A job in the jobs tray and a discovery run use the lifecycle set; a stalled job adds the at-risk pill "No update for N min" with an "Open job" action, never a second status word.

`variant="solid"` is for the row's primary verdict or severity (one column per table). Other components speak the same values: `Stat tone` and `InsightHeader` cells take a verdict, `Card tone="critical"` and `Badge tone="critical"` take the severity value. `Notice` is a message, not a state, and keeps its message severities: `info` (neutral note), `success` (draws in the go hue), `warning` (the at-risk hue), `danger` (the no-go hue). "Capped" is not a status: the `Score` shows the cap.

Copy: no full stops in table cells, pills, tile labels or hints; no "Showing X." sentences; numbers through `toLocaleString`; currency with the tenant currency code.

## 4. Brand

- **Mark**: a 270 degree arc, open at the top, crossed by a vertical meridian line, on a 32 grid, stroke 3, round caps. The arc is ink, the line is the accent. In the app it is the inline SVG `MeridianMark` (`components/meridian/icons.tsx`).
- **Wordmark**: the word "Meridian" type-set in Manrope 700, letter-spacing -0.01em, ink colour. Never hand-drawn, never accented. The lockup is the mark plus the wordmark with a 10px gap at a 32px mark.
- **Assets** in `public/brand/` (see its README): marks, outlined lockups, PWA icons from `npm run brand:rasterise`. Colours are in `brand.json`. `app/apple-icon.tsx` draws the two-tone mark on a plain canvas tile and `app/opengraph-image.tsx` a white sheet on the canvas with the lockup; both read `design/brand/images.tsx`, which mirrors `brand.json`. There is no cover gradient anywhere.
- **Favicon**: `app/icon.svg` (stroke 3.5, ink and accent from `brand.json`, follows the OS colour scheme) with `app/icon.png` fallback. **Open Graph image**: `app/opengraph-image.tsx`, lockup plus "SAP data quality, measured".
- **Signed-out pages** (`components/auth/auth-frame.tsx`): a white brand sheet (a `Card`: lockup, the decorative score-ring instrument in the accent, three facts) beside one 400px card on the canvas with an `<h1>`, the form and the version string beneath.
- **Journey** (`JourneyStepper`): four stations on one rail (System connected, Configuration loaded, Data extracted, First score) with the set's icons; done stations fill in the pass hue, the current one is ringed in the accent, and the step under the rail says what to do now with its one button.
- **Index bar** (`design/shell/Rail.tsx`): a white row with a hairline under it. The primary pills sit on a raised track; the active pill is a white sheet with the card shadow; Fix carries its count as a critical badge, Inbox as a neutral one; Systems carries the worst health as a pip. Below 1024px the pill strip scrolls sideways.

## Object names
An object (a module id such as `fi_gl`) is shown by its name from `formatModuleName` (`lib/format.ts`), never by an API `label` and never by title-casing the id; `lib/api/v1/objects.ts` renames the objects API's rows on read. `MODULE_LABELS` holds a name for every module with a rule file under `checks/rules/` and every module `sap/extraction_registry.py` extracts, worded as `api/routes/sync_trigger.py` `MODULE_REGISTRY` and cased by one convention:

- Sentence case: the first word capitalised, every other word lower case ("Material master", "Accounts payable", "Performance and goals"; "&" is written "and").
- SAP acronyms stay upper case wherever they fall: FI, MM, SD, HCM, MDG, GRC, WM, BP, CVI, PII, IDoc, S/4HANA ("FI general ledger", "HCM personnel administration", "SD sales orders"). The id's component prefix is spelled as the acronym plus the words, not expanded (`fi_gl` is "FI general ledger", not "Financial accounting general ledger").
- eWMS keeps its lower-case e, also at the start of a name ("eWMS stock").
- Product names keep SAP's spelling: Concur, Ariba, SuccessFactors ("Ariba suppliers"). Module names inside a product are ordinary words ("Employee central").

An id missing from the map is sentence-cased (`new_module` reads "New module"); `lib/__tests__/format-copy.test.ts` fails when a module of the coverage table or a rule file has no name, or when a name breaks the convention.

## Routes
Live pages are under `app/(app)/`: `home` (redirects each role to its persona home: lead, steward, basis, process), `systems`, `objects` (tabs: overview, rules, fields, records, history), `runs`, `rules` (children in the nav: Data contracts, Rule drafts, Dictionary, Scoring and alerts; `/rules/learned` is Learned rules off the nav), `insights`, `process` (As-is processes with the Process designer child at `/insights/process/designer`, and Discovery runs), `mdm` (glossary, golden, match-rules, survivorship), `migration`, `inbox`, `fix`, `import`, `search` (pages, systems, objects, rules, glossary terms, batches, runs, processes, discovery runs and process models), `admin` (Users, Roles and access, Audit log, Settings with its tabs: triage, mappings, ai, notifications, jobs, reference, licence; billing), and `design` (the component gallery).

Insights is five views on one spine. The rail lists the views; every insight page carries the tab strip of its view (`InsightTabs`) under the page header, the same action bar (`InsightActions`: Run analysis, Review fixes, Present, Export with the failing-records list), and the four-sentence `InsightHeader`. A process page's export is the reference model deck (PowerPoint) or the Signavio package of the as-is model.

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
