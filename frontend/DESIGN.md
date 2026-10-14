# Meridian design system: "The Instrument"

Source of truth for the visual layer. Values live in `frontend/design/tokens.css`, the only file that may hold colour, shadow, blur or motion literals. Spec: `docs/superpowers/specs/2026-10-12-ui-polish-design.md`. When this file and the code disagree, the code is right and this file needs updating.

## 1. Direction

Meridian is a measuring instrument for SAP data: it takes a reading, shows it, and says what it means. Cool slate canvas, white sheets, near-black ink, one indigo accent. Light is the default; dark is a full alternative under `[data-theme="dark"]`. The bar is Linear, Vercel, Stripe and Datadog for craft; Ataccama, Collibra and Informatica for data quality; Celonis and Signavio for process.

Rules, all enforced by lint or review:

1. **Restrained decoration.** No glass, backdrop blur, gradients outside hero zones, illustrations, mascots, or icons that do not stand for a state. No tile without a drill-down.
2. **Two accents.** `--m-accent` (cobalt) is selection, focus, links and the primary button. Ember and the `--m-grad-*` gradients exist only inside hero zones (`.m-hero`, `.m-brand-panel`, `.m-report-cover`, `.m-ghost-bg`, `.m-count-settle`); `lint:tokens` enforces it.
3. **Hue means defect state.** `--m-critical`, `--m-high`, `--m-medium`, `--m-low`, `--m-pass` and the verdicts `--m-go`, `--m-at-risk`, `--m-no-go` carry severity only, never selection or decoration. Severity is colour plus shape (critical square, high triangle, medium circle, low ring, pass check), never colour alone. Object domain (`--m-dom-*`, via `domainOf(moduleId)`) and chart series (`--m-viz-*`, ramps `--m-seq-*`, `--m-div-*`) are separate families and never stand for severity.
4. **Type.** Public Sans for UI (400, 500, 600), JetBrains Mono for SAP identifiers only (check IDs, `TABLE.FIELD`, record keys, run IDs, sample values). Both load through `next/font`. Numbers are tabular (`font-variant-numeric: tabular-nums` on `body`). Sentence case everywhere, no all-caps eyebrows. No serif face exists.
5. **Three elevations.** Flat (hairline), raised (menus, popovers), floating (drawer, dialog, palette).
6. **Motion is 120, 240 or 480 ms**, ease-out, and zero under `prefers-reduced-motion`. Entrance motion is for the first mount of a page frame, not for content that arrives after data.
7. **Show the cap.** When a critical finding caps the DQS at 85 or 70, the score shows the measured value, the cap and the rules that caused it.
8. **Every number opens the rows behind it** (`DrillLink`, `Stat href`).
9. **URL is state.** Filters, tabs, selected run and open drawer live in the query string.
10. **Light and dark are equals.** Every token has both values, including the domain, viz, ramp and hero tokens; `check:contrast` covers each pair in light, dark and system dark. Every review screenshot is taken in both.
11. **Speed is a feature.** Skeletons in the final geometry (no layout shift, never a spinner except the inline `Button pending` dot), virtualised tables above 200 rows, prefetch on hover and focus, optimistic updates for reversible local mutations. Colour adds no layout: edges and bars are inset shadows, and count-up and draw-in reserve their final width and height. Reduced motion zeroes all of it.

## 2. Tokens

Light values on `:root`, dark under `[data-theme="dark"]` and under `prefers-color-scheme: dark` when no theme is set.

| Token | Light | Dark |
|---|---|---|
| `--m-canvas` | `#F5F6F8` | `#0F1115` |
| `--m-sheet` | `#FFFFFF` | `#171A20` |
| `--m-sheet-raised` | `#F9FAFB` | `#1D2129` |
| `--m-ink`, `-2`, `-3` | `#15171C`, `#4B5160`, `#7A8191` | `#ECEEF2`, `#A6ADBB`, `#737B8A` |
| `--m-line`, `--m-line-strong` | `#E3E6EB`, `#C9CED6` | `#262B35`, lifted one step |
| `--m-accent`, `-soft`, `-ink` | `#4F46E5`, `#EEF0FD`, `#FFFFFF` | `#818CF8`, `#23264A` |
| `--m-critical`, `--m-high`, `--m-medium`, `--m-low`, `--m-pass` | `#C2410C`, `#D97706`, `#CA8A04`, `#64748B`, `#15803D` | `#F97316`, `#F59E0B`, `#EAB308`, `#94A3B8`, `#22C55E` |

Verdicts alias the scale: `--m-go` is pass, `--m-at-risk` is high, `--m-no-go` is critical, `--m-info` is ink-2. Other groups: DQS bands and caps, chart series `--m-viz-*`, space (4px grid), radii (`--m-radius-control`, `-sheet`), elevation (`m-elev-1..3`, `--m-elev-focus`), motion (`--m-motion-*`), layout (`--m-page-pad`, `--m-page-max`, `--m-rail-w`, `--m-topbar-h`, `--m-row-h`, `--m-control-h`).

Type scale (px, size/line): label 11/14, meta 12/16, body 13/18, heading 15/20, page title 20/26, hero number 28/32, verdict number 44/48. Use the `m-text-*` utility classes, never `text-[Npx]` literals in pages.

Contrast: `npm run check:contrast` fails unless ink on sheet and canvas, accent on sheet, and every defect hue on sheet are at least 4.5:1, in light, explicit dark and system dark.

## 3. Components

All in `@/design`; there is no second library. Pages compose these and draw nothing of their own.

- **PageHeader**: `<h1>` title 20/26 semibold, one-line meta, optional status `Pill`, actions (one primary `Button` at most), tabs. Every page uses it.
- **Button**: primary, secondary, ghost, danger (confirm dialogs only). `pending` shows the inline dot and disables the button. Use `render={<Link>}` for navigation, never a button inside an anchor.
- **Field** with a control, **Select**, **Combobox**, **Checkbox**, **Menu**: 32px controls, labels 12/16 medium, helper and error text under the control, never inside the label.
- **Card**: sheet, `--m-radius-sheet`, `m-elev-1`, optional title 15/20, meta and actions. Replaces every hand-rolled `rounded border` box.
- **Notice**: tinted note with a 3px tone bar (info, warning, danger, success). Replaces raw alert boxes.
- **Pill, Badge, SeverityDot**: state only. Pills are sentence case with no full stop.
- **Stat**: label, value (`min-width: 4ch`, tabular), delta, optional `href` or `onClick`, `loading` skeleton at the same height.
- **ScoreRing / DqsScore**: the logo geometry (270 degree arc open at the top). `DqsScore` explains itself: formula, six inputs, cap reason with links.
- **DataTable**: fixed 36px (44 comfortable) rows, virtualised above 200, arrow-key row navigation, Enter opens, Space selects, Escape clears. Filters are removable chips. One empty row when a filter removes everything.
- **EmptyState** (title under 8 words, one detail sentence, one required action), **ErrorState** (message plus Retry), **Skeleton** in final geometry. No raw `<p>` for loading, empty or error.
- **ConfirmDialog**: every confirmation. `tone="danger"` for deletes, `typeToConfirm` makes the user type the name first, buttons name the action and its inverse ("Delete team" / "Keep"). `window.confirm` is not used anywhere in `app/`.
- **Toasts** (`toast` from `@/design`, wraps sonner): `toast.undoable(message, { undo, timeoutMs })` adds an Undo action and only exists for actions whose API has a real inverse. No inverse endpoint, no undo.
- **Error surfaces**: `app/(app)/error.tsx` (inside the shell, reference id, Try again, Go home, Copy details), `app/global-error.tsx` (no shell, inline token styles), `app/(app)/not-found.tsx` and `app/not-found.tsx`. Every error is reported once per session to `POST /api/v1/client-errors` through `lib/client-errors.ts`; nothing goes to a third party.
- **Charts** (`design/charts`): horizontal grid only, no axis lines, series `--m-viz-1..8`, custom tooltip, each chart has a sentence under its title saying what it answers.

Copy: no full stops in table cells, pills, tile labels or hints; no "Showing X." sentences; numbers through `toLocaleString`; currency with the tenant currency code.

## 4. Brand

- **Mark**: a 270 degree arc, open at the top, crossed by a vertical meridian line, on a 32 grid, stroke 3, round caps. The arc is ink, the line is the accent. In the app it is the inline SVG `MeridianMark` (`components/meridian/icons.tsx`).
- **Wordmark**: the word "Meridian" type-set in Public Sans 600, letter-spacing -0.01em, ink colour. Never hand-drawn, never accented. The lockup is the mark plus the wordmark with a 10px gap at a 32px mark.
- **Assets** in `public/brand/` (see its README): marks, outlined lockups, `apple-icon.svg` (cover gradient, hero-ink mark, ember meridian line; the live icon is `app/apple-icon.tsx`), PWA icons from `npm run brand:rasterise`. Colours are in `brand.json`.
- **Favicon**: `app/icon.svg` (stroke 3.5, follows the OS colour scheme) with `app/icon.png` fallback. **Open Graph image**: `app/opengraph-image.tsx`, lockup plus "SAP data quality, measured".
- **Signed-out pages** (`components/auth/auth-frame.tsx`): one 400px card on the canvas with the lockup, an `<h1>`, the form and the version string beneath. No brand panel, no tagline, no marketing facts.

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

- `npm run lint:tokens` rejects raw hex, gradients, backdrop blur, ad hoc shadows, motion and duration literals and all-caps text outside `design/tokens.css`. `scripts/lint-tokens.allow.txt` holds no entries. Never add a line to it.
- `npm run lint` runs `eslint . --max-warnings 0`.
- `npm run check:contrast` gates the colour pairs above.
- Reduced motion turns off every animation. Focus rings always show (`--m-elev-focus`).
- `e2e/visual.spec.ts` walks every route in `routes.json` in light, dark, reduced motion and a fresh-install empty pass. Each pass saves a full-page screenshot to `test-results` (no baselines are committed) and fails on any axe WCAG 2.1 A/AA violation. The reduced-motion pass also fails if any element, `::before` or `::after` has a computed `animation-name` other than `none`. Fix a failure in the library or the tokens, never with a per-page override or an axe rule exclusion.
- Every number is a `DrillLink`; one `h1` per route (rendered by `Breadcrumb`); dates go through the shared formatter; no raw ids as copy.

## Known exception
The process designer's BPMN canvas (`app/(app)/insights/process/designer/_components/`) is styled by its own scoped `designer.css`, whose values are `var(--m-*)` tokens from `design/tokens.css`. The old `app/styles/aurora-components.css` stylesheet and its `globals.css` import are gone.
