# Meridian design system: one map, one canvas, one inspector

Source of truth for the visual layer. Values live in `frontend/design/v2/tokens.css`, the only file of the interface
that may hold colour, shadow or motion literals. When this file and the code disagree, the code is right and this file
needs updating. The guide for people who use the product is `docs/guide` (start with `overview.md`); the concept the
interface was built from is summarised in section 1.

Since the cut-over (Meridian 2, step 7) this is the only interface. The library of the retired one (`design/primitives`,
`design/shell`, `design/charts`, `design/table`, `design/templates`, `components/`) was removed with it; what stays of
`design/` outside `design/v2` is `design/tokens.css` (the root layout's base, the Aletheia attribution strip and the
global error page), `design/global-error.css` and `design/brand` (the Open Graph image, the Apple icon and the
attribution).

## 1. Direction

Every SAP system, object, rule, record, run and person is a place on the map; everything that needs a person is a line
in the ledger; anything you select opens in the same inspector. There is no menu of pages.

1. **The map** (left, `--m2-map-w` 280px): Landscape, Work, Runs and People at the top, then each connected system with
   its objects. Each object row carries its score as a number and a small ruler, and the records to fix only where
   there is work. On a phone the map is a sheet opened from the top bar. Administration has its own index in the same
   place (`design/v2/admin/Admin.tsx`).
2. **The canvas** (middle): the place chosen on the map. Landscape (`/`), an object (`/o/{system}/{object}` and its
   tabs), a rule (`/r/{id}`), the Work ledger (`/work`), the runs (`/runs`), one run (`/run/{id}`) and two runs
   (`/run/{a}/vs/{b}`), a system (`/s/{id}`, `/s/new`), People, Reports, the rules library (`/rules`) and
   Administration (`/admin`, `/admin/{section}`).
3. **The inspector** (right, `--m2-insp-w` 400px): whatever is selected, written in the address as `?open=kind:id`
   (`lib/v2/hooks.ts` `parseOpen`). Always the same order: title, status line, facts, actions, history. `Esc` closes
   it. The bare panels (`?open=inbox`, `help`, `preferences`, `waves`, `triage`, `contracts`, `balance`, `away`) use the
   same frame.
4. **The top bar** (`--m2-bar-h` 48px): the scope, the run you are reading (the run timeline), the command line (`⌘K`
   or `/`), the inbox count, help (`?`) and the account menu with Preferences, Reports and, for administrators,
   Administration. Jobs show as one thin line under the bar, never as a tray.
5. **The score is a ruler**, never a gauge: six segments whose widths are the dimension weights, each filled to its
   score, a tick at the measured score, the shown (capped) score as the number and the cap said in words
   (`design/v2/Ruler.tsx`). The same ruler at 48px in every map row and matrix cell.
6. **Plain speech and honest states.** Zeros as 0; unknown as a grey dash with the reason on hover (`Dash`); a system
   never extracted keeps its row with "Not extracted yet" and its one action; an empty place says what would fill it
   and offers the one action (`EmptyFrame`); a failure says what failed with Retry (`ErrorFrame`); loading is a
   skeleton in the final geometry (`Skeleton`). Nothing is estimated by a language model: every figure is a rule
   result over stored data, and each has an explanation of its arithmetic (`Explain`).

## 2. Tokens

All in `design/v2/tokens.css`, scoped to `.m2-root`; light on the root, dark under `prefers-color-scheme: dark` and
under `html[data-theme="dark"]`.

### Colour

Colour is quiet by default and spent on meaning. Three layers, all in `tokens.css`:

1. **Two ramps.** The neutral ramp `--m2-n-0` to `--m2-n-950` is one cool slate (OKLCH hue 240, chroma under 0.025);
   the Meridian blue ramp `--m2-b-50` to `--m2-b-950` is hue 263, and step 700, `#1B3F8F`, is the brand blue of the
   mark. Each step is darker than the one before (the test checks it). Nothing else in the interface is a neutral or a
   blue of its own.
2. **Semantic tokens** name a ramp step per theme, so dark is chosen, not inverted:
   - **Ground and ink**: `--m2-bg` (light: a whisper of slate, `n-25`; dark: `n-950`), `--m2-sheet` (white; `n-925`),
     `--m2-line`, `--m2-line-2`, `--m2-rule`, `--m2-fg`, `--m2-ink-2`, `--m2-ink-3`, `--m2-meta`, `--m2-hover`,
     `--m2-active`, `--m2-track`, `--m2-seg`. The map and the top bar sit on the ground; the canvas and the inspector are
     white sheets on it, divided by 1px rules. No shadow except for what floats.
   - **One data hue**: `--m2-data` (`b-700`; `b-300` in dark) with `--m2-on-data` and the selection wash `--m2-data-bg`.
     It marks the selected cell, the current run, links, the focus ring and the next-step button, the one strong control
     of a canvas.
   - **Semantic colours**, each a mark colour, a wash (`-bg`) and the text on the wash (`-ink`): `--m2-pass` (Go, Done,
     Fixed), `--m2-warn` (At risk, High, a warning), `--m2-fail` (No-go, Failed, an error), `--m2-crit` (Critical) and
     `--m2-info` (a neutral notice). Fail and critical share the stop red on purpose: two reds in one ledger read as a
     difference that is not there; critical adds the square mark. `--m2-high` is kept as the name of the warn hue the
     screens were written with. A status hue always comes with a shape (`VerdictMark`, `SeverityMark`) and a word,
     never alone. A notice is a wash with its ink, never a coloured left border.
3. **Chart colours** (used only by `design/v2/charts`): `--m2-chart-1` to `--m2-chart-8`, a categorical set in a fixed
   order (blue, orange, teal, ochre, violet, green, magenta, cyan); `--m2-seq-1` to `--m2-seq-5`, the blue ramp as a
   sequential scale; `--m2-sev-crit`, `-high`, `-med`, `-low`, the ordinal severity scale (stop red, warn amber, two
   receding neutral steps); and the chrome `--m2-chart-grid`, `--m2-chart-axis`, `--m2-chart-text`,
   `--m2-chart-line`, `--m2-chart-area`, `--m2-chart-quiet`.

Every pair a screen draws is measured by `design/v2/__tests__/tokens.test.ts` in light and dark: text, data and status
at 4.5:1 or better on every ground it sits on (WCAG 1.4.3), marks, the focus ring and chart fills at 3:1 (WCAG 1.4.11).
The categorical palette is held to colour-vision checks: neighbours at least 8 apart (OKLab x100) under simulated
protanopia and deuteranopia and 15 apart for full colour vision, the first three apart on every pair, each hue inside
the lightness band of its theme. The measured values:

| Pair | Light | Dark |
|---|---|---|
| ink on ground | `#151A1E` on `#F7F9FB`, 16.60 | `#E6EBEF` on `#0E1215`, 15.68 |
| ink on sheet | `#151A1E` on `#FFFFFF`, 17.52 | `#E6EBEF` on `#151A1E`, 14.60 |
| secondary ink on sheet | `#3E4A53`, 9.09 | `#A9B3BB`, 8.22 |
| meta on sheet, on ground | `#59646C`, 6.06 and 5.74 | `#8C979F`, 5.88 and 6.31 |
| data hue on sheet, on its wash | `#1B3F8F`, 9.75 and 9.00 | `#8EB1F5`, 8.14 and 7.47 |
| text on the data hue | `#FFFFFF`, 9.75 | `#08152F`, 8.42 |
| pass on sheet, ink on wash | `#1D6B3F`, 6.51; 8.28 | `#74C291`, 8.23; 9.45 |
| warn on sheet, ink on wash | `#8F5200`, 6.22; 8.73 | `#DDA44A`, 7.91; 9.26 |
| fail and critical on sheet, ink on wash | `#A3221A`, 7.50; 8.98 | `#F0877F`, 7.07; 8.74 |
| info on sheet, ink on wash | `#2E5C8A`, 6.97; 9.18 | `#7FB3E8`, 7.94; 9.84 |
| chart 1 to 8 on sheet | `#406FD1` 4.76, `#C65A1E` 4.30, `#0F8A78` 4.26, `#A87600` 4.00, `#7559C7` 5.24, `#4D7F1A` 4.81, `#1F7FAE` 4.46, `#B8487E` 4.92 | `#648FE7` 5.53, `#D06A30` 4.83, `#1E9C88` 5.15, `#B98A1C` 5.60, `#8C70DE` 4.58, `#5F962A` 4.91, `#2E94C8` 5.16, `#CC5A93` 4.55 |
| severity medium, low on sheet | `#6B767E` 4.65, `#A9B3BB` 2.13 (an ordinal end, 2:1 floor; the count is in the legend) | `#8C979F` 5.88, `#59646C` 2.89 |
| sequential faint end on sheet | `#8EB1F5`, 2.15 (2:1 floor for an ordinal end) | `#2A54B0`, 2.50 |

Worst categorical neighbours: 9.6 under colour-vision simulation, 17.2 for full colour vision, in both themes.
Before and after screenshots of the refresh are in `docs/design-refresh.md`.

### Type, space, motion

- **Type**: IBM Plex Sans for words and figures (`--m2-font`, tabular figures), IBM Plex Mono for SAP identifiers only
  (`--m2-mono`: check ids, `TABLE.FIELD`, record keys, run ids). Both self-hosted from `app/_fonts`. Scale
  12/13/14/16/20/24 (`--m2-fs-*`, `--m2-lh-*`). Sentence case everywhere.
- **Space and shape**: `--m2-s1` to `--m2-s10` on a 4px grid, radii `--m2-r1` 4px and `--m2-r2` 6px, the shadow
  `--m2-shadow` only for what floats (menus, the inspector on a phone).
- **Density**: two modes, a preference in the Preferences panel saved with the theme and the language (server and this
  browser). Comfortable: grid rows `--m2-row-h` 36px, list rows 40px, map and fact rows 32px, 12px cell sides, 14px row
  text. Compact: 28, 32, 28 and 26px, 8px sides, 13px text. Until a person chooses, the role decides: compact for a
  data steward and SAP Basis, comfortable for the programme lead, the data owner and everyone else
  (`lib/v2/density.ts`). The shell root carries `data-density` and the tokens under it; the virtual grid measures with
  the same heights (`ROW_H`, held to the tokens by the test), and a ledger may keep its own density in its address or a
  saved view (Work, `?density=`).
- **Motion and feedback**: `--m2-t-fast` 150ms for a state (hover, press, a chart part), `--m2-t-med` 200ms for an
  arrival, `--m2-t-pulse` 1600ms for a placeholder's breath, `--m2-ease` (exponential ease-out) and `--m2-ease-loop`
  for what loops, `--m2-rise` 6px for how far an arrival travels. Declared in the last section of the tokens file only.
  Three things arrive: the inspector from the right, a menu from where it opens, a notice from below; arrivals move
  but do not fade, so text is at full contrast from the first frame. Buttons, rows, fields and menu items ease their
  colour and border. Loading is a placeholder in the final geometry that breathes (`CanvasSkeleton` for a canvas,
  including `app/(v2)/loading.tsx`; `InspectorSkeleton` for an inspector body; `Skeleton` inside a block). A notice
  (`Toast.tsx`) waits while the pointer or the keyboard is on it, carries a check when it reports a change with Undo
  and a red mark when it is an error. Every focusable thing shows the one focus ring (`--m2-focus`, 2px). Under
  `prefers-reduced-motion` nothing moves.
- **Tenant theme**: a tenant may set its accent, logo and name (Administration, Settings, Appearance). The form shows the
  accent's contrast and, below 4.5:1, the nearest shade of it that passes, with a button to use it; the server refuses
  to save a failing accent. `themeRootProps` (`lib/v2/theme.ts`) puts the accent on the root and clamps it whatever was
  stored: on the light ground the first darker shade that reads at 4.5:1, on the dark ground the first lighter tint
  that does. The selection wash and the text on the accent follow it, so a tenant's colour changes the hue of the
  interface but never its legibility.

## 3. Components

All under `design/v2`. Screens compose these and draw nothing of their own.

- **Shell** (`shell/V2Shell.tsx`, `TopBar.tsx`, `MapPane.tsx`, `StatusStrip.tsx`, `Standalone.tsx`): the gate
  (`auth/Guard.tsx`: session check, the forced password change), the permissions provider, the request for access
  (`RequestAccess.tsx`), the top bar, the map, the canvas, the inspector, the job line and the toasts. Pages that stand
  without the shell (the status page, the signed-out pages, not found) use `StandaloneRoot`.
- **Signed-out pages** (`auth/AuthFrame.tsx`): two columns on the slate ground. On the left the tenant's mark and name,
  the one sentence of what the product does, three facts in plain words and the ruler drawn as the brand's picture (six
  segments as wide as their weights, the tick across them; decorative). On the right one white card, lifted by
  `--m2-shadow-card`, with the page's h1, the form and the version under it. On a phone: the mark, the card, then the
  facts. The Aletheia attribution strip stays under every page (root layout).
- **First run**: an empty tenant's landscape is a stepper of three steps (`FirstSteps`: connect or upload, run, read),
  joined by a rule, the current step open with the canvas's one strong button and "Step 1 of 3" beside the heading. A
  person's first visit to a populated landscape opens with the welcome (`screens/Welcome.tsx`): the map, the canvas and
  the inspector in one line each, the keys, the help, and Got it, kept in the person's preferences (`tours_done`) so it
  never returns. In fixture mode it shows only with `?welcome=1`; `?landscape=empty` shows the empty tenant.
- **Inspector** (`Inspector.tsx`): `InspectorFrame`, `Facts`/`Fact`, `Actions`; the panels are in `inspector/` and
  registered in `inspector/registry.tsx`.
- **Grid** (`Grid.tsx`, `GridTools.tsx`): every ledger and list. Virtualised (100,000 rows stay smooth), keyboard rows,
  selection and bulk actions, columns chosen and saved as a view, export to Excel with the visible columns.
- **Ruler** (`Ruler.tsx`), **marks** (`marks.tsx`: `VerdictMark`, `SeverityMark`, the icons, the `Mark`), **parts**
  (`parts.tsx`: `V2Link` keeps fixture mode, `Mono`, `Dot`, `Dash`, `EmptyFrame`, `ErrorFrame`, `Skeleton`,
  `PageTitle`), **forms** (`forms.tsx`: `Field`, `ConfirmBar`, `Gate`), **Menu** (`Menu.tsx`), **Toast** (`Toast.tsx`,
  with Undo only where the API has a real inverse), **CommandLine**, **ShortcutSheet** (drawn from the key registry
  `lib/v2/keys.ts`), **RunTimeline**, **Explain**.
- **Administration kit** (`admin/kit.tsx`): `AdminPage`, `Block`, `Fld`, `Dialog`, `Confirm`, `NeedsPermission`,
  `StatusWord`.

### Charts

One grammar for every chart, in `design/v2/charts` (styles in `design/v2/charts.css`). A screen passes values and
words; the chart draws. Never a chart of a screen's own.

| Component | What it shows | Where |
|---|---|---|
| `TrendChart` | A value over runs: a 2px line in the data hue over a 10% wash, the last value named at the end beside a ringed end dot, reference levels dashed and named, one marked run as a 1px rule | Object, Runs tab (`ScoreChart`, the 60 to 100 score scale every object shares) |
| `Sparkline` | The trend in a row: a 1.5px line in the quiet ink, the latest as a dot in the data hue, no axis | The map (under each object's ruler, one scale per system), the rule inspector's history |
| `StackedBar` | One whole in parts: a 12px bar, parts separated by 2px of sheet, never by strokes; the legend under it carries each part's mark, word and count | Run, findings by severity (`severityParts`); `verdictParts` for objects by verdict |
| `Distribution` | How values spread: columns of a count per bin, at most 24px wide, data end rounded, foot square; the verdict bands as named dashed hairlines | Run, objects by measured score |
| `SmallMultiples` | Many trends side by side on one shared scale, each panel with its name and last value | Runs, objects over the last runs |
| `DeltaBar` | A change either side of zero inside a table row, the signed number beside it | Compare two runs |

The frame (`ChartFrame`) is the same for all: the title and a one-line reading above, the plot, the legend when there
are two series or more, and one state at a time (loading as a flat placeholder at the plot's height, empty saying what
would fill it, error saying what failed with Retry). Every chart has a text alternative: its figures as a table behind
"Show the figures" (`ChartTable`), or, for a sparkline, an accessible name with the first and last value. The plot is an
image with a name and is focusable: the arrow keys, Home and End step through the points, Escape leaves, and a polite
live region and a tooltip on the inverse ground read the point in focus; the pointer does the same. Axes are hairlines
one step off the sheet (`--m2-chart-grid`), the baseline one step stronger (`--m2-chart-axis`), the axis text 12px in
`--m2-chart-text` with tabular figures, ticks on round values. Text never wears a series colour. Light and dark come
from the tokens alone.

### Status vocabulary

Verdicts **Go**, **At risk**, **No-go** (from the score bands and the cap); severities **Critical**, **High**,
**Medium**, **Low** (square, triangle, circle, ring); record states **To fix**, **Fix proposed**, **Waiting for
approval**, **Approved**, **Sent to SAP**, **Fixed**, and the exceptions **Not an issue** and **Accept risk**; jobs
**Queued**, **Running**, **Done**, **Failed**. Each value has one label and one mark (`lib/v2/labels.ts`,
`lib/v2/status.ts`).

## 4. Words

Every visible string goes through `t()` from `lib/v2/i18n` and has an English, German and Japanese entry;
`node scripts/i18n-extract.mjs` (and its test) fails on an untranslated literal, a missing key or an empty
translation. No U+00B7 anywhere (a test fails); a separator is drawn by CSS (`Dot`). Model-written text is labelled in
words above it. Object names come from `formatModuleName` (`lib/format.ts`), never from title-casing an id.

## 5. Routes

| Address | Canvas |
|---|---|
| `/` | Landscape (`?view=waves` the waves view) |
| `/o/{system}/{object}` and `/rules`, `/records`, `/fixes`, `/runs`, `/readiness`, `/processes`, `/processes/design`, `/lineage`, `/glossary`, `/golden` | An object and its tabs; `_` as the system means "the system that holds it" |
| `/r/{id}` | A rule across objects |
| `/rules` | The rules library (`?view=drafts`) |
| `/work` | The Work ledger (`?filter=`, `module`, `rule`, `severity`, `assigned`, `due`, `batch`) |
| `/runs`, `/run/{id}`, `/run/{a}/vs/{b}` | Runs and jobs, one run, two runs |
| `/s/{id}`, `/s/new` | A system (`?tab=`), connect a system |
| `/people`, `/reports` | People, Reports |
| `/admin`, `/admin/{section}` | Administration |
| `/share/{token}` | A read-only shared view |
| `/status` | The status page (signed out and signed in) |
| `/sign-in`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/licence-error` | Signed out |

`?fixture=1` on any page answers every read from `lib/api/v2/fixtures` (tests, recordings, demos) and puts the "Demo
data" bar at the top of every page; a production build honours it only when built with `NEXT_PUBLIC_MERIDIAN_DEMO=1`
(the e2e web server and the recordings set it, a customer image never does). `?open=kind:id` opens the inspector. Every address of the retired interface and of `/v2` redirects permanently (`next.config.ts`,
table in `docs/guide/redirects.md`, asserted by `__tests__/legacy-redirects.test.ts` and `e2e/redirects.spec.ts`).

## 6. Guardrails

- `npm run lint:tokens` rejects raw hex, gradients, backdrop blur, ad hoc shadows, motion and duration literals and
  all-caps text outside the token files. `scripts/lint-tokens.allow.txt` holds no entries. Never add a line to it.
- `npm run lint` runs `eslint . --max-warnings 0`; no `any`; no inline style in `app/`.
- `npm run check:contrast` gates the colour pairs of `design/tokens.css`; the v2 pairs and the chart palette are
  checked by `design/v2/__tests__/tokens.test.ts` in light and dark.
- `e2e/v2-a11y.spec.ts` runs axe (WCAG 2.1 A and AA) on every page in English, German and Japanese, light and dark;
  `e2e/redirects.spec.ts` does the same for the pages outside the shell. Fix a failure in the component or the
  tokens, never with an axe rule exclusion.
- Reduced motion turns off every animation. Focus rings always show.
