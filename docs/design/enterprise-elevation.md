# Enterprise elevation of "The line"

Status: design spec, 23 Nov 2026. Preview: `docs/design/enterprise-elevation-preview.html`.
Scope: `frontend/ui/` only. No backend change is required by this spec except where a gap is named in section 14.

The request, verbatim: "the frontend needs a massive enterprise scale global platform look and feel", followed by "everything should have a process stepper to make it easy and exports and imports should work".

## 1. Direction in one page

The line stays. The score ruler with its 70 and 85 gates, the Aletheia dock, the five places (Home, Objects, Clean, Load, Monitor) and light mode by default are unchanged. What changes is the frame around them. Today the product reads as a well-made single-team tool: one centred 80rem column, large rounded cards, pill navigation, 36px controls, a single-initial avatar. A global platform reads differently, and the difference is seven things:

1. **Context is always on screen.** Which tenant, which system, which environment (PROD or QA), which time zone, which run. A user at Komatsu who has production ECC and a sandbox S/4HANA open in two tabs must never have to guess.
2. **Density.** 13px body, 32px controls and rows, 8px card radius, hairlines in place of shadows. More rows and more numbers per screen, with the same legibility.
3. **Full width.** Content fills the window up to 1680px. Tables and charts use the space; prose stays capped at 72ch.
4. **One page skeleton.** Breadcrumbs, title with status, meta row, process stepper, actions, KPI strip, then content. Every route uses it.
5. **Tables that behave like a product.** Column controls, saved views, multi-select with bulk actions, a footer with counts and paging, export from the toolbar.
6. **Process steppers on every multi-step journey**, in the page header, with done, current, blocked and error states.
7. **Exports and imports as a designed pattern**: the format, the scope and the progress are always stated, and the result is always recorded.

Rules that do not move: violet is Aletheia only. Cobalt is action and primary data. Red, amber and green are status only and never a chart series. Every code shows its text beside it. No raw hex, no gradients, no U+00B7, every string through `t()` in en, de and ja.

## 2. Token changes

All in `frontend/ui/tokens.css`. Names are unchanged unless marked NEW. Both dark blocks (`html[data-theme="dark"] .mx-root` and the `prefers-color-scheme` block) get identical values. `lint-tokens.allow.txt` stays empty.

### 2.1 Type

| Token | Now | New | Note |
| --- | --- | --- | --- |
| `--mx-fs-micro` | 0.6875rem | 0.6875rem | unchanged; column headers, badges |
| `--mx-fs-small` | 0.75rem | 0.75rem | unchanged; meta, captions |
| `--mx-fs-body` | 0.875rem | 0.8125rem | 13px |
| `--mx-fs-title` | 1.0625rem | 0.9375rem | 15px card and section titles |
| `--mx-fs-h1` | 1.75rem | 1.375rem | 22px page title |
| `--mx-fs-display` | 2.25rem | 1.75rem | 28px KPI values |
| `--mx-fs-score` | 4.5rem | 3.5rem | 56px hero score |
| `--mx-lh-small` | 1.25rem | 1rem | |
| `--mx-lh-body` | 1.375rem | 1.25rem | |
| `--mx-lh-title` | 1.5rem | 1.375rem | |
| `--mx-lh-h1` | 2.25rem | 1.75rem | |
| `--mx-w-label` | 500 | 500 | unchanged |
| `--mx-w-heading` | 600 | 600 | unchanged |

Japanese: under `.mx-root:lang(ja)` set `--mx-fs-body: 0.875rem`, `--mx-lh-body: 1.5rem`, `--mx-lh-small: 1.25rem`. Kanji at 13px with 20px leading is too tight. Row heights do not change; they are set by `--mx-h-row`.

Font stacks: keep Geist and Geist Mono first. Append `"Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Meiryo"` before the generic family so Japanese glyphs do not fall to a serif. All numbers in tables, KPI tiles and rulers use `font-variant-numeric: tabular-nums`.

No uppercase with letter-spacing anywhere. It does not exist in Japanese and reads as shouting in German. Column headers are sentence case, `--mx-fs-micro`, weight 500, `--mx-ink-3`.

### 2.2 Density and spacing

| Token | Now | New |
| --- | --- | --- |
| `--mx-s1` to `--mx-s6` | 4, 8, 12, 16, 24, 32px | unchanged |
| `--mx-gutter` | `var(--mx-s4)` | unchanged (inside cards) |
| `--mx-h-control` | 36px | 32px |
| NEW `--mx-h-row` | (DataTable prop 40) | 32px |
| NEW `--mx-h-bar` | (56px hard-coded) | 48px global bar |
| NEW `--mx-h-subbar` | none | 40px section tabs and breadcrumb row |
| NEW `--mx-page-gutter` | none | 24px; 16px under 48rem |
| NEW `--mx-page-max` | (80rem hard-coded) | 105rem (1680px) |
| NEW `--mx-prose-max` | none | 72ch |

Density switch: `.mx-root[data-density="comfortable"]` sets `--mx-h-row: 40px; --mx-h-control: 36px`. Default is compact. The choice is a user preference stored through the existing `usePreferencesSync`. Touch pointers (`@media (pointer: coarse)`) always get comfortable, so targets stay at 40px or more.

### 2.3 Radius

| Token | Now | New |
| --- | --- | --- |
| `--mx-r-chip` | 6px | 4px |
| `--mx-r-control` | 10px | 6px |
| `--mx-r-card` | 16px | 8px |
| `--mx-r-pill` | 999px | unchanged; status pills, chips and the Aletheia dock only |

Section navigation stops being pills (see 3.2). Buttons use `--mx-r-control`.

### 2.4 Elevation

Three levels. Cards on the page have no shadow at all: a 1px `--mx-line` border on `--mx-sheet` over `--mx-paper`.

| Token | Now | New | Used for |
| --- | --- | --- | --- |
| `--mx-elev-1` | two-layer 1px/2px | `0 1px 0 rgb(15 17 21 / 4%)` | sticky bars, sticky table header |
| `--mx-elev-2` | `0 8px 24px rgb(15 17 21 / 14%)` | `0 4px 12px rgb(15 17 21 / 10%), 0 0 0 1px rgb(15 17 21 / 6%)` | menus, popovers, bulk-action bar |
| NEW `--mx-elev-3` | none | `0 16px 48px rgb(15 17 21 / 18%), 0 0 0 1px rgb(15 17 21 / 8%)` | sheets, dialogs, command palette |
| `--mx-elev-dock` | violet glow | unchanged | Aletheia dock only |

Dark: same geometry on `rgb(0 0 0 / 40%)`, `/ 50%`, `/ 60%` with the ring at `rgb(255 255 255 / 8%)`.

### 2.5 Colour roles

Surface, ink, cobalt, status, severity and violet values are unchanged. They already pass `check:contrast` and the look moves through structure, not hue. Additions are aliases only, so no new raw colours enter for roles:

| NEW token | Value | Role |
| --- | --- | --- |
| `--mx-env-prod` / `--mx-env-prod-soft` | `var(--mx-bad-ink)` / `var(--mx-stop-soft)` | PROD badge text and fill |
| `--mx-env-qa` / `--mx-env-qa-soft` | `var(--mx-warn-ink)` / `var(--mx-watch-soft)` | QA and sandbox badge |
| `--mx-env-dev` / `--mx-env-dev-soft` | `var(--mx-ink-2)` / `var(--mx-well)` | DEV, fixture and demo badge |
| `--mx-row-hover` | `var(--mx-well)` | table row hover |
| `--mx-row-selected` | `var(--mx-cobalt-soft)` | selected row |

Measured contrast of the badge pairs in light: PROD 6.18, QA 6.89. Add both pairs, in both themes, to `scripts/check-contrast.mjs`.

### 2.6 Data palette

Today `--mx-chart-2` aliases a severity colour and `--mx-chart-3` aliases status green, so a three-series chart looks like a status chart. Replace with a categorical palette that never touches red, amber, green or violet:

| Token | Light | Dark | Name |
| --- | --- | --- | --- |
| `--mx-chart-1` | `var(--mx-cobalt)` | `var(--mx-cobalt)` | cobalt (primary series, unchanged) |
| `--mx-chart-2` | #0B7285 | #3FC1D0 | teal |
| `--mx-chart-3` | #A8327A | #E07AB8 | magenta |
| NEW `--mx-chart-4` | #7A4B2A | #C9966B | brown |
| NEW `--mx-chart-5` | #5E6572 | #A3ABBA | slate |
| NEW `--mx-chart-6` | #6B7A1F | #B5C45A | olive |
| NEW `--mx-chart-grid` | `var(--mx-line)` | same alias | grid lines |
| NEW `--mx-chart-axis` | `var(--mx-ink-3)` | same alias | axis text |

Every series colour measures at least 4.0:1 on `--mx-well` and 4.7:1 on `--mx-sheet` in light, and at least 5.9:1 on every dark surface, so labels may be drawn in the series colour. Six is the ceiling. A chart with more than six series groups the tail into "Other" in `--mx-chart-5`. The red `--mx-heat-1..8` ramp stays and is used only for risk heatmaps.

Before changing `--mx-chart-2` and `--mx-chart-3`, grep for their uses. Any chart that relied on chart-2 meaning "high severity" or chart-3 meaning "good" switches to the `--mx-sev-*` or `--mx-go` token it actually meant.

## 3. Shell

Two fixed tiers, 88px total, then the page. `AppShell` keeps its current props and gains `context`, `environment`, `locale` and `crumbs`.

```
+----------------------------------------------------------------------------------------------+
| [M] Meridian | Komatsu / ECC production, client 100 v | PROD |   [ Search or jump to   Ctrl K ] |
|                                    Healthy   [bell 3]   EN  SAST UTC+02:00   [Ask Aletheia] [TM] |
+----------------------------------------------------------------------------------------------+
| Home  Objects  Clean  Load  Monitor  |  More v              Objects / Material master / Records |
+----------------------------------------------------------------------------------------------+
```

### 3.1 Global bar (`--mx-h-bar`, `--mx-sheet`, bottom hairline)

Left to right:

- **Brand.** Glyph and "Meridian", link to Home.
- **Context switcher** (NEW `kit/ContextSwitcher.tsx`). A button showing tenant, then system with its client or data centre: "Komatsu / ECC production, client 100". It opens a popover with two lists: tenants the user belongs to (hidden when there is one) and connected systems from the existing `/s` data, each with its type label from `systemTypeLabel`, its environment badge and its last-run time. A search field appears above eight entries. Choosing a system scopes Objects, Clean, Load and Monitor to it and is kept in the URL (`/o/[system]/...` already carries it; elsewhere a `?system=` parameter). "All systems" is the first entry and the default on Home.
- **Environment badge** (NEW `kit/EnvBadge.tsx`). A solid-bordered chip beside the switcher: `PROD`, `QA`, `DEV`. The three codes are the same in every language; the tooltip carries the translated long form ("Production system. Changes here reach live data."). PROD uses the `--mx-env-prod` pair, QA and sandbox the `--mx-env-qa` pair, fixture and demo the `--mx-env-dev` pair. When the scoped system is PROD the global bar also gets a 2px `--mx-stop` top edge, so the state is visible in peripheral vision. The environment comes from the system record. If the backend does not carry it, see gap G1; never infer PROD from a system name.
- **Search** (existing `mx-jump`). Centred, 22rem wide, opens the existing `CommandPalette`. The palette gains group headers (Go to, Objects, Rules, Records, Runs, Actions, Ask Aletheia), a recent list when empty, and a footer line with the key hints. The hint reads "Cmd K" on macOS and "Ctrl K" elsewhere.
- **Health word** (existing `HealthWord`). Status dot plus word.
- **Notifications** (replaces the text `InboxButton`). Bell icon button with a count badge; `aria-label` is `tn("{n} unread notifications")`. Opens a 24rem popover: tabs All, Mentions, Jobs; each row is icon, sentence, object or run chip, relative time with the absolute time on hover; "Mark all read" and "Open inbox" in the footer. Export and import jobs report here (section 9).
- **Locale and time zone** (NEW `kit/LocaleClock.tsx`). A quiet text button: `EN  SAST UTC+02:00`. It opens a popover with language (English, Deutsch, 日本語), time zone (browser, tenant, or a chosen IANA zone; `setFormatPrefs` and `setTenantTimezone` already exist), number and date format preview, theme (light, dark, system) and density (compact, comfortable). Hidden under 64rem; the same controls are then in the user menu.
- **Aletheia launcher** (existing). Violet-edged button, unchanged.
- **User menu.** Avatar with two initials. The menu header shows name, email, role and tenant; then Profile and preferences, Inbox, Platform status, View as a role, Keyboard shortcuts, Help, Sign out.

### 3.2 Section bar (`--mx-h-subbar`, `--mx-sheet`, bottom hairline)

- Left: the five sections as text tabs with a 2px `--mx-ink` underline on the active one (not pills). `aria-current="page"`. Then a divider and the existing More menu.
- Right: breadcrumbs for the current page (3.3). Under 64rem the breadcrumbs move into the page header, above the title.
- Under 48rem the section bar becomes a bottom tab bar with five icon-and-label items; the global bar keeps brand, environment badge, search icon, bell and avatar; the context switcher moves to the first row of the user menu sheet.

The chord map in `Frame.tsx` changes to the new places: `g h` Home, `g o` Objects, `g c` Clean, `g l` Load, `g m` Monitor, `g r` Runs, `g u` Rules, `g k` Insights, `g a` Admin. `?` opens the shortcuts sheet.

### 3.3 Breadcrumbs

NEW `kit/Breadcrumbs.tsx`: `<nav aria-label={t("Breadcrumb")}><ol>`. Items are links except the last, which is text with `aria-current="page"`. Separator is a `/` drawn in CSS (`::before`), never a character in a string. Rules:

- The trail is the place, not the click history: section, then object or parent, then page. Tenant and system are in the switcher and are not repeated.
- Codes carry their text: "MM003 Material type is mandatory".
- More than four items collapse the middle into a "..." menu button.
- A long last item truncates with an ellipsis and a `title`; the others never truncate.
- `PageHeader`'s `back` prop stays for phone width, where the trail collapses to the parent link.

### 3.4 Banners

Existing `Banners` and `FailedJobLine` stay, restyled as full-width 32px strips under the section bar with icon, sentence and one action. Order when several apply: offline, view-as, shared view, failed job. The sandbox banner is removed; the environment badge replaces it.

### 3.5 Main area

`.mx-main`: `max-inline-size: var(--mx-page-max)`, `padding-inline: var(--mx-page-gutter)`. Text blocks cap at `--mx-prose-max`. The Aletheia dock stays centred at the foot, 47.5rem wide. When the Aletheia panel is open as the aside it takes 26rem and the main area reflows; it never overlays a table.

## 4. Page header

`PageHeader` gains `crumbs`, `status`, `meta`, `stepper`, `tabs`. Layout, top to bottom:

1. Breadcrumbs (only under 64rem; otherwise they sit in the section bar).
2. Title row: `h1` at `--mx-fs-h1`, then an optional status pill, then actions right-aligned. One primary button at most; secondary buttons; everything else in an overflow `ActionMenu`. Export and Import live here when they act on the whole page.
3. Meta row, `--mx-fs-small`, `--mx-ink-2`, items separated by a 1px vertical rule with 12px either side: system with environment badge, run ("Run 8"), "As of 16 Oct 2026, 05:17 SAST", record count, owner. Maximum five items. This row is where every page states which data and which moment it shows.
4. Process stepper (section 8), when the page is part of a journey.
5. Tabs, when the page has them. Tabs sit on the header's bottom hairline.

The header is not sticky. The tabs row becomes sticky under the shell when scrolled past, carrying the title in small text on its left.

## 5. KPI strip

NEW `kit/KpiStrip.tsx`, replacing rows of separate `StatTile` cards. One card, 4 to 6 cells, divided by vertical hairlines. Each cell:

- Label: `--mx-fs-small`, `--mx-ink-2`, sentence case.
- Value: `--mx-fs-display`, weight 600, tabular numerals, formatted by `formatInt`, `formatCompact`, `formatPct`, `formatMoneyCompact` or `formatScore`. Money always shows its currency code.
- Delta: arrow icon plus signed value plus the comparison in words ("+1.4 since run 7"). Colour is `--mx-good-ink` or `--mx-bad-ink` only when the direction has a meaning; otherwise `--mx-ink-2`. The arrow and sign carry the meaning without colour.
- Optional 64 by 20px sparkline in `--mx-chart-1`, `aria-hidden`, with the trend sentence from `trendSentence` as visually hidden text.
- A cell may be a link; the whole cell is then the target and shows a chevron on hover.

Under 64rem the strip wraps to three columns, under 40rem to two. A cell with no data shows a dash and "No runs yet", not zero.

## 6. Data tables

`kit/DataTable.tsx` is extended in place. Existing props keep working, so screens migrate one by one.

### 6.1 Anatomy

```
+ toolbar ------------------------------------------------------------------------------+
| [View: Open items v]  [Filter +]  severity: Critical x   plant: 2000 x   [ Search ]   |
|                                              [Columns] [Density] [Export v] [Import]   |
+ header (sticky) ----------------------------------------------------------------------+
| [ ] Rule            | Severity | Records v | Share   | Field         | Last changed   |
+ rows ---------------------------------------------------------------------------------+
| [ ] MM003 Material type is mandatory | Critical | 2,904 | 4.7% | MTART Material type | ... |
+ footer -------------------------------------------------------------------------------+
| 1 to 50 of 25,712        Rows per page [50 v]             [<] Page 1 of 515 [>]        |
+---------------------------------------------------------------------------------------+
```

### 6.2 Behaviour

- **Rows.** Height `--mx-h-row`. Hairline between rows, no zebra. Hover `--mx-row-hover`; selected `--mx-row-selected` with a 2px cobalt inline-start edge.
- **Header.** Sticky under the shell and page tabs, `--mx-well` fill, `--mx-elev-1` when rows are scrolled beneath. Sort by click; `aria-sort`; the arrow is an icon. Shift-click adds a second sort key.
- **Alignment.** Numbers end-aligned and tabular. Codes in Geist Mono followed by their text in the body face in the same cell. Dates in the short form of section 11. Text start-aligned.
- **First column** is pinned on horizontal scroll, with a hairline on its edge. The checkbox column is pinned with it.
- **Columns.** A "Columns" button opens a popover: checklist to show and hide, drag handle or Alt+arrow keys to reorder, "Reset". Resize by dragging the header edge; double-click fits content. New `Column` fields: `hideable?: boolean` (default true), `defaultHidden?`, `width?`, `minWidth?`, `pin?: "start"`.
- **Saved views.** A view is the set of filters, sort, visible columns, column order and density. The "View" menu lists Default, the user's views and shared views, and has "Save view", "Save as", "Rename", "Share with tenant", "Delete". An unsaved change shows a dot icon and "Modified" beside the view name. Views persist through the preferences API keyed by table id; if that API cannot hold them, see gap G4. The active view is reflected in the URL (`?view=`) so a link reproduces it.
- **Filters.** Applied filters are removable chips in the toolbar; "Clear all" at the end. Each chip reads "field: value" using the field's text, not its technical name alone ("Plant: 2000 Johannesburg").
- **Multi-select and bulk actions.** New props `selection?: "none" | "single" | "multi"`, `selectedKeys`, `onSelectedKeys`, `bulkActions`. Header checkbox selects the page; a strip then offers "Select all 25,712 that match". With one or more rows selected, the toolbar is replaced by the bulk bar: "{n} selected", the actions (for example Assign, Approve, Add to cleaning queue, Export selected), and "Clear". Destructive bulk actions go through `Confirm` and state the count.
- **Paging.** Server-paged tables show the footer above. Page sizes 25, 50, 100, 250. Tables whose whole result is already in memory keep virtual scrolling and show only "25,712 rows" in the footer. Never both.
- **Expand and detail.** In-place `expand` stays. Opening a row uses the existing `DetailPanel` at the side; the table narrows and keeps its scroll position.
- **Keyboard.** Arrow keys move the row focus; Space toggles selection; Enter opens; Shift+arrow extends selection; `/` focuses the table search; Escape clears selection.
- **States.** Section 10. The header and toolbar stay visible in loading, empty and error states.
- **Phone.** Under 40rem a table renders as a list of two-line rows (primary column, then two chosen secondary columns), bulk bar at the foot.

## 7. Charts and the ruler

- **Frame.** A chart sits in a card with a title, a one-line reading in words ("Up 11.0 points in 8 weekly runs"), then the plot, then a legend only when there are two or more series. No chart without a sentence.
- **Plot.** Grid lines are 1px `--mx-chart-grid`, horizontal only. Axis text `--mx-fs-micro` in `--mx-chart-axis`. No axis line on the y axis. Lines are 1.5px, no smoothing beyond monotone, end point marked with a 3px dot and a direct value label. Area fill is the series colour at 12% opacity as a flat fill; no gradients.
- **Colour.** Series use `--mx-chart-1..6` in order. Status colours appear in a chart only as thresholds and zones: the 70 gate and the 85 go line are 1px dashed `--mx-ink-3` lines with a text label, and the zones of the ruler use the `-soft` status fills.
- **Bars.** 2px top radius, 4px gap, value label at the end of horizontal bars. `BarList` rows are `--mx-h-row` high.
- **Hover.** One crosshair, one tooltip card (`--mx-elev-2`) with the date in the long form, each series with a swatch, its name and its value. Tooltips are also reachable by keyboard: arrow keys step through points.
- **Access.** Every chart has a "Show as table" toggle that swaps the plot for a `DataTable` of the same data, and an `aria-label` that is the reading sentence.
- **Score ruler.** Unchanged in meaning. Visual updates: track 8px high with 4px radius; zones are flat `--mx-stop-soft`, `--mx-watch-soft`, `--mx-go-soft`; gates at 70 and 85 are 1px `--mx-ink-2` ticks that extend 6px above and below the track with the numbers beneath; the shown marker is a solid 12px `--mx-ink` circle with its value above; the measured marker is a hollow circle with a 1.5px `--mx-ink-2` ring. When shown and measured differ, a caption states why ("Held at the 70 gate by 2 critical rules").
- **ScoreRing** is kept only for small inline use (24px in tables). Large scores are a number plus the ruler.

## 8. Process stepper

Every multi-step journey shows where the user is, what is done, what is blocked and what comes next, in the page header, on every page of the journey.

### 8.1 Component

Extend `ui/kit/Stepper.tsx`; do not add a second stepper. Existing callers keep working because the new fields are optional.

```ts
export interface Step {
  id: string;
  label: string;
  state?: "done" | "current" | "todo" | "blocked" | "error"; // default derives from `current`, as today
  hint?: string;      // one line under the label: "61,816 records pulled", "2 critical rules hold the gate"
  href?: string;      // done steps and the current step are links; todo and blocked are not
  optional?: boolean; // renders "Optional" after the label
}
export function Stepper(props: {
  steps: Step[]; current: number; label: string;
  size?: "header" | "compact";            // header is the default
  onStep?: (id: string) => void;
  mobileLabel?: (n: number, total: number, label: string) => string; // "Step 2 of 5: Clean"
}): JSX.Element
```

`ui/kit/CycleStepper.tsx` stays the fixed five-step wrapper (`pull`, `clean`, `upload`, `score`, `compare`) and gains two optional pass-through props, `states?: Partial<Record<CycleStepId, Step["state"]>>` and `hints?: Partial<Record<CycleStepId, string>>`. The `score` step is labelled "Re-score" in the interface. Other journeys call `Stepper` directly with their own steps. Step ids and order come from the stages each screen already has; do not invent a stage the backend does not have.

### 8.2 Anatomy

```
(v) Pull ------- (v) Clean ------- (3) Upload ------- (4) Re-score ------- (5) Compare
 61,816 records   1,204 fixed       Waiting for workbook
```

- A horizontal `<ol aria-label>`; each `<li>` is a 20px marker, a label and an optional hint line. A 1px connector joins the markers.
- Marker: number for todo and current; icon for the other states.
- Connector: `--mx-ink` between done steps, `--mx-line-strong` ahead of the current step.
- The stepper sits in `PageHeader`'s `stepper` slot, between the meta row and the tabs, full width, with 12px above and below.
- The current step's hint says what the user must do next. The page's primary button performs that next action and carries the same verb ("Upload workbook").

### 8.3 States

| State | Marker | Label | Announced as | Meaning |
| --- | --- | --- | --- | --- |
| done | check icon on `--mx-ink` fill, `--mx-on-solid` icon | `--mx-ink-2`, link | "Completed" | finished; click returns to its result |
| current | number on `--mx-cobalt` fill | `--mx-ink`, weight 600, `aria-current="step"` | "Current step" | where the user is |
| todo | number in a 1px `--mx-line-strong` ring | `--mx-ink-3` | "Not started" | not reachable yet |
| blocked | lock icon in a `--mx-warn-ink` ring on `--mx-watch-soft` | `--mx-ink`, hint in `--mx-warn-ink` | "Blocked" | cannot start; the hint names the reason and links to the fix |
| error | exclamation icon on `--mx-stop` fill | `--mx-bad-ink` | "Failed" | this step ran and failed; the hint names the failure and offers Retry |

State is never colour alone: each has its own icon and a visually hidden state word through `t()`. A running step is `current` with a determinate progress bar under its hint and the count ("38,400 of 61,816"). Use `Skeleton` for the whole stepper while its data loads; never show step 1 as current by default.

### 8.4 Mobile

Under 48rem the list collapses to one line: a segmented bar with one segment per step, coloured by state, and the text from `mobileLabel` ("Step 3 of 5: Upload"), plus the hint. The line is the summary of a native `<details>`; opening it lists all steps vertically with markers, labels, hints and links. Between 48rem and 64rem hints are hidden except on the current, blocked and error steps. German labels wrap to two lines under the marker; they never truncate.

### 8.5 Where steppers go

Steps below are taken from stages that already exist in each screen. Where a row says "confirm", the engineer reads the screen and uses its real stages.

| Journey | Screens | Steps |
| --- | --- | --- |
| Clean cycle | `work/CleanBoard`, `work/CleaningQueue`, `object-tabs/Runs`, `object-tabs/Fixes`, `runs/Run` | Pull, Clean, Upload, Re-score, Compare (existing `CycleStepper`) |
| Run | `runs/Run`, `runs/RunCompare`, `runs/Agreement` | Extract, Check, Score, Review (confirm against the run job phases) |
| Load | `load/LoadBoard`, `load/Plan`, `load/Maps`, `load/Templates`, `load/S4`, `load/GoLive` | existing LoadBoard steps; each sub-screen shows the same stepper with its step current |
| Move to a new instance | `load/move/Move` and its steps | Systems, Scope, Preflight, Plan, Load, Reconcile, Delta (existing) |
| Migration run | `load/MigrationRun` | Validate, Simulate, Load, Reconcile (confirm) |
| Wave | `load/Wave` | Plan, Ready, Loading, Reconciled, Signed off (confirm) |
| SuccessFactors workbook fill | `load/Templates` | Choose workbook, Map columns, Fill, Review flags, Download |
| Survivorship and golden record | `mdm/Match`, `mdm/MatchCluster`, `mdm/Survivorship`, `mdm/GoldenRecord` | Match, Review clusters, Survivorship rules, Golden record, Publish (confirm) |
| Rule change | `rules/RuleFix`, `rules/DryRun`, `rules/Promotion` | Draft, Dry run, Review impact, Promote |
| Connect a system | `systems/SystemNew` | existing |
| Data request | `requests/RequestNewScreen`, `requests/RequestScreen` | Describe, Route, Approve, Fulfil, Close (confirm against the workflow) |
| Approval | `work/Approvals` item detail | Requested, Reviewed, Approved, Applied |
| Subject request | `admin/ops/SubjectRequests` | Received, Verified, Collected, Delivered (confirm) |
| Admin setup | `admin/AdminBoard` first-run checklist | Sign-in, Users and roles, Licence, Connect a system, Scoring, Notifications, First run |
| Import (any) | the import sheet, section 9.2 | Choose file, Validate, Review, Apply |

Pages with no sequence (Home, Objects list, Monitor, Insights, Reports, Status, People) get no stepper. A stepper on a page with no real order is noise.

## 9. Exports and imports

The rule: before the user commits, the screen states the format, the scope and the size; while it runs, it shows progress; after, the result is recorded where the user can find it again. Both flows are built once in the kit and used everywhere.

### 9.1 Export

NEW `kit/ExportMenu.tsx`. Trigger: a secondary button labelled "Export" with a download icon, in the table toolbar when it exports the table and in the page header actions when it exports the page. Never a bare icon. It opens a popover (a sheet under 48rem):

1. **Format.** Radio list of the formats the endpoint really offers, each with a one-line use: "Excel workbook (.xlsx): for cleaning and re-upload", "CSV (.csv): for other tools, UTF-8 with byte-order mark", "PDF (.pdf): for sign-off". A format the endpoint does not offer is not listed.
2. **Scope.** Radio list with live counts: "Selected rows (12)", "Current view (2,904 after filters)", "Everything (61,816)". The filter chips are repeated under "Current view" so the user sees what "view" means.
3. **Columns.** "Visible columns (9)" or "All columns (42)".
4. **Options**, only where they apply: header language (follows the interface language; technical field names are always included as a second header row), and a note of the time zone used for date cells.
5. **Summary line** above the button: "2,904 rows, 9 columns, about 0.4 MB". Then the primary button "Export 2,904 rows".

Behaviour:

- Under 5,000 rows the file downloads directly and a toast confirms with the file name.
- Above that, or whenever the endpoint is asynchronous, it becomes a job: a toast "Preparing export" with a determinate bar and row count, a Cancel action, and a row in Notifications under Jobs. When done, the notification carries the download link, the row count, the size and the expiry. The user may leave the page.
- File name: `meridian_{object}_{what}_{run}_{yyyymmdd}T{hhmm}Z.{ext}`, in UTC, ASCII only, for example `meridian_material-master_open-items_run8_20261016T0317Z.xlsx`.
- Every exported workbook has a first sheet "About this export": tenant, system and environment, run, filters applied, row count, who exported, when in UTC and in the user's zone, and the Meridian version. Instructional workbooks keep their instruction sheet after it.
- Dates in files are ISO 8601. Numbers are unformatted values, not display strings. Codes and their texts are separate columns.
- Exports of personal data (SuccessFactors) state it on the summary line and are written to the audit log.
- Failure: the toast and the notification say what failed in words from `errorLabel`, with Retry. A partial file is never offered as complete.
- Permission: a user who may not export sees the button disabled with a tooltip naming the missing permission, through the existing `RequestAccessHost`.

### 9.2 Import

NEW `kit/ImportSheet.tsx`, a `Sheet` that wraps the existing `FileDrop`. Trigger: a secondary button "Import" with an upload icon, or the primary button when upload is the current step of a journey ("Upload workbook"). The sheet carries a four-step `Stepper` (`size="compact"`):

1. **Choose file.** `FileDrop` with, stated above it: accepted formats ("Excel workbook .xlsx, or CSV .csv in UTF-8"), the size and row limits the endpoint enforces, what the file must be ("the workbook you downloaded from this run, with the Key column unchanged"), and a "Download template" link. After choosing: file name, size, sheet count.
2. **Validate.** Runs at once. A determinate bar with rows read. Result as three counts with icons: rows ready, rows with warnings, rows rejected. A table of problems (row number, column with its text, value, what is wrong, how to fix) and "Download error report". Structural failure (wrong workbook, missing key column, wrong run) stops here with one sentence and the fix.
3. **Review.** What will change, before anything is written: counts by change type (updated, unchanged, new, skipped), the fields touched with their texts, a sample of before and after values in a `DataTable`, and the target named in full with its environment badge. For a PROD target the confirm button states it: "Apply 1,204 changes to ECC production".
4. **Apply.** Determinate progress with counts and Cancel where the endpoint supports it. Result: applied, skipped, failed, each a link to its rows; then the next step of the journey as the primary button ("Re-score now").

Rules:

- Nothing is written before the user confirms on step 3.
- Per the standing rule for SuccessFactors fills, rows are never silently dropped or truncated: every row is applied or listed with its reason.
- Closing the sheet during step 2 or 3 asks to confirm and discards the upload. During step 4 it keeps running as a job and reports in Notifications.
- Each import is a record: who, when, file name, checksum, counts. It appears in the run's history and in the audit log.
- Errors use `ErrorState` inside the sheet with Retry; the chosen file is kept.

### 9.3 "Should work": the audit that goes with the pattern

A design pattern does not prove a button works. Batch 4 therefore starts with an inventory: grep `ui/screens` for every export, download, upload and `FileDrop` use, list each with its endpoint, formats and current behaviour, and run each one in fixture mode and against a live API. Each affordance ends in one of three states: migrated to `ExportMenu` or `ImportSheet` and tested, removed because no endpoint backs it, or raised as a backend gap. No export or import button ships outside the two kit components. This spec did not exercise the endpoints; treat every existing affordance as unverified until that inventory is done.

## 10. Status system and states

### 10.1 Status

One component, `Badge`, with a `tone` and always an icon and a word. Colour never stands alone.

| Tone | Tokens | Icon | Used for |
| --- | --- | --- | --- |
| go | `--mx-good-ink` on `--mx-go-soft` | check | Go, Healthy, Passed, Loaded, Approved |
| watch | `--mx-warn-ink` on `--mx-watch-soft` | triangle | At risk, Degraded, Needs review, Blocked |
| stop | `--mx-bad-ink` on `--mx-stop-soft` | octagon | No-go, Failed, Rejected |
| info | `--mx-cobalt` on `--mx-cobalt-soft` | dot | Running, Queued, Scheduled |
| neutral | `--mx-ink-2` on `--mx-well` | dash | Draft, Not started, Archived |
| aletheia | `--mx-violet-ink` on `--mx-violet-soft` | spark | Suggested by Aletheia (only) |

Severity uses `SeverityPill` with the `--mx-sev-*` tokens and the words Critical, High, Medium, Low. Severity and status are different axes and are never merged into one pill. Running states show a small determinate bar or a count, not a spinner alone.

The vocabulary is closed. Add the list to `DESIGN.md` and map every backend status string through `labelOf` to one of these words. A new status needs a row in the table first.

### 10.2 Loading, empty, error, partial

- **Loading.** `Skeleton` in the shape of the content: KPI strip cells, table rows at `--mx-h-row`, chart frame. Page chrome (header, toolbar, table header) renders at once. No full-page spinner. After 10 seconds a line appears: "Still loading. Large objects can take a minute."
- **Empty.** `EmptyState`: a 20px icon, one sentence saying what will appear here, one action. Three kinds with different copy: nothing yet ("No runs yet. Run the first check."), nothing matches ("No rows match these filters." with "Clear filters"), not permitted ("You do not have access to customer master." with "Request access"). No illustrations.
- **Error.** `ErrorState`: what failed in plain words, Retry, and a collapsible "Details" with the request id, the time in UTC and a Copy button. A failed card never takes the page down; the rest renders.
- **Partial and stale.** When data is older than the latest run or a source is unreachable, a watch-tone line sits in the card header: "Showing run 7. Run 8 is still scoring." Stale numbers are never shown as current.
- **Offline.** Existing banner; actions that write are disabled with a tooltip.

## 11. Time, audit and numbers

- **One formatter.** All dates go through `formatDate` and all numbers through the `format*` helpers in `lib/format`. No `toLocaleString` in screens.
- **Zone.** Times render in the user's chosen zone (preference, else tenant zone, else browser). Every absolute date-time shows its zone: "16 Oct 2026, 05:17 SAST". Where a zone has no common abbreviation in the active language, show the offset: "UTC+02:00". The global bar shows the active zone at all times.
- **Forms.** Short in tables: "16 Oct 2026, 05:17". The column header carries the zone once ("Last changed, SAST") so cells do not repeat it. Long in headers, tooltips and audit: "16 October 2026 at 05:17:42 SAST (03:17:42 UTC)". Day-first with a named month in English and German; `2026年10月16日 5:17` in Japanese, all produced by `Intl.DateTimeFormat` for the active locale. Never an all-numeric date in the interface: 03/04/2026 means two different days to two offices.
- **Clock.** 24-hour in every locale.
- **Relative time** ("4 minutes ago" from `relativeTime`) only for events under 24 hours old, always with the absolute long form in a `title` and for assistive technology. Audit views never use relative time.
- **Audit line.** Every record, rule, view, export and import that can change shows one line in its detail footer: "Changed by Thandi Mokoena on 16 Oct 2026, 05:17 SAST. Created by System on 28 Aug 2026." The name links to the person; "History" opens the `Timeline`.
- **Audit tables** (`admin/ops/Audit`, run history, import history): columns are When (user zone), When (UTC), Who, Role, Action, Object, Before, After, Source (interface, API, schedule), Request id. Exports of audit data carry ISO 8601 UTC only.
- **Run identity.** A run is shown as "Run 8" plus its finish time; never a bare id.
- **Numbers.** Grouping and decimal marks follow the locale (61,816 in en, 61.816 in de, 61,816 in ja). Scores always one decimal. Percentages one decimal. Money with its ISO code ("ZAR 4.14 M") and never a bare symbol, because tenants report in several currencies. Compact forms only in KPI tiles and charts; tables show the exact figure.
- **Sandbox cut-off.** Where a system's data stops at a known date, the meta row says so: "Postings to 19 Jun 2026".

## 12. Language readiness (en, de, ja)

- Every string through `t()`, plurals through `tn()`, with en, de and ja present; `node scripts/i18n-extract.mjs` reports zero untranslated, missing and gaps before a batch merges.
- **No concatenation.** Sentences with values use placeholders in one string (`t("{n} of {total} rows", ...)`). Word order differs in German and Japanese.
- **Room.** German runs 30 to 40% longer. Buttons, tabs, stepper labels, KPI labels and badge text size to content and wrap; none has a fixed width or truncates. Table headers wrap to two lines. Test strings to design against: "Stammdatenbereinigung", "Bewertungsklasse ist obligatorisch", "Datenqualitätsbewertung".
- **Japanese.** Size and leading from 2.1. `line-break: strict; word-break: normal; overflow-wrap: anywhere` under `:lang(ja)`. No italics. No letter-spacing. Full-width punctuation comes from the translation, not from CSS.
- **Codes are not translated.** SAP field names, table names, rule ids, PROD, QA and DEV stay as they are; the text beside them is translated.
- **Icons with words.** An icon alone is allowed only where a tooltip and an `aria-label` through `t()` exist (bell, close, overflow).
- **Layout uses logical properties** (`margin-inline`, `padding-inline-start`, `inset-inline-end`, `text-align: end`), which the kit already does. Keep it so, even though no right-to-left language is planned.
- **Sorting and search** use `Intl.Collator` with the active locale.
- **Screenshots in review.** Each batch's review shows its screens in en, de and ja at 1440px and at 390px.

## 13. Per-screen notes

Every route gets the shell and the page header. The notes say what else changes.

### Home `/`
- Header: greeting as `h1`; meta row carries run, finish time with zone, records checked, rule count and licence end date (today this is a sentence under the greeting).
- KPI strip: objects at Go, objects held at a gate, open items, value at risk, records checked, rules evaluated.
- "Where every object stands" ruler card, full width, as approved.
- The three object cards become a dense "Objects" table (object with system, shown score with a mini ruler, measured, change, records, open items, clean-cycle step as a compact stepper, next action). With three licensed objects it is a short table; it stays a table so the screen holds at thirty.
- Below, three columns: "What moved since run 7", "Value at risk, top rules", "Systems" (each with its environment badge and last sync time).
- Aletheia dock at the foot.

### Objects `/o` and object detail `/o/[system]/[module]`
- `/o`: the same Objects table with saved views, grouped by system when "All systems" is the scope.
- Detail header: crumbs "Objects / Material master"; title with a No-go, At risk or Go badge; meta row (system with badge, run, as-of time, records, coverage); the clean-cycle stepper; actions "Download workbook" (an `ExportMenu` preset) and the cycle's next step as the primary button.
- Tabs: Overview, Rules, Fields, Records, Runs, Trend, Readiness, then More for Profile, Lineage, Glossary, Processes, Golden, Fixes.
- Overview: score block (number, ruler, cap reason) beside the KPI strip; then "Holding the cap", "Six dimensions", "Score by run"; then "S/4HANA readiness" and "Worst rules" as tables.
- Sub-tabs (`object-tabs/*`): each is the DataTable pattern with its own saved views. Records adds bulk "Add to cleaning queue" and "Export selected". Record detail shows the audit line and a field table with field name, text, value, and the rules that failed on it.
- Source and destination: where a pair exists, the score block shows source score, projected target score and actual target score in one row with the reasons they differ.

### Clean `/work`, `/work/triage`, `/work/exceptions`, `/work/requests`, `/work/analytics`, `/approvals`
- `/work` (CleanBoard): one row per object with its cycle stepper; the queue below as a table with bulk assign, approve and export.
- The cycle is the header stepper on every Clean page. Upload is the `ImportSheet`. Download is the `ExportMenu` workbook preset.
- Triage, Exceptions, Approvals: table with a side `DetailPanel`; keyboard `j`/`k` to move, `a` approve, `r` reject through `Confirm`; the approval stepper in the panel.
- Analytics: KPI strip plus charts in the data palette.

### Load `/load` and children
- LoadBoard: header stepper for the load journey; a table of objects with source score, projected target score, actual target score and wave.
- `/load/move`: the seven-step stepper in the header on every step page; Preflight renders its checks as a table with status badges, and blocked steps use the blocked state with the reason.
- `/load/waves`, `/load/waves/[id]`: table, then a wave header with its stepper and sign-off audit line.
- `/load/runs`, `/load/runs/[id]`: table; run detail with progress and counts, failures as a table with export.
- `/load/templates`: the SuccessFactors workbook fill stepper; country scope chips (BWA, ZAF, MOZ, NAM) with country names beside the codes.
- `/load/maps`, `/load/plan`, `/load/s4`, `/load/compare`, `/load/compare/[pair]`: table pattern; compare pages show the three-score row.
- `/load/go-live`: a readiness checklist as a table with status badges, an owner and an audit line per item, and a sign-off summary in the KPI strip.

### Monitor `/monitor`, `/monitor/controls`
- KPI strip: controls passing, drifting, breached, objects watched, last check with zone.
- A table of controls with a sparkline per row, status badge, threshold, last value, last breach time; side panel with the trend chart and the gate lines.
- Score-by-run charts use the data palette with the 70 and 85 lines.

### Runs `/runs`, `/run/[id]`, `/run/[id]/vs/[b]`, `/run/[id]/agreement`
- Table with saved views (Mine, Failed, This week). Run detail header with the run stepper, duration, counts and audit line. Compare shows two columns with deltas, and deltas use arrow plus sign.

### Rules `/rules`, `/r/[id]`, `/rules/dry-run`, `/rules/promotion`
- Rules table: id, text, object, field with text, severity, records failing, share, last changed. Saved views by object and severity. Bulk enable, disable and export.
- Rule detail: title is the id plus its text; the rule-change stepper when a draft exists; tabs for definition, failing records, history.

### Insights `/insights`, `/insights/score`, `/insights/value`, `/insights/money`, `/insights/forecast`
- KPI strip plus chart cards in a 12-column grid. Each chart has its sentence and "Show as table". Forecast marks projected values with a dashed line and states the method in the card footer.

### MDM `/mdm` and children
- Hub page: KPI strip and links. Match, Golden, Issues, Reference, Links, Glossary: table pattern. Match cluster and Golden record: the survivorship stepper in the header. Lineage and Processes: graph cards inside the page skeleton, with a legend in the data palette and "Show as table".

### Systems `/s`, `/s/[id]`, `/s/new`
- List: table with type, release, environment badge, client or data centre, last extraction with zone, health. Detail: tabs as today with the audit line. New: existing stepper in the header.

### People `/people` and children; Requests `/requests` and children
- Table pattern with saved views. Request detail carries the data-request stepper and a `Timeline` with long-form times.

### Reports `/reports`
- A table of reports with format, schedule, last generated with zone and a download action through `ExportMenu`.

### Admin `/admin`, `/admin/[section]`
- Left section list (two levels) inside the page, content right. First run shows the admin setup stepper until every step is done.
- Users, Roles, API keys, Webhooks: table pattern with bulk actions. Settings pages: one form per card, a sticky save bar that appears only with unsaved changes, and the audit line under each card.
- Audit: the audit table of section 11 with export.
- Licence: the licensed objects listed by name with the end date in long form.

### Me `/me`, `/me/notifications`; Status `/status`; Share `/share/[token]`; Kit `/kit`
- Me: the preferences from the locale popover as a full page (language, time zone, formats, theme, density, default system).
- Notifications: the full inbox as a table with the same tabs as the popover.
- Status: one row per component with a status badge and last-checked time in UTC and in the user's zone.
- Share: the standalone layout with the global bar reduced to brand and the environment badge, and a "Shared view, read only" badge.
- Kit: every new component in every state, in both themes; this page is the visual reference for review.

## 14. Feature gaps found while reading

- G1. Systems carry no visible environment (PROD, QA, DEV). The badge needs a field on the system record. Until it exists, show no badge; do not guess from the name.
- G2. No tenant or system switcher in the shell. Sandbox is only a banner.
- G3. No visible time zone anywhere; `formatDate` supports a zone label but the shell never states the active zone and there is no user-facing zone preference control in the bar.
- G4. `DataTable` has no column control, saved views, multi-select, bulk actions, paging footer, density or export. Saved views need a store; confirm the preferences API can hold them per table.
- G5. Notifications are a text link to `/me/notifications`; no popover, no job progress.
- G6. No breadcrumbs. `PageHeader` has only `back`.
- G7. `Stepper` has three states (done, current, todo). No blocked or error state, no hints, no links, no mobile form. It is used on six screens; the other journeys in 8.5 have none.
- G8. Export and import affordances are built per screen with no shared component, and none states format, scope and progress together. Their working state is unverified (9.3). Asynchronous export jobs and an import validate-then-apply split may need endpoints.
- G9. Only three chart tokens, two of them aliases of status and severity colours.
- G10. The content column is capped at 80rem.
- G11. The avatar shows one initial and the user menu shows no role or tenant.
- G12. `frontend/DESIGN.md` describes the older Split analyst direction and its sizes disagree with `tokens.css`.
- G13. The `g` chord map in `Frame.tsx` points at Work, Runs and More, not at the five current places. The search hint is hard-coded "Ctrl K" on every platform.
- G14. `scripts/check-contrast.mjs` reads `design/tokens.css` (line 10) with `--m-*` names, while the interface tokens are `ui/tokens.css` with `--mx-*`. The contrast gate therefore does not cover the tokens this spec changes. Batch 1 extends the script to `ui/tokens.css` and its `.mx-root` blocks.

## 15. Batch plan

Each batch is one branch and one pull request. Every batch ends with the common gate, then its own checklist.

**Common gate (every batch).** `npm run lint`, `npm run typecheck`, `npm run lint:tokens` with an empty allow list, `npm run check:contrast`, `node scripts/i18n-extract.mjs` at zero untranslated, missing and gaps, the middle-dot test, the help-chapter and legacy-redirect tests, `npm test`. Tests for each screen are committed with that screen. Screens are checked in en, de and ja, light and dark, at 1440px and 390px, in fixture mode. No raw hex, no gradients, no new entries in `lint-tokens.allow.txt`.

### Batch 1. Tokens and density
Scope: `tokens.css` per section 2; `kit.css` and `shell.css` consume `--mx-h-row`, `--mx-h-bar`, `--mx-page-max`, `--mx-page-gutter`; density attribute; Japanese overrides; chart token migration; contrast script covers the new pairs (and G14).
- [ ] Every value in section 2 is in `tokens.css`; both dark blocks are identical.
- [ ] No component hard-codes 36px, 40px, 56px or 80rem.
- [ ] Every former use of `--mx-chart-2` and `--mx-chart-3` is reviewed and uses the token it meant.
- [ ] `data-density="comfortable"` restores 40px rows and 36px controls; coarse pointers get it automatically.
- [ ] `/kit` renders with no clipped text in de and ja.

### Batch 2. Shell
Scope: two-tier `AppShell`, `ContextSwitcher`, `EnvBadge`, `LocaleClock`, notifications popover, user menu, breadcrumbs in the section bar, banner strips, chord map, phone tab bar, command palette groups.
- [ ] Tenant, system, environment and time zone are visible on every route at 1024px and wider.
- [ ] The environment badge appears only when the system record states its environment.
- [ ] Changing language, zone, theme or density applies at once and survives reload.
- [ ] Every shell control is reachable by keyboard; skip links still work; focus is visible on every control.
- [ ] At 390px: bottom tab bar, no horizontal scroll, switcher reachable from the user menu.
- [ ] Chords and the shortcuts sheet match section 3.2.
Steppers: none.

### Batch 3. Page skeleton: header, breadcrumbs, KPI strip, status, states
Scope: `PageHeader` v2, `Breadcrumbs`, `KpiStrip`, `Badge` tones with icons, `Skeleton`, `EmptyState` and `ErrorState` variants, audit line component, time conventions wired through `formatDate`.
- [ ] Every route in `app/(app)` passes `crumbs` and a meta row; a test walks the route list and fails on a page without them.
- [ ] No status is shown by colour alone.
- [ ] Every absolute time shows a zone or sits under a header that does.
- [ ] No `toLocaleString`, `toLocaleDateString` or hand-built date in `ui/screens`.
- [ ] The status vocabulary table is in `DESIGN.md` and every backend status maps to it.
Steppers: the `stepper` slot exists in `PageHeader`; the component lands in batch 4.

### Batch 4. Stepper, export and import
Scope: `Stepper` extended per 8.1 to 8.4; `CycleStepper` pass-through props; `ExportMenu`; `ImportSheet`; the inventory of 9.3; job rows in Notifications.
- [ ] `Stepper` renders done, current, todo, blocked and error with icon, word and hint; existing callers are unchanged.
- [ ] Under 48rem it collapses to "Step n of m" inside `<details>`.
- [ ] The inventory lists every export and import affordance with endpoint, formats and result; each is migrated, removed or raised as a gap.
- [ ] Every export states format, scope with counts and size before the click, and shows progress after.
- [ ] Every import validates before writing, shows the review step, never drops a row silently and records the result.
- [ ] One test per migrated export asserts a file with the expected name, sheet "About this export" and row count; one test per import covers a clean file, a file with rejected rows and a wrong file.
Steppers land on the six screens that already have one, restyled and moved into the header: `work/CleanBoard`, `object-tabs/Runs`, `runs/Run`, `load/LoadBoard`, `load/move/Move`, `systems/SystemNew`; plus the import sheet.

### Batch 5. DataTable v2 and charts
Scope: section 6 and section 7; "Show as table"; saved views store.
- [ ] Column show, hide, reorder and resize work by mouse and keyboard and persist.
- [ ] A saved view restores filters, sort, columns and density, and loads from its URL.
- [ ] Multi-select, "select all that match" and the bulk bar work; destructive actions confirm with the count.
- [ ] 100,000 rows scroll smoothly in a virtual table; paged tables show correct counts.
- [ ] Every chart has a reading sentence, uses only `--mx-chart-*` for series, and offers its table.
- [ ] The ruler matches section 7 and its markers and gates pass 3:1 against the zones.
Steppers: none.

### Batch 6. Home, Objects and object detail
Scope: `home/Home`, `home/Objects`, `object/ObjectScreen`, all `object-tabs/*`, `home/Status`.
- [ ] Home and object detail match the preview file in structure.
- [ ] Every code on these screens shows its text.
- [ ] Records, Rules and Fields tabs use DataTable v2 with at least one saved view each.
- [ ] Source, projected and actual target scores appear where a pair exists.
Steppers: clean cycle on object detail and on `object-tabs/Runs` and `object-tabs/Fixes`.

### Batch 7. Clean, Load and Monitor
Scope: `work/*`, `load/*`, `load/move/*`, `insights/Monitor`, `insights/MonitorBoard`, `runs/*`.
- [ ] Download, upload and re-score on the clean cycle run end to end through `ExportMenu` and `ImportSheet` in fixture mode and against the API.
- [ ] Blocked and failed steps show their reason and a way forward.
- [ ] Monitor rows show a sparkline, a status badge and the last breach time with zone.
Steppers: clean cycle (`work/CleanBoard`, `work/CleaningQueue`), run (`runs/Run`, `runs/RunCompare`, `runs/Agreement`), load (`load/LoadBoard`, `load/Plan`, `load/Maps`, `load/S4`, `load/GoLive`), move (all `load/move/*` steps), migration run (`load/MigrationRun`), wave (`load/Wave`), SuccessFactors workbook fill (`load/Templates`), approval (`work/Approvals`).

### Batch 8. Rules, MDM, Insights, Systems, People, Requests, Reports, Admin, and the consistency pass
Scope: every remaining route; rewrite `frontend/DESIGN.md` to this direction; update help chapters and the admin guide screenshots.
- [ ] Every route in the list in section 13 uses the page skeleton; none uses a component outside the kit.
- [ ] `DESIGN.md` matches `tokens.css` and names The line; the Split analyst text is gone.
- [ ] A walk of every route in en, de and ja, light and dark, shows no clipped label, no bare code, no unzoned time, no colour-only status.
- [ ] Help chapter test passes for every route.
Steppers: rule change (`rules/RuleFix`, `rules/DryRun`, `rules/Promotion`), survivorship (`mdm/Match`, `mdm/MatchCluster`, `mdm/Survivorship`, `mdm/GoldenRecord`), data request (`requests/RequestNewScreen`, `requests/RequestScreen`), subject request (`admin/ops/SubjectRequests`), admin setup (`admin/AdminBoard`).
