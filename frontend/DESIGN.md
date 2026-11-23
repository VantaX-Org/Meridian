# Meridian design system

Source of truth for the visual layer. Values live in `frontend/ui/tokens.css`, the only file of the interface that may
hold raw colour, shadow and motion. Every other file reads `var(--mx-*)`; `npm run lint:tokens` rejects raw hex,
gradients, blur, ad hoc shadows and motion literals elsewhere, and `scripts/lint-tokens.allow.txt` stays empty.

## Direction

"The line": one score ruler with the 70 and 85 gates drawn on it, and the same few verbs on every screen. The shell is a
top bar with five sections (Home, Objects, Clean, Load, Monitor), a More menu and the palette for every other destination
(Insights, Runs, Rules, MDM, Systems, People, Requests, Approvals, Reports, Admin), and an Aletheia dock at the foot of
every screen that rises into the one chat sheet. On a phone the sections become a bottom tab bar. Light is the default;
dark applies when `html[data-theme="dark"]` or when the system is dark and the person chose nothing.

## Orientation, process and data movement

- **PageHeader** carries crumbs, title, context, a status badge, meta, actions and, where the page sits in a sequence, a
  stepper. Pages with no sequence (Home, Objects list, Monitor, Insights, Reports, Status, People) get no stepper.
- **Crumbs** come from `useCrumbs()` in `ui/screens/flow.tsx`: place, then page. The place label is a link once a page is
  named. Shared frames (admin `Frame` and `Sec`, MDM catalogue `Head`) set them once for every page they hold.
- **Steppers** use the kit `Stepper`; `Flow` and `Cycle` in `ui/screens/flow.tsx` fill it. Flows: the clean cycle (Pull,
  Clean, Upload, Score, Compare), the load journey, the master data journey, rule change, data request (`requestFlow`
  maps a real request status to a step), subject request and admin setup. A step state comes from real data, never
  from a guess; a blocked or failed step shows its reason as the hint.
- **Export** is `ExportMenu` calling a real API function. **Import** is `ImportSheet` (or `ImportDialog` in a sheet):
  choose, validate, review, apply. Nothing is written before the confirm; rejected rows are listed and counted. An
  endpoint with no check leaves `validate` out, and the file is checked when applied.
- **Saved views** on a `DataTable` with an `id` live in the browser only.

## Where things live

| Path | What |
| --- | --- |
| `ui/tokens.css` | every `--mx-*` token, scoped to `.mx-root`, light and dark |
| `ui/kit/` | the shared component kit (`@/ui/kit`): shell, tables, tabs, sheets, chips, charts, the Aletheia chat; its own `README.md` lists each part |
| `ui/screens/` | one folder per journey (home, work, load, runs, mdm, rules, insights, people, admin, systems, objects) |
| `ui/sheets.ts` | the sheet registry; `useSheet().open(id, arg)` opens one, `?open=kind:id` deep links to one |
| `ui/auth/`, `ui/testing/` | signed-out pages and the shared test helpers |
| `app/(app)/` | the routes of the signed-in interface, one thin `page.tsx` per screen; `Frame.tsx` is the shell wrapper |
| `app/(auth)/` | sign-in, invite, password and licence pages |
| `design/` | `tokens.css` (root base), `brand/` (the Aletheia attribution strip) and `global-error.css` |

## Rules

- **Tokens**: colour, border, ink, accent, status and Aletheia violet are `--mx-*` names; spacing is `--mx-s1` to
  `--mx-s6` on a 4px grid, radii are `--mx-r-control`, `--mx-r-card` and `--mx-r-pill`.
- **Type**: Geist for UI and numerals, Geist Mono for SAP identifiers only, self-hosted from `app/_fonts`
  (`app/fonts.ts`). Sentence case. Never a middle dot (U+00B7) anywhere under `frontend/`; a test fails on it.
- **Localisation**: every user-visible string goes through `lib/v2/i18n` (`t`, `tn`, `lc`) with English, German and
  Japanese entries; `node scripts/i18n-extract.mjs` must report 0 untranslated, 0 missing, 0 gaps.
- **Codes show their text**: in any table, every code (rule, field, value, record, plant) shows its description beside it.
- **Fixture mode**: `?fixture=1` answers every read from `lib/api/v2/fixtures`; tests, recordings and the e2e specs
  run on it.
- **Navigation**: every screen is reachable from the five sections or from a link on a screen that is. Old URLs
  redirect permanently (`next.config.ts`, table in `docs/guide/redirects.md`, checked by `__tests__/legacy-redirects.test.ts`).
- **Aletheia** is a chat scoped to the open object, with evidence and action chips, never a fixed screen. Violet
  (`--mx-aletheia*`) belongs to it alone.
- **Help**: chapters in `docs/guide`, index built by `npm run help:index`; every route under `app/(app)` must map to a
  chapter (`lib/v2/help.test.ts`).

## Token roles

Pick a token by its role, never by how it looks. Every role has a light value and a dark value, so a screen
that uses roles is correct in both themes.

| Role | Tokens | Use for |
| --- | --- | --- |
| Page and surfaces | `--mx-bg`, `--mx-surface`, `--mx-surface-2` | the page behind everything; cards, sheets and tables; a quiet inset such as a table header or a code block |
| Lines | `--mx-border`, `--mx-border-strong` | hairlines between rows and around cards; the edge of an input or a selected row |
| Ink | `--mx-ink`, `--mx-ink-2`, `--mx-ink-3` | headings and values; body text; captions, axis labels and placeholders. All three pass 4.5:1 on every surface |
| Accent | `--mx-accent`, `--mx-accent-soft`, `--mx-focus` | the one primary action, links and the selected item; its soft fill behind a selected row; the focus ring |
| Status | `--mx-good`, `--mx-warn`, `--mx-bad` and their `-ink` pairs | the outcome of something: a run that passed, a check that needs attention, a failure. Use the `-ink` pair for text on a soft fill |
| Severity | `--mx-sev-critical`, `--mx-sev-high`, `--mx-sev-medium`, `--mx-sev-low` | rule severity only, always beside its word (Critical, High, Medium, Low), never colour alone |
| Data | `--mx-data`, `--mx-chart-1` to `--mx-chart-3` | a single measure in a chart; the series of a chart with two or three series, in that order |
| Aletheia | `--mx-aletheia`, `-ink`, `-on`, `-soft`, `-edge` | the Aletheia chat, its launcher and its evidence chips. Nothing else is violet |
| Overlay | `--mx-scrim`, `--mx-glass` | the dimmed page behind a sheet or dialog; the translucent top bar. Glass is for floating chrome only, content sits on solid surfaces |

Status and severity are different questions. Status says how something ended; severity says how much a rule matters.
Never colour a severity with a status token or the reverse.

## Type scale

One family, Geist, at six sizes. Use the size for the job and do not invent sizes in between.

| Token | Size | Line | Use for |
| --- | --- | --- | --- |
| `--mx-fs-display` | 36px | | the one large number on a score or a home card |
| `--mx-fs-h1` | 28px | `--mx-lh-h1` | the page title in `PageHeader`, once per page |
| `--mx-fs-title` | 17px | `--mx-lh-title` | card, sheet and section titles |
| `--mx-fs-body` | 15px | `--mx-lh-body` | body text, table cells, inputs and buttons |
| `--mx-fs-small` | 13px | `--mx-lh-small` | captions, hints, table headers and chip text |
| `--mx-fs-micro` | 11px | | axis ticks and counts inside a badge only |

Weights are `--mx-w-label` (500) for labels and buttons and `--mx-w-heading` (600) for headings. Numbers in tables
and tiles use tabular figures so columns line up. SAP identifiers (field names, table names, rule codes) use
Geist Mono through `FieldChip`, always with their description beside them.

## Space, size and shape

Spacing is a 4px grid: `--mx-s1` 4px, `--mx-s2` 8px, `--mx-s3` 12px, `--mx-s4` 16px, `--mx-s5` 24px, `--mx-s6` 32px.
Inside a component use `s1` to `s3`; between components in a card use `s4`; between cards and sections use `s5` or
`s6`. The page gutter is `--mx-gutter` (16px), the same on phone and desktop.

Every control (button, input, select, chip row) is `--mx-h-control` (36px) high, so controls line up in a row.
Corners are `--mx-r-control` (8px) for controls, `--mx-r-card` (14px) for cards and sheets, and `--mx-r-pill` for
pills, badges and the primary button.

## Elevation and overlays

There are two levels and no others. `--mx-elev-1` is a hairline lift for cards that sit on the page. `--mx-elev-2`
is for things that float above the page: sheets, menus, the command palette and toasts. A floating layer always has
`--mx-scrim` behind it when it takes focus (sheet, dialog, palette) and none when it does not (menu, toast).

## Motion

One duration, `--mx-dur` (140ms), and one curve, `--mx-ease`. Motion explains a change of place: a sheet sliding in,
a row expanding, a tab underline moving. It never decorates, never loops and never delays content. Under
`prefers-reduced-motion: reduce`, `tokens.css` sets `--mx-dur` to zero and turns off the kit transitions, so a component that times its motion with `--mx-dur` needs no check of its own.

## Choosing a component

- A place the person goes to is a route with a `PageHeader`; a task the person does is a `Sheet`. If it has a
  Save or a Run button and ends, it is a sheet.
- A list of things to pick and inspect is `Split` with a `MasterList` or `DataTable` on the left and a `DetailPanel`
  on the right. A list to scan, sort or export with no detail is a full-width `DataTable`.
- A single headline number is a `StatTile`; a quality score is a `ScoreRing`; source against target quality is a
  `DqsPair`. A ranking is a `BarList`; a change over time is a `TrendArea`; a range with a band is a `BandChart`.
- Filters are `Chip` rows above the list, with the count on each chip. Up to five views of one thing are `Tabs`;
  more than five means the screen should split.
- One `primary` `Button` per view at most. Destructive actions go through `Confirm` with `danger`, and an action
  that can be undone uses `UndoToast` instead of a confirm.
- A code is never bare: use `FieldChip` with its description.
- Anything Aletheia says opens in the one shared chat through `useAletheia()`; never mount a second chat.

## States

Every screen that loads data handles four states with the kit parts, never with a bare spinner or blank space.

- **Loading**: `Skeleton` in the shape of what is coming.
- **Empty**: `EmptyState` with a heading that says what is missing and an action that fixes it (connect a system,
  start a run, upload a file).
- **Error**: `ErrorState` with what failed in plain words and a retry. Never show a raw status code or stack.
- **Done**: the content. A long job shows progress with `Hairline`, and its result arrives as a toast with a link.

Focus is always visible (`--mx-focus`), every control is reachable by keyboard, and every chart has a text label
so a screen reader can read the same numbers.

## Keyboard

`Cmd` or `Ctrl` plus `K` opens the command palette. `g` then a letter jumps: `h` Home, `w` Work, `l` Load, `r` Runs,
`m` More, `u` Rules, `c` MDM, `k` Insights.
