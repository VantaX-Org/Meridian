# Meridian design system

Recorded from the built foundation: `frontend/design/` (imported as `@/design`) and the `app/(app)/` route tree. When this file and the code disagree, the code is right and this file needs updating.

Mode: Operate. A steward works through failing SAP records for hours beside SAP GUI. Consultants present the same surfaces to a sponsor. Scanability, consistency and a fast keyboard path matter more than expression.

## Direction

An instrument panel, not a dashboard theme: a cool slate canvas, white sheets, near-black ink, one indigo accent for selection and links, and hue reserved for defect state. Dense, scannable, keyboard-friendly.

- Light by default. Dark is a full alternative under `[data-theme="dark"]`, and `prefers-color-scheme: dark` when no theme is set.
- Colour means a defect state. The accent marks selection, focus and links only. It never decorates.
- Records come before pictures. Every figure links to the rows behind it.
- There is one component library: `@/design`. No legacy shell, no second token system.

## Colour

Light values first. Dark values live under `[data-theme="dark"]` and `@media (prefers-color-scheme: dark)` in `design/tokens.css`.

| Role | Token | Light | Dark |
|---|---|---|---|
| Canvas | `--m-canvas` | `#EDF0F2` | `#0F1417` |
| Sheet | `--m-sheet` | `#FFFFFF` | `#171D21` |
| Sheet raised | `--m-sheet-raised` | `#F7F9FA` | `#1E262B` |
| Hairline | `--m-line` | `#D5DBE0` | `#2C363D` |
| Ink | `--m-ink` / `--m-ink-2` / `--m-ink-3` | `#101418` / `#3C4852` / `#6B7781` | `#E8EDF0` / `#AEB9C2` / `#7E8A94` |
| Accent | `--m-accent` | `#2D3A8C` | `#8C9BEA` |
| Accent soft | `--m-accent-soft` | `#E4E8FA` | `#242C52` |
| Critical | `--m-critical` | `#B3261E` | `#F28B82` |
| High | `--m-high` | `#C65A00` | `#F0A35C` |
| Medium | `--m-medium` | `#8A6A00` | `#D9B64A` |
| Low | ink-3 ring, no hue | | |
| Pass | `--m-pass` | `#1E7A46` | `#6CCB8E` |
| Chart series | `--m-viz-1..8` | eight hues chosen for distinguishability on both canvases; critical and high keep their own hues in every chart | |

- In charts only Critical and High carry hue. Medium and Low are ink at 60% and 35%, so the eye goes to what needs action.
- Low severity has no hue: a ring in `--m-ink-3`, so the four severities differ in shape as well as hue.
- The shadcn semantic vars (`--background`, `--card`, `--border`, `--ring`, etc., used by Tailwind utilities like `bg-background`) are a one-time bridge onto these `--m-*` tokens in `app/globals.css`. Components should reach for `@/design` primitives or the `--m-*` vars directly, not invent new semantic vars.
- There are no gradients, no glass and no backdrop blur. `npm run lint:tokens` enforces this (see Guardrails).

## Type

- **Public Sans** for all UI text, **JetBrains Mono** for SAP identifiers only. Both are loaded with `next/font` in `app/layout.tsx`, so no remote request happens at runtime.
- Mono is used only for real SAP identifiers: check IDs, `TABLE.FIELD`, record keys, run IDs and field values in sample tables. Labels, counts and dates are never mono. Use `<Mono>` from `@/design`.
- The root size is 13px, and `@/design` primitives are sized in px against it:
  - Page title: 24/30, weight 600.
  - Section title: 15/20, weight 600.
  - Drawer title: 17/24, weight 600.
  - Body and table: 13/18.
  - Meta: 12/16.
  - Stat value: 22/28, weight 600. Hero figure: 40/48, weight 600. Score ring: 48.
- Numbers use tabular figures (`font-variant-numeric: tabular-nums`).
- Sentence case everywhere. No all-caps eyebrows, no middle-dot meta strings, no arrows on links or buttons.

## Space, shape, motion

- **Spacing:** 4px grid, `--m-space-1..24`. Page gutter at `space-6`, `space-3` under 720px.
- **Radii:** two. `--m-radius-control` (4px) for buttons, inputs and chips. `--m-radius-sheet` (6px) for section cards, tables and dialogs. Nothing is pill-shaped except chips.
- **Elevation:** a hairline border on sheets; a shadow only on drawer, dialog, menu, palette.
- **Motion:** 120ms ease-out for drawer and menu, none for tables. `prefers-reduced-motion` disables all.

## Components (`@/design`)

Everything a page needs — primitives, charts, table, shell, and page templates — comes from the single `frontend/design/` package, re-exported through `design/index.ts`.

| Area | Pieces |
|---|---|
| Primitives | `Button`, `IconButton`, `Field`, `Select`, `Combobox`, `Pill`, `Badge`, `Tabs`, `Drawer`, `Dialog`, `Menu`, `Toast`/`Toaster`, `Tooltip`, `Skeleton`, `EmptyState`, `ErrorState`, `Mono`, `Delta`, `Stat`, `SeverityDot`, `ScoreRing` |
| Table | `DataTable`, `columns`, `Pager`, `BulkBar` |
| Charts | `Line`, `Bar`, `Waterfall`, `Radar`, `Heatmap`, `Sparkline`, `Graph`, shared `theme` |
| Shell | `Rail`, `TopBar`, `Breadcrumb`, `RunSelector`, `JobTray`, `CommandPalette`, `useDrill`/`DrillLink` |
| Page templates | `HomePage`, `ExplorerPage`, `RecordPage`, `ReportPage` |

New pages compose these and add no page-level CSS. `SeverityDot` renders severity as colour plus shape, never colour alone. `DrillLink`/`useDrill` are how a figure becomes a link to its rows.

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

## Rules

1. **Every number opens its rows.** A count, a chart mark or a matrix cell is a link to the filtered list behind it.
2. **One loud element per page.** Everything else is hairline sheets and tabular numbers.
3. **Big numbers are counts people act on.** 22–48px, weight 600, tabular figures, with a plain label under or above. Never a percentage without the count beside it.
4. **Say the verdict in a sentence.** A page or hero opens with what is true now, not a description of the page.
5. **Charts answer one question each,** named in the card title as the answer's subject. No chart without a click target.
6. **Severity is colour plus shape.** Critical, high and medium carry hue in badges; low is a dotted or hollow mark. A badge always carries the word.
7. **Show the cap.** When a critical finding caps a score, say so beside the score, with the reason.
8. **Name SAP things the way SAP does.** Objects by their business name, fields as `TABLE.FIELD` in mono, transactions as codes.
9. **Empty states direct.** One sentence on what is missing and the link that fills it. No illustrations.
10. **Nothing is invented.** No progress bars without a real basis, no projected figures without their confidence, no sample data in production surfaces.
11. **Motion only shows a change.** `prefers-reduced-motion` turns it off.
12. **The URL is the state.** Tabs, filters, the open drawer and the selected run live in the query string.
13. **One h1 per route.**
14. **A figure is a number.** `value` is a number or `null`. A word or a formatted figure goes in `text`.
15. **No raw ids as copy.** Backend values go through a label function or `<Mono>`.
16. **Dates go through the shared date formatter**, never `toLocaleDateString`/`toLocaleTimeString` directly.

## Guardrails

- `npm run lint:tokens` (`scripts/lint-tokens.mjs`) rejects raw hex, gradients, backdrop blur, ad hoc shadows, motion, duration literals and all-caps text outside `design/tokens.css`. `scripts/lint-tokens.allow.txt` is empty. Never add a line to it.
- `npm run lint` runs `eslint . --max-warnings 0`, so CI fails on any error or warning.
- Reduced motion turns off entrance animation. Focus rings always show and use the accent colour.

## Known exception

The process designer's BPMN canvas (`app/(app)/insights/process/designer/_components/`) still renders its React Flow nodes and tree rows through `aurora-*` classNames, defined in `app/styles/aurora-components.css` and imported once from `app/globals.css`. That stylesheet is no longer an Aurora/ui-core dependency: it was pruned to only the rule blocks the designer actually uses, and every value is a `var(--m-*)` token from `design/tokens.css`. Renaming the classNames themselves to drop the `aurora-` prefix is tracked as follow-up work; the token dependency is already resolved.
