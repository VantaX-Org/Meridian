# Polish audit, October 2026

The whole product walked as a buyer's team would before a purchase decision: every screen under `app/(v2)` and
`app/(auth)`, every inspector kind, every administration section and panel, as the programme lead, data steward, data
owner, SAP Basis, process analyst, auditor and administrator, at 1440 and 390, light and dark, in English, German and
Japanese, in fixture mode (`?fixture=1`) against the production build. Every finding below has the screen and state it
was seen in, a severity and what became of it.

Severity: **High** a buyer would notice in the first minutes or it misstates something; **Medium** visible on a closer
look or in one language or width; **Low** craft.

## How it was walked

- **Link crawl**: a breadth-first crawl from the canvases, the personas and the panels followed every `href` on every
  page (500 pages, two per address shape, every inspector kind reached by its link). Result: every address answered
  200 or redirected to a page that did (old addresses 308 to their new place, signed-out redirects 307); no page error,
  no console error other than the API's 404 that fixture mode answers by design; no sideways scroll at 1440.
- **Phone and German**: the 33 main canvases, panels and signed-out pages at 390 in German: no sideways scroll; the
  one clipped control found is item G11.
- **Window titles, headings, raw text**: the crawl recorded every page's tab title, h1 and any raw key, snake_case id,
  `undefined`, `NaN`, `null`, "v2", "Meridian 2", "item", "step N" or placeholder in the visible text.
- **Screens by eye**: all 61 canvases and states in `e2e/__screenshots__/polish/` at 1440 light, the landscape for each
  role at 1440 and 390, dark mode on the landscape, object, work and signed-out pages, and the help, inbox and
  preferences panels.
- **Measured**: Lighthouse 12 (desktop) on the landscape, object, work and administration pages, JavaScript per page
  from the browser's resource timing, layout shift from the browser's layout-shift entries.

## Counts

| | Found | Fixed | Left (with reason, below) |
|---|---:|---:|---:|
| Leftovers | 15 | 15 | 0 |
| Copy and words | 16 | 14 | 2 |
| States | 8 | 8 | 0 |
| Layout and grid | 18 | 17 | 1 |
| Navigation | 6 | 6 | 0 |
| Honesty | 3 | 3 | 0 |
| Performance | 7 | 5 | 2 |
| Accessibility | 1 | 1 | 0 |
| Craft pass | 9 | 6 | 3 |
| **All** | **83** | **75** | **8** |

## Leftovers

| # | Screen, state | Finding | Sev. | Status |
|---|---|---|---|---|
| L1 | Build | `middleware.ts` deprecation warning on every build (Next 16 names it proxy) | Medium | Fixed: `proxy.ts` |
| L2 | Build | `metadataBase` warning for the Open Graph image | Low | Fixed |
| L3 | Lint | ESLint plugins named `aurora-*`, path rules naming deleted `components/` folders, and `design/v2` not linted at all | Medium | Fixed: `meridian-*`, paths on `design/v2`, scope widened; the 25 findings it then raised fixed (raw severity, two dates outside `formatDate`, canvas filters in component state) |
| L4 | docs/accessibility VPAT | "Meridian 2, the v2 interface", "the current interface (/home ...) is not covered", "/v2/*" routes, "not yet localised" | High | Fixed |
| L5 | docs/accessibility audit | "the v2 interface (/v2/*)", "Every v2 page" | Medium | Fixed |
| L6 | Guide, redirects chapter | "the new interface", "while both interfaces shipped" | Medium | Fixed |
| L7 | Guide PDF | cover "The new interface: every screen...", footer "Meridian 2 guide", file `meridian-2-guide.pdf`, set in a face the screens do not use, "Printed 2026-10-30 from docs/guide" | High | Fixed: `meridian-guide.pdf`, IBM Plex embedded, "Edition of 30 October 2026"; regenerated |
| L8 | Help panel, What's new | lines read "29 Oct 2026, step 0. The new interface behind a switch" with branch references | High | Fixed: release notes by date |
| L9 | Help panel title, recordings manifest, tours | "Meridian 2 guide", "Meridian 2 help recordings" | Medium | Fixed (and in `scripts/help-videos.mjs`, which writes the manifest) |
| L10 | Every page | the root layout preloaded Manrope and JetBrains Mono, which nothing drew with; not-found used them | Medium | Fixed: IBM Plex loaded once for every page |
| L11 | Every page | 260 lines of the retired interface's CSS (cmdk, sonner, m-btn, m-card, m-tab) in `globals.css`, and a test of them | Low | Fixed: removed |
| L12 | Job stream | called a `sonner` toast that nothing mounts, so a finished job with no declared footprint refreshed nothing and said nothing | Medium | Fixed: refreshes every read but the job list |
| L13 | Help recordings | `guide2-preferences` recorded before the preferences panel changed | Medium | Fixed: re-recorded with the tour pipeline, poster and captions refreshed, manifest and help index rebuilt |
| L14 | `lib/format.test.mjs` | expected title case ("Accounts Payable") the product no longer writes | Low | Fixed |
| L15 | `lib/v2/audit-sentence.ts` | "Same wording as the current interface" | Low | Fixed |

## Copy and words

| # | Screen, state | Finding | Sev. | Status |
|---|---|---|---|---|
| C1 | Inspector, unknown kind | "Feature impact fills here in the next step." | High | Fixed |
| C2 | Waves panel, each wave | "Readiness certificate: not yet (the signed certificate arrives in step 9) /migration/waves/w-1/certificate" | High | Fixed: the certificate exists, the line links to it |
| C3 | Object, related objects | "Mdg master data", "Ewms stock" from the server label | Medium | Fixed: object names from the catalogue (MDG, eWMS) |
| C4 | Data contracts panel and inspector | "material_master to S/4HANA migration" | Medium | Fixed |
| C5 | Rule inspector, Definition | check class `domain_value_check` and parameter `check_table` as raw ids | Medium | Fixed: "Allowed values", "Check table", the id on hover; same name in the rules library |
| C6 | Object, policy breaches | severity printed as `critical` | Medium | Fixed |
| C7 | Administration, Audit log | "changed the setting update", "created the API key api_key.create", a refused request read as done, "Object" column of ids, the name and the email handle both | High | Fixed: names what changed, the person's name, "was refused (403): ...", column "Target" |
| C8 | Preferences, triage, notifications, process designer, audit nouns | "items" in eight strings | Low | Fixed: open work, menu entries, task, level |
| C9 | Object rules tab, rules library, runs, work batches, record history, reports | English literals that bypassed the catalogue: Learned, Drafts, Suppressed, Jobs, Approved by, Unassigned by, Create the report | High (de, ja) | Fixed: keys with German and Japanese |
| C10 | Landscape matrix | "61,816 rec, 913 rules" | Low | Fixed: "records" |
| C11 | Waves panel, gate mark | tooltip "met" untranslated | Low | Fixed |
| C12 | Rules library, process designer | field hint "TABLE.FIELD" | Low | Fixed: "The table and field, such as MARA.MATNR" |
| C13 | Work, record inspector | first-seen dates written with the browser's date in UTC, not the person's format and time zone | Medium | Fixed: `formatDate`, full date on hover |
| C14 | Inbox | times of today through the browser's own formatter | Low | Fixed |
| C15 | Administration, Audit log (de, ja) | the audit sentence's verbs (created, changed, removed) are composed from English words, so a German or Japanese reader sees an English sentence | Medium | **Left**: needs a sentence per verb and noun pair per language, which is a translator's task; the columns around it are translated |
| C16 | Rule inspector, rules library (de, ja) | check class names ("Allowed values") come from `lib/format.ts` and have no German or Japanese entry | Low | **Left**: the 40 names belong in the catalogue with the check library's owner; they show in English |

## States

| # | Screen, state | Finding | Sev. | Status |
|---|---|---|---|---|
| S1 | Landscape, empty tenant | one dashed frame with one sentence for a new administrator | High | Fixed: three numbered steps (connect or upload, run, read), the done ones marked, the current one with the canvas's only primary button or the permission it needs; also shown above the matrix when systems are connected but not analysed |
| S2 | Every canvas, print | no print styles: the map, inspector and status strip printed, the canvas cut | Medium | Fixed: `print.css` |
| S3 | Every grid, a cut value | no way to read a cut cell | Medium | Fixed: the full value on hover |
| S4 | Every grid, loading | eight skeleton rows whatever the frame, so the page jumped when rows arrived | Medium | Fixed: the skeleton fills the frame |
| S5 | Work, loading | the sentence, the steward's next step and the count line appeared late and pushed the ledger down 52 px | Medium | Fixed: skeletons in their places |
| S6 | Object, loading | the related objects line appeared late | Low | Fixed: skeleton at its height |
| S7 | Inspector, opening | (new with S-P2) a body loads on first open | n/a | A skeleton in the inspector's own frame |
| S8 | Object tabs, opening | (new with S-P3) a tab loads with its address | n/a | A skeleton of the tab's table |

## Layout and grid

| # | Screen, state | Finding | Sev. | Status |
|---|---|---|---|---|
| G1 | Every page, top bar | the scope button's chevron fell under the bar (a system screen's `.m2-scope` grid rule applied to it) | High | Fixed |
| G2 | Every page, status strip with a failed job | the mark floated above a sentence cut without an ellipsis | High | Fixed: one line, ellipsis, whole sentence on hover |
| G3 | Many screens, depending on what loaded first | ten class names defined twice by different screens (`m2-banner`, `m2-pop`, `m2-sim`, `m2-chg`, `m2-filters`, `m2-note`, `m2-fld`, `m2-scope`, `m2-seg`, `m2-pick`): a page looked different after visiting another | High | Fixed: one meaning each |
| G4 | Every screen | 154 raw px paddings, margins and gaps, many off the 4 px grid (2, 3, 5, 6, 7, 10, 14) | Medium | Fixed: tokens only, and `lint:tokens` now rejects a raw px spacing value in `design/v2` and `app/` |
| G5 | Administration, Users and every grid narrower than its frame | header and row rules stopped short of the frame's edge | Medium | Fixed: the last column takes the rest |
| G6 | Administration, Users; every filter row | the export button aligned with the labels, not the inputs | Low | Fixed |
| G7 | Run | the Compare control sat 12 px below the button line | Low | Fixed |
| G8 | Landscape, coverage header | the verdict count floated in the middle of the line | Low | Fixed: beside the heading |
| G9 | Work toolbar | the grouping and density controls indented by a button's padding | Low | Fixed (part of G3) |
| G10 | Landscape with the inspector open | "capped" and "No-go" drawn on top of each other in narrow matrix cells | High | Fixed: the verdict wraps under the ruler |
| G11 | Object rules tab at 390, German | the segmented control scrolled out of sight | Medium | Fixed: it wraps inside its frame |
| G12 | Phone, map sheet | 12 px sides | Low | Fixed: the 16 px gutter, a 48 px header |
| G13 | Every canvas | gutter 32 at desktop, 20 on tablets | Low | Fixed: `--m2-gutter` 24, 16 on a phone |
| G14 | Object, receipt | the explanation buttons were 20 px targets | Medium | Fixed: 24 px |
| G15 | Object, related objects | links 18 px high with neighbours above and below (Lighthouse target size) | Medium | Fixed: 24 px |
| G16 | Object, score chart | "100" over "90 go" and "50" over "60 critical" on the axis | Low | Fixed: a scale number beside a band label keeps its tick only |
| G17 | Record inspector, facts | `MARA-MEINS` broke after the hyphen | Low | Fixed |
| G18 | Every list | the owner's 36 px list row | Low | **Left**: `--m2-row-h-list` is defined; the grid keeps its 32 and 28 rows, and moving every list to 36 is a density change for the design owner to decide |

### The grid pass

The grid is defined once in `design/v2/tokens.css`: `--m2-s1` to `--m2-s12` (4, 8, 12, 16, 20, 24, 32, 40, 48), the
canvas gutter (24, 16 on a phone), section gap 24, block gap 16, list row 36, header 48, the map 280 and the inspector
400. `?grid=1` draws the 8 px grid, the gutters and the column bounds over any page of the shell
(`design/v2/shell/GridOverlay.tsx`, off by default).

Fixes per screen (declarations moved onto the tokens, plus the alignment fixes above):

| Screen | Spacing values | Alignment |
|---|---:|---:|
| Shell: top bar, map, canvas, status strip, inspector frame, grid, command line | 69 | G1, G2, G5, G13 |
| Landscape | (shell) | G8, G10 |
| Object and its tabs | 36 | G11, G14, G15, G16 |
| Work ledger and batches | 10 | G6, G9 |
| Runs, run, compare | 25 | G7 |
| People and approvals | 6 | |
| Administration | 66 | G6 |
| Systems and connect | 19 | |
| Inspectors and panels | 28 | G17 |
| Sign-in pages | 1 | |

Before and after with the grid drawn: `e2e/__screenshots__/polish/before-after/grid-{landscape,object,work,run,people,admin}-{before,after}.png`.

## Navigation

| # | Screen, state | Finding | Sev. | Status |
|---|---|---|---|---|
| N1 | Every page | the browser tab read "Meridian" on every page: the layout's title was written after the page's own | High | Fixed: "Work – All objects – Meridian", held against the late write |
| N2 | Signed-out pages | reset password, accept invitation and licence pages were titled "Sign in" | Medium | Fixed |
| N3 | Runs, object rules tab, rules library, system configuration | filters kept in component state: reload, Back and a shared link lost them | Medium | Fixed: in the address |
| N4 | Command line | typing "reports", "webhooks", "Administration" or "Einstellungen" found nothing | High | Fixed: every canvas, panel and permitted administration section by name, after the server's results |
| N5 | Every link | (crawl) | | Verified: 500 pages, every link 200 or a redirect to 200 |
| N6 | Help panel | the right chapter on every route | | Verified: `lib/v2/help.test.ts` maps every route; the panel opened on the landscape, object, work and administration |

## Honesty

| # | Screen, state | Finding | Sev. | Status |
|---|---|---|---|---|
| H1 | Audit log | a refused request (403) read "created the report" | High | Fixed (C7) |
| H2 | Waves panel | promised a feature "in step 9" that has shipped | High | Fixed (C2) |
| H3 | First steps | the duration of a first analysis is not promised; the step says the prediction appears before the run starts (step 10's run prediction) | | Written so |

## Performance

| # | Screen, state | Finding | Sev. | Status |
|---|---|---|---|---|
| P1 | Every page, the sign-in page included | the German and Japanese catalogues (two thirds of a 971 KB chunk) loaded for every reader | High | Fixed: English ships, the preferred language is fetched once |
| P2 | Every page of the shell | the code of all 36 inspectors and panels in the shell | High | Fixed: each loads on first open |
| P3 | Object pages | every tab's code (lineage graph, process designer, golden records) on every tab | Medium | Fixed: each tab loads with its address |
| P4 | Every page of the shell | layout shift 0.032: the attribution strip jumped from the top of the page to the bottom when the shell rendered | Medium | Fixed: the shell's place is held at full height |
| P5 | Work as a steward | layout shift 0.38 | High | Fixed: 0.018 |
| P6 | Every page | 13 KB of legacy JavaScript and render-blocking CSS that Lighthouse reports | Low | **Left**: the framework's own polyfills and the route CSS |
| P7 | Object, fixture mode | total blocking time 240 to 260 ms at the median on the shared runner, performance 88 | Medium | **Left**: the long tasks are the fixture dataset being built in the page and the rules grid's first render; measure again on a quiet machine against a live API before tuning the rules grid |

Measured on the production build, fixture mode, 1440, Lighthouse 12 desktop preset, three runs per page, twice. The
box is a shared four-core runner (load average 6 to 8 during the runs, other builders' servers on it), which moves
total blocking time by 100 to 200 ms from one run to the next; each cell gives the median and, in brackets, the three
runs. Fixture mode also builds its whole dataset in the page (25,712 ledger rows, every receipt), work a deployment
does on the server, so these figures are a floor.

| Page | Performance before | After, set A | After, set B | Accessibility before | after | CLS after |
|---|---:|---:|---:|---:|---:|---:|
| Landscape | 87 | 93 (87, 93, 94) | 91 (85, 91, 91) | 100 | 100 | 0 |
| Object | 84 | 88 (80, 88, 91) | 88 (76, 88, 92) | 97 | 100 | 0.019 |
| Work | 88 | 94 (91, 94, 95) | 82 (78, 82, 91) | 100 | 100 | 0.018 |
| Administration, Users | 94 | 95 (95, 95, 97) | 86 (84, 86, 94) | 100 | 100 | 0.044 |

Accessibility is 100 on all four. Performance reaches 90 on every page in a quiet run and at the median on three of
four in set A; the object page's median stays at 88 in both sets (P7).

JavaScript per page (compressed, from the browser), before and after:

| Page | Before | After | Beyond the framework chunks shared by every page |
|---|---:|---:|---:|
| Landscape | 801 KB | 543 KB | 210 KB |
| Object | 831 KB | 560 KB | 227 KB |
| Work | 801 KB | 543 KB | 210 KB |
| Administration | 786 KB | 524 KB | 191 KB |
| Process designer | 851 KB | 579 KB | 246 KB |
| Sign in | 555 KB | 353 KB | 20 KB |

No page is over about 300 KB beyond the shared chunks.

## Accessibility

| # | Screen, state | Finding | Sev. | Status |
|---|---|---|---|---|
| A1 | Record inspector, History tab | "open the run" links inside a grey sentence told apart by colour only (axe, serious, found by `v2-step10.spec.ts`) | Medium | Fixed: a link inside a meta sentence is underlined, as in every other sentence |

## Craft pass

| # | Ask | What was done | Status |
|---|---|---|---|
| K1 | First impression per role | The landscape for each role at 1440 and 390 (`polish/01` to `05`): the sentence, the role's one next step and the matrix in one column; the coverage count beside its heading; the matrix no longer collides when the inspector opens | Fixed |
| K2 | Motion and feedback | Motion stays on the token durations and stops under reduced motion (unchanged, covered by `v2-a11y.spec.ts`); skeletons replace spinners where a body or tab loads; no layout shift on the measured pages | Partly: the 100 ms acknowledgement of every action was not measured action by action. **Left** for a scripted timing pass |
| K3 | The ruler and the receipt | Every rect and line of the ruler snaps to device pixels (`shape-rendering: crispEdges`) at 48 and 240 while the geometry keeps the exact weights; the axis labels no longer overlap; the receipt prints whole | Fixed |
| K4 | Tables and the ledger | Fill-down, multi-select, sticky header, pinned column and 100,000 rows were already there (Grid tests, the 100,000-row timing test); added: full value on hover, the frame-filling last column, skeletons at the frame's height | Fixed |
| K5 | One primary per canvas | Checked on every screenshot: one data-hue button per canvas; destructive actions keep their confirmation with the consequence in words | Verified |
| K6 | Microcopy | Empty states, errors and confirmations touched above in three languages; relative dates in Administration ("11 days ago") carry the exact date and time on hover | Fixed |
| K7 | Lighthouse | Table above: accessibility 100 on all four, performance 90 and over on three of four at the median | Partly: the object page, P7 |
| K8 | Print and export | `print.css`; Excel exports already take the visible columns in screen order with the screen's headers (`lib/v2/grid-export.ts`) | Fixed |
| K9 | Sign-in to first value | The three-step start (S1) | Fixed; the screenshot of it is the unit test `Landscape.test.tsx`, "an empty tenant gets three steps", because the fixtures describe a running tenant |

Left in the craft pass: K2 (timed acknowledgement per action), K7 (the object page, P7) and the empty-tenant screenshot
(K9), each for the reason in its row.

## Screens

`e2e/__screenshots__/polish/` holds one screenshot per canvas and major state at 1440 light (61 files: the landscape per
role, waves, the inspectors, every object tab, the rule, the ledger and its record inspector, approvals and exceptions,
runs and jobs, a run and a comparison, people, reports, the rules library, a system and connecting one, every
administration section that changed, help, inbox, preferences, triage, waves and contracts panels, status, the signed-out
pages, not found and the grid overlay). `polish/before-after/` holds the landscape, object and work canvases before and
after this pass, and the six canvases with the grid drawn before and after.

## Verification

Against the production build of this pass (`npm run build`, no warning), from `frontend/`:

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | clean |
| `npx eslint --max-warnings 0 .` (now over `design/v2` too) | clean |
| `npm run lint:tokens` (with the spacing rule) | ok, allow list empty |
| `node scripts/i18n-extract.mjs` | 4,095 keys used, 0 untranslated, 0 missing, 0 gaps |
| `npx vitest run` | 1,265 tests: 1,264 passed; the one failure is the known Grid 100,000-row timing test under load, which passes on its own (15 of 15 in `Grid.test.tsx`) |
| `npx playwright test` (all specs, 398 tests, three workers) | 380 passed, 10 skipped by their own conditions, 8 failed: 4 in `v2-help.spec.ts` counted 10 What's new lines where the step 10 merge made 11 (the test fixed), 4 in `v2-step10.spec.ts` were A1 (fixed); both specs then 40 of 40 |
| `v2-a11y.spec.ts`, `redirects.spec.ts`, `sign-in-states.spec.ts` again on the final build | 72 of 72 passed: axe on every page in three languages, light and dark, with no critical or serious violation; the 200 % zoom, reflow, keyboard and reduced-motion checks |
