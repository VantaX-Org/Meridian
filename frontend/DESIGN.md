# Meridian design system

Recorded from the built foundation: the shell, `components/ui-core`, and the Command Centre overview, findings and live operations pages. When this file and the code disagree, the code is right and this file needs updating.

Mode: Operate. A steward works through failing SAP records for hours beside SAP GUI. Consultants present the same surfaces to a sponsor. Scanability, consistency and a fast keyboard path matter more than expression.

## Direction

The incumbent dark navy and electric blue theme is an anti-reference. It looked like every observability tool and made dense tables tiring to read in daylight. The replacement is closer to a well-set ledger: paper-grey canvas, white sheets, ink type, one petrol accent, and colour used only for defect state.

- Light by default. Dark is a full alternative, picked from the top bar and stored under `aurora:theme`.
- Colour means a defect state. Petrol marks selection, focus and links. It never decorates.
- Records come before pictures. Every figure links to the rows behind it.
- The token names keep the `--aurora-*` prefix, so legacy pages pick up the new values without code changes.

## Colour

Light values are listed first. Dark overrides live under `[data-theme="dark"]` in `app/styles/aurora.css`.

| Role | Token | Light | Dark |
|---|---|---|---|
| Canvas | `--aurora-canvas-base` | `#F3F4F2` paper | ink-950 |
| Sheet | `--aurora-canvas-raised` | `#FFFFFF` | ink-900 |
| Hairline | `--aurora-canvas-line` | `#DADDD8` | ink-800 |
| Text | `--aurora-fg-primary` / `secondary` / `tertiary` | ink-900 `#15181A` / 700 / 600 | ink-100 / 200 / 300 |
| Accent | `--aurora-accent-500` | `#0E5A6B` petrol | `#4FB3C4` |
| Critical | `--aurora-status-danger-500` | `#B42318` | lifted for dark |
| High | `--aurora-status-high-500` | `#C4500B` | lifted for dark |
| Medium | `--aurora-status-warning-500` | `#A86A00` | lifted for dark |
| Pass | `--aurora-status-success-500` | `#23794A` | lifted for dark |

- Low severity has no hue. It is a ring in the tertiary text colour, so the four severities differ in shape as well as hue.
- `--aurora-signal-500` and `--aurora-status-info-500` alias the accent. There is no separate cyan "in flight" colour.
- The chart palette is `--aurora-viz-1..12` plus sequential petrol and amber ramps. It is read through `components/aurora/data/chart-theme.ts`.
- There are no gradients, no glass and no backdrop blur. `npm run lint:tokens` enforces this (see Guardrails).

## Type

- **Atkinson Hyperlegible Next** for all UI text, and **Atkinson Hyperlegible Mono** for SAP identifiers. Both are loaded with `next/font` in `app/layout.tsx`, so no remote request happens at runtime.
- The family was chosen because stewards read thousands of keys. Its letterforms keep 0/O and 1/l/I apart. The slashed zero is the typeface's own design, not a stylistic set, so expect it in numerals everywhere.
- Mono is used only for real SAP identifiers: check IDs, `TABLE.FIELD`, record keys, run IDs and field values in sample tables. Labels, counts and dates are never mono. Use `<Mono>` or `<FieldChip>`.
- The root size is 13px, and `ui-core` sizes are set in px against it:
  - Page title: 24/30, weight 600, tracking -0.01em.
  - Metric value: 22/28, weight 600.
  - Section title: 15/20, weight 600.
  - Drawer title: 17/24, weight 600.
  - Body and table: 13/18.
  - Meta: 12/16.
- Numbers use tabular figures (`font-variant-numeric: tabular-nums`, or `.aurora-number`).
- Sentence case everywhere. There are no all-caps eyebrows, no middle-dot meta strings and no arrows on links or buttons.

## Space, shape, elevation

- **Spacing:** 4px grid, `--aurora-space-1..24`. `.ui-page` pads at `space-6`, or `space-3` below 720px.
- **Radii:** two. `--aurora-radius-control` is 4px for buttons, inputs and chips. `--aurora-radius-sheet` is 6px for section cards, tables and dialogs. Nothing is pill-shaped except chips.
- **Elevation:** `--aurora-elev-0..4-{bg,shadow}`. Light mode uses hairline borders plus a soft shadow only on overlays (popover, palette, drawer). Dark mode brightens the surface instead.
- **Scrim:** `--aurora-scrim`. **Selection:** `--aurora-accent-selected-{bg,border}`.

## Components (`components/ui-core`)

These are thin, opinionated wrappers over `components/aurora`. New pages compose them and add no page-level CSS.

| Component | Use |
|---|---|
| `PageHeader` | Title, one-sentence summary that states the situation, actions on the right |
| `MetricStrip` / `Metric` | A row of counts. `tone` sets the defect colour and `href` makes the count open the filtered list. `delta` shows change with a declared good direction |
| `StatusBadge` / `Status` | Severity and job state as a dot plus a word, never colour alone |
| `SectionCard` | A titled sheet with `meta` and one `action` link. `flush` removes the inner padding for lists and tables |
| `FilterBar` | Search with a `/` shortcut, plus count chips that toggle filters |
| `KeyValue` | A definition list for drawers. `mono` rows hold identifiers |
| `FieldChip`, `Mono` | SAP identifiers |
| `EmptyState` | One sentence on what is absent, plus the action that fills it |
| `TableSkeleton` | Loading state with an accessible label |
| `ReasonButton` | An action that needs a written reason. It expands inline into a required text field and submits only with text. Used for false positives, which the API refuses without a note |

Supporting pieces from `components/aurora`:

- **`DataTable`**: virtualised. Enter or a click calls `onRowActivate`. Column `meta.minWidth` stops a flex column from collapsing on narrow screens.
- **`DetailDrawer`** with `useDrawerParam`: the open record lives in the URL, so a drawer can be linked to. The drawer is at most `100vw` wide.
- **`Banner`**, **`Pager`**, **`Chip`**, **`Button`**.

## Page patterns

- **Overview (`components/command-centre/overview.tsx`)**:
  - A one-sentence verdict.
  - A metric strip.
  - An object by dimension matrix, weakest first.
  - Top items by impact.
  - The score with its dimension bars and run history.
  - Where the data lives.
- **Findings (`components/command-centre/findings.tsx`)**:
  - A register with filter chips by severity and object.
  - Columns: severity, finding with check and field, basis, object.
  - The drawer shows the record count, why it matters, the SAP consequence, sample failing records, record keys and the rule. Its actions are "Work failing records" and "Copy check ID".
- **Live operations (`app/(dashboard)/command-centre/live.tsx`)**:
  - A metric strip.
  - Needs attention.
  - The stewardship queue.
  - Jobs running. Progress is shown against the system's own average run, and is never invented.
  - Systems.

## Guardrails

- `npm run lint:tokens` (`scripts/lint-tokens.mjs`) rejects raw hex, gradients and backdrop blur outside the token files. Files that predate the redesign are listed in `scripts/lint-tokens.allow.txt`. Delete a line when its page is migrated, and never add one.
- The eslint `aurora-writing` rules flag placeholder copy. The one known false positive is `type="submit"` in `ReasonButton`.
- Reduced motion turns off the drawer and scrim entrance. Focus rings always show and use the accent colour.
