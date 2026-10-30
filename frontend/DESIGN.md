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

- **Ground and ink**: `--m2-bg`, `--m2-sheet`, `--m2-line`, `--m2-line-2`, `--m2-rule`, `--m2-fg`, `--m2-ink-2`,
  `--m2-ink-3`, `--m2-meta`. Light is white ground and white sheets with 1px rules; dark is neutral steps.
- **One data hue**: `--m2-data` (and `--m2-on-data`) marks the selected cell, the current run and the next-step button,
  the one strong control of a canvas. `--m2-info` for neutral notices.
- **Status**: `--m2-crit`, `--m2-high`, `--m2-pass` with their `-bg` and `-ink`. A status hue always comes with a shape
  (`VerdictMark`, `SeverityMark`) and a word, never alone.
- **Type**: IBM Plex Sans for words and figures (`--m2-font`, tabular figures), IBM Plex Mono for SAP identifiers only
  (`--m2-mono`: check ids, `TABLE.FIELD`, record keys, run ids). Both self-hosted from `app/_fonts`. Scale
  12/13/14/16/20/24 (`--m2-fs-*`, `--m2-lh-*`). Sentence case everywhere.
- **Space and shape**: `--m2-s1` to `--m2-s10` on a 4px grid, radii `--m2-r1` 4px and `--m2-r2` 6px, rows `--m2-row-h`
  32px (`--m2-row-h-compact` 28px), the shadow `--m2-shadow` only for what floats (menus, the inspector on a phone).
- **Motion**: `--m2-t-fast`, `--m2-t-med`, `--m2-ease`, declared in the last section of the tokens file only; none under
  `prefers-reduced-motion`.
- **Tenant theme**: a tenant may set its accent, logo and name (Administration, Settings, Appearance);
  `themeRootProps` puts them on the root, and the contrast of the accent is checked before it is saved.

## 3. Components

All under `design/v2`. Screens compose these and draw nothing of their own.

- **Shell** (`shell/V2Shell.tsx`, `TopBar.tsx`, `MapPane.tsx`, `StatusStrip.tsx`, `Standalone.tsx`): the gate
  (`auth/Guard.tsx`: session check, the forced password change), the permissions provider, the request for access
  (`RequestAccess.tsx`), the top bar, the map, the canvas, the inspector, the job line and the toasts. Pages that stand
  without the shell (the status page, the signed-out pages, not found) use `StandaloneRoot`.
- **Signed-out pages** (`auth/AuthFrame.tsx`): the tenant's mark and name over one card with the page's h1, the form,
  and the version under it.
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
- `npm run check:contrast` gates the colour pairs of `design/tokens.css`; the v2 pairs are checked by
  `design/v2/__tests__/tokens.test.ts` in light and dark.
- `e2e/v2-a11y.spec.ts` runs axe (WCAG 2.1 A and AA) on every page in English, German and Japanese, light and dark;
  `e2e/redirects.spec.ts` does the same for the pages outside the shell. Fix a failure in the component or the
  tokens, never with an axe rule exclusion.
- Reduced motion turns off every animation. Focus rings always show.
