# Meridian object-and-run-first redesign

## Review addendum (overrides the spec below where they conflict)

1. **Dashboard bug cause.** The confirmed cause of "the dashboard only shows SuccessFactors" was `_SYSTEMS_SQL` dropping the inactive ECC system, fixed by commit c8b38166 on this branch. `build_status` being tenant-wide is a separate weakness, still to be closed.
2. **Density beats restraint.** Ignore "everything else on the page is quiet" and any "one bold thing" reading that thins a screen. The owner has rejected quiet designs repeatedly. Every screen carries dense, real charts built from real data (Data cockpit direction), light mode by default. The Run Ribbon is the signature inside that density, not a substitute for it.
3. **Currency.** Mock copy that says EUR is illustrative. Currency always comes from the cost model.
4. **No customer or server names** in product copy, fixtures or docs.
5. **Backend gaps 1 to 3 in section 9 are closed in the build,** not shipped as dashes or as the ordinal run-number fallback. `/runs/timeline` returns `run_number`, `status`, and per-object `findings_open/new/closed` and `value_at_risk`. `GET /status` becomes per system and per object.
6. **`/config`.** Check whether it is scoring configuration or tenant administration before placing it in the menu.
7. **Tables.** Every code in a table shows its text beside it (`CodeWithText`).
8. **Delivery.** All stages commit to one branch, `feat/object-run-first`, so the work lands as few large PRs rather than six.

---


Design authority: lead product designer (Fable). Builders: Sonnet, one screen at a time, grouped into the PRs in section 7.
Repo read: `Meridian_2/.claude/worktrees/aletheia-ledger` at origin/main 966d1cdc. Design only. No product code was changed.
Dev server was down during this pass (`localhost:3011` unreachable), so there are no screenshots; every claim about current behaviour below is from source, and anything not verified in source is marked **unverified**.

---

## 0. What is wrong, in the code, and what this spec changes

| Owner complaint | Root cause found | Decision |
|---|---|---|
| "the dashboard only shows the successfactors and not the material master" | `StatusStrip` reads `useStatus()` which calls `build_status()`, which uses tenant-wide `latest_run(db, tenant.id)`: newest finished run wins, so the whole home strip describes one stream. `_SYSTEMS_SQL` also filters `s.is_active`, so the finished ECC runs vanish when that system is switched off. | Home becomes an object-by-run board. The strip is per system. Inactive systems stay visible with an "Inactive" chip. |
| "Run 2" is ambiguous | `run_number` restarts per system. `/runs/timeline` does not return `run_number` or `status`; `RunTimelineMenu` labels runs by date only, and when no system is scoped it interleaves both streams. | One run label format everywhere: `{System} run {n}` with the date as secondary text. Run pickers are always per object, never tenant-wide. |
| "the frontend is not built for multiple objects and multiple runs" | `?run=` re-scopes the whole canvas to one run id; the object page also accepts `?as_of=` and a receipt with its own `run_id`; the banner shows latest counts for a picked run (mixed state). | Section 2: a strict page-state rule (one run per object per page, never mixed), a per-object run picker, `?run=` only, `?as_of=` retired. |
| "we need a way to look at the system per run and version for the data objects that were run" | Landscape `scope=current` is already per-object latest (good); there is no screen that shows objects x runs. | New Objects board (`/objects`) is the product spine: every object, every run, score, findings, trend, drill-in. |
| "the menu is terrible" | `MapPane` is a flat list of 28 routes in four groups with a systems tree underneath; group names are internal ("Programme", "Rules and Aletheia"); there is no description, no sense of order, and the spine (objects and runs) is buried below "Requests". | Section 3 replaces the menu outright with a seven-destination rail plus a flyout. |
| "plain boring", "no wow factor", "so basic, confusing" | Chrome is fine (quiet, tokenised); the signature moments are missing. Scores sit in text, trends are 8-run sparklines with no labels, nothing on screen says "this is verified". | Section 4: one signature object (the Run Ribbon), the Verified mark, the Ruler used as the only score glyph, a tokenised verdigris glow reserved for Aletheia-verified facts. Density stays. |

---

## 1. Vocabulary (used in copy, in code names, and in this document)

Plain words only. These replace "stream", "analysis version", "canvas scope", "as of".

- **System**: a connected source (for example an ECC client or a SuccessFactors tenant). Shown by its display name as set in Systems. Never a hostname or a customer name in product copy.
- **Object**: a licensed data object inside a system (Material master, Employee central, and so on). Nine on the SuccessFactors system, one on the ECC system today.
- **Run**: one scoring pass of one system. Runs are numbered per system. The full label is `{System} run {n}`; a short label `run {n}` is allowed only inside a page that is already scoped to one system.
- **Current**: for each object, its own latest finished run. "Current" is never one run id for the whole tenant.
- **Baseline**: the run marked `baseline` on `/runs/timeline`; the trend always shows it.
- **Verified**: a figure Aletheia has checked against evidence. Shows the Verified mark (section 4.4). Anything else is "Measured".
- **Inactive system**: a system whose connection is off. Its runs stay visible and openable; its cards carry an "Inactive" chip and no "Run again" action.

Copy rule: a user manages objects and runs. They never see "analysis_version", "canvas", "scope", "dqs" or "tenant".

---

## 2. The spine: objects by run

### 2.1 The page-state rule

Every page shows, for every object on it, exactly one run per object, and says which. There are two legal page states:

1. **Current**: each object at its own latest finished run. Default everywhere. URL has no `?run=`.
2. **Pinned run**: one system's run `n`. URL has `?run=<uuid>`. Only objects in that system are shown scored; objects from other systems collapse to a "not in this run" row rather than silently showing their own latest.

There is no third state. A banner may never show counts from one run beside a score from another. The receipt on the object page must be fetched for the same run id as the score (`useReceipt(apiModule, run)` with the pinned run, or with the object's own `latest_run_id` from landscape when Current). `?as_of=` is retired: it is redirected to `?run=` by the object route frame (one line in `routes.tsx`), and `RunTimelineMenu`'s "As of" select is removed.

### 2.2 Run labelling

- Chip format: `SuccessFactors run 2` then, in muted text, the date (`3 Nov 2026`). Tooltip adds records checked, duration, and status.
- Status words on a run: `Finished`, `Finished, Aletheia checked` (status `agents_complete`), `Running`, `Failed`, `Archived`. "complete" and "agents_complete" never appear in the UI.
- Baseline run carries a small `Baseline` tag after the chip.
- When two runs of different systems sit in one list (the Runs screen), the system name is always in the label. Date is never the only identifier.

Backend need: `/runs/timeline` must return `run_number` and `status`. Until it does, the frontend may derive `run_number` by ordinal within the system's timeline (oldest first) and must label it `run {n}` with a tooltip "numbered by order; the backend has not confirmed the run number". That fallback is temporary and tracked in section 9.

### 2.3 The Objects board (`/objects`, new)

The spine screen. Dense, scannable, and the first place a new user is sent after Home.

```
+-----------------------------------------------------------------------------------------------+
| Objects                                                       [Current v] [Compare] [Export]   |
| Every licensed object, scored at its own latest run. Pick a run to see the system as it was.   |
+-----------------------------------------------------------------------------------------------+
| SuccessFactors   Active    run 2 (3 Nov)   9 objects   78 Go  v  [Run again]                   |
|  Object                 Score   Ruler            Trend r1 > r2    Findings   At risk   Verified|
|  Employee central        84     [======  ]       80 -> 84  +4      1,204      -          yes   |
|  Compensation            71     [=====   ]       74 -> 71  -3        612    EUR 48k      yes   |
|  Benefits                 -     [        ]       no findings        0         -          -     |
|  ...                                                                                           |
| ECC              Inactive  run 2 (14 Oct)  1 object    62 At risk  v                           |
|  Material master         62     [====    ]       58 -> 62  +4      9,870    EUR 1.2m     yes   |
+-----------------------------------------------------------------------------------------------+
```

- Grouped by system, system header row = system name, Active/Inactive chip, run chip for the run shown, object count, system score word (Go / At risk / No-go) and a "Run again" action (hidden when inactive).
- One row per object. Columns: Object (name plus one-line description from the object catalogue), Score (the number), Ruler (the six-segment ruler, 96 px), Trend (the Run Ribbon, section 4.2), Findings (count, open), Value at risk (currency or dash), Verified (Verified mark or "Measured").
- Click a row: opens the object page at the run shown. Click a point on the ribbon: opens the object page at that run. Click a system header: opens the System page.
- A `Current v` control at the top switches the whole board to a pinned run. Its options are grouped by system, so the user picks "SuccessFactors run 1", never "Run 1". Picking a run greys the other system's rows to the "not in this run" state (score cells show a dash, the row stays so the user keeps their bearings).
- `Compare` opens a two-run picker scoped to one system and goes to `/run/{a}/vs/{b}`.
- Objects with no findings: score cell shows a dash, trend column says "no findings in this run", row is not greyed (it is a real result, not an error).

Data source: `useLandscape()` with `scope=current` (already per-object latest via `_CELL_RUNS_SQL`) for the rows; `useTimeline(systemId, limit)` per system for the ribbon points; findings count and value at risk per object per run: **backend gap** (landscape cells do not carry findings or money per run; see section 9).

States: loading = skeleton rows with the ruler outline; empty tenant = "No objects scored yet. Connect a system to start." with a Connect button; error = inline error band with retry, never a blank; pinned-to-old-run = amber band "You are looking at SuccessFactors run 1, 2 Oct. Current is run 2." with "Back to current" link; inactive system = chip plus explanatory line "Connection is off. Finished runs stay here."

### 2.4 Object page (`/o/{system}/{object}`) at any run

Header is the only place that shows run selection, and it is per object:

```
Material master   ECC   Inactive                     Run: [ECC run 2, 14 Oct  v]   [Compare with run 1]
62  [====    ]  At risk     +4 since run 1     9,870 findings     EUR 1.2m at risk     Verified
Run Ribbon: r1 58 ---- r2 62                              Baseline r1
Tabs: Overview | Rules | Records | Fixes | Trend | Readiness | Processes | Lineage | Profile | Glossary | Golden
```

- The run picker lists only this system's runs, newest first, each as a full chip. Picking one sets `?run=` and reloads score, receipt, rules, records and fixes for that run id. Nothing on the page may read a different run.
- "Overview" is new as the default tab and replaces the current implicit landing. It holds: the headline strip above, the run ribbon, the top five failing rules (with description), the top five fields by findings (code and description), and one obvious next action ("Open 1,204 open findings in Work" or "Review 32 fix drafts").
- "Trend" replaces the "runs" tab name. Content in 2.5.
- Old-run state: when `?run=` is not the object's latest, a persistent band under the header: "This is run 1 of 2. Scores and findings are as they were on 2 Oct." with "Go to current". Actions that change data (accept fix, mark not an issue) are disabled on an old run with the tooltip "Open the current run to act".
- Fixes tab on an old run shows what fixes existed then, read-only.
- Every tab keeps its existing data hooks; the only change is that the run id passed is the one from the header picker.

### 2.5 Trend for every object

Two runs today, many later. One component, `ObjectTrend`, in three sizes.

**Ribbon (inline, 120 x 20)**: used in tables and the menu. Points for each run, a line joining them, the baseline point filled, the latest point ringed. Score only. With two runs it is a line between two dots with the delta printed beside it (`+4`). With one run it is a single dot and "first run". Hover gives the full run chip and score.

**Card (full width, 220 high)**: used on Object Overview and Trend tab. Three series stacked as small multiples sharing one x-axis of run chips (not dates; dates in the tick tooltip): Score (0 to 100, ruler bands as faint horizontal guides), Findings (count, bars), Value at risk (currency, bars; the chart is omitted when the backend has no figure, replaced by a one-line "No value at risk is calculated for this object"). Never a dual axis.

**How it reads with two runs**: the card leads with words, not the line. Above the chart, a sentence built from data: "Up 4 points since run 1 (2 Oct). 1,140 findings closed, 310 new." The chart below shows the two points joined, delta bars between them, and the baseline label. The emphasis is the change, because with two points the slope is the whole story.

**How it scales**: at three or more runs the sentence changes to "Up 4 points since the last run, up 12 since baseline (run 1)". The line becomes a true line, the per-run delta bars become a DeltaBar row under the axis, and the x-axis thins run chips to `r1 r2 ... r12` with the full chip on hover. At 20+ runs, the Trend tab adds a date-range control (last 10 runs, last 90 days, all) in one row above the charts. Nothing else changes.

Data source: `useTimeline(systemId, 8)` gives score per object per run (raise the limit to 50 for the Trend tab); `getCompareSummary(a, b)` gives findings opened and closed between two runs (verified in `runs.ts`: `CompareSide`, `CompareObject`); per-run findings count and value at risk per object across all runs: **backend gap** (section 9).

### 2.6 Compare two runs (`/run/{a}/vs/{b}`)

Kept. Changes: the header shows both full run chips and refuses cross-system pairs with a clear message ("Compare runs of the same system. Material master was not scored in SuccessFactors run 2."); the object table shows score before, score after, delta, findings closed, findings new, and a Verified column; the record-level diff (`CompareRecords`) stays as a tab. Primary action: "Open what got worse" which deep-links to Work filtered to findings new in run b.

### 2.7 Runs (`/runs`) and Run detail (`/run/{id}`)

Runs becomes a ledger of runs grouped by system, newest first, each row a full chip with status word, records checked, duration, objects scored, score word, and a "Compare with previous" button. The old date-axis `RunTimelineChart` moves inside each system group as a secondary element with run numbers as the tick labels. Run detail keeps `RunSteps` and `ScoreDeltaPanel`, adds the object list for that run (what was scored, score each, link to the object at this run), and a top line that says in words what changed since the previous run of the same system.

---

## 3. The menu, replaced

### 3.1 Why the current menu fails a new user

Twenty-eight links in four groups with no descriptions. Group names describe the product's internals, not the user's job. The spine (objects, runs) is below "Requests". Nothing is pinned, so the eye has no anchor. There is no "where am I" beyond a highlighted row.

### 3.2 The final tree

Seven destinations. Each has a verb-free, two-word-maximum label, one line of plain description shown in the flyout, and owns a fixed set of routes. Every existing route is mapped; nothing is orphaned.

```
Home                 /                      What needs attention today, across every system.
Objects              /objects               Every object, scored at its latest run. Open any object at any run.
   SuccessFactors   /s/{id}                 (tree, one row per object with score and ribbon)
      Employee central   /o/{sys}/{obj}
      ...
   ECC  (Inactive)  /s/{id}
      Material master
   + Connect a system   /s/new
Runs                 /runs                  Every scoring run, by system. Compare any two.
   Run detail        /run/{id}
   Compare           /run/{a}/vs/{b}
Fix                  /attention             Findings to act on, fixes to approve, people to chase.
   Action centre     /attention
   Work queue        /work                  (tabs: Triage /work/triage, Exceptions /work/exceptions, Monitor /work/monitor, Analytics /work/analytics)
   Fix drafts        /fix-drafts
   Cleansing         /cleansing
   Requests          /requests
   People            /people
Rules                /rules                 What is checked, how rules are promoted, and what Aletheia learned.
   Rules library     /rules                 (rule detail /r/{id})
   Promotion         /rule-promotion
   Dry run           /rule-dry-run
   Learned rules     /anomaly-rules
   Monitors          /monitors
   Survivorship      /aletheia-survivorship
   Evidence ledger   /aletheia/evidence     (slot for the upcoming Aletheia evidence ledger; `Ledger.tsx` and `AletheiaFound.tsx` exist but their final route is unverified)
Master data          /mdm                   Entry gate, reference data, links and the health of what is already clean.
   MDM health        /mdm
   Entry gate        /entry-gate
   Reference data    /reference-data
   Links             /links
   Materials         /materials
   Issues            /issues
   Mining            /mining
   Processes         /processes             (designer /o/{sys}/{obj}/processes/design)
Migration            /migration             Readiness for S/4, value, forecast and go-live.
   Migration         /migration
   S/4 readiness     /s4
   Go-live           /go-live
   Forecast          /forecast
   Value             /value
   Score lens        /score
   Insights          /insights
   Settings          /config

Below the rail, small:   Reports /reports    Atlas /atlas    Administration /admin (sections /admin/{section})
Account menu (top bar, unchanged position): theme, preferences, shortcuts, Triage and SLA, About, Sign out.
Not in the menu: /share/{token}, /status, (auth) routes.
```

Migration group holds "Settings" (`/config`) because `Config` is the scoring configuration (weights, thresholds) and belongs with the programme, not with user administration. If a build engineer finds `/config` is tenant admin instead, move it under Administration and say so in the PR.

### 3.3 How it looks and behaves

- **Rail**: 64 px wide, always visible, icon above a 11 px label for all seven destinations, in the order above. The active destination has a filled verdigris ring (`m2-ring`). Keyboard: `g` then the first letter (`g o` Objects, `g r` Runs, `g f` Fix, `g u` Rules, `g m` Master data, `g i` Migration, `g h` Home). The existing `keys.ts` "go" scope is extended; `g l` (Landscape) becomes `g h`.
- **Flyout**: hovering or focusing a rail item opens a 280 px panel to its right with the destination name, its one-line description, and its children as a list (label, short description, count badge where the backend supplies one: open findings on Fix, pending promotions on Rules). The Objects flyout is the system and object tree with score and ribbon per object. Clicking the rail item itself goes to the destination's landing route. The flyout pins open with a click on the pin icon; pinned state is stored per user in `localStorage` (a convenience, not state).
- **Breadcrumb in the top bar**: `Objects > SuccessFactors > Compensation > Trend`, every crumb a link. This replaces the "Map" button. The ScopeMenu (`?system=`) is removed from the top bar: scope is now a property of where you are, not a global switch. The RunMenu moves off the top bar onto the pages that have a run (Objects board, Object page, Runs) so the top bar never claims a tenant-wide run.
- **Search (Cmd K)** stays and gains destination descriptions in its index, so typing "promote" finds Rules > Promotion.
- **Mobile and narrow (< 1100 px)**: rail collapses to a bottom tab bar of the seven destinations; flyout becomes a full-height sheet.

### 3.4 Why a new user can find things

Seven items fit in working memory. The labels are the user's nouns (Objects, Runs, Fix, Rules) not the product's (Programme, Landscape). Each destination has one sentence that says what it is for, visible before the click. The spine is second from the top and its flyout shows the thing they came for (the objects, scored) without navigating. The breadcrumb always says where they are and how to go up. Keyboard chords are the first letters. Counts tell them where the work is. And every page has one primary button (section 5), so once they arrive they know what to do.

---

## 4. Visual identity: an instrument, not a dashboard

Keep: light default, IBM Plex Sans and Mono, the map/canvas/inspector shell, the deep blue bar, the Ruler, the heat ramp, the three shadow lifts, the verdigris Aletheia family, the type scale, density modes, motion tokens. All of these are already in `tokens.css` and pass `lint:tokens`.

Retire: the gauge anywhere it survives, the eight-run unlabelled sparkline in the map pane (`ScoreTrend`), the hero gradient panel on Landscape (`--m2-grad-hero` stays as a token for the Home headline only), "Landscape" as a word, the "Map" button, the ScopeMenu, the tenant-wide RunMenu.

### 4.1 The one bold thing

Spend the boldness on one element: the **Run Ribbon** (section 2.5). It appears on every object everywhere (menu flyout, Objects board, Object header, Runs rows, Compare). Its latest point is ringed in verdigris when the run is Aletheia-checked. Its line is drawn in the score colour of the latest run from the heat ramp. It is the only place where colour, motion (one 240 ms draw on first paint, respecting reduced motion) and the signature hue meet. Everything else on the page is quiet.

### 4.2 Run Ribbon spec

- Size: inline 120 x 20; header 320 x 44; card full width x 220.
- Points: 8 px markers, 2 px line, 2 px surface ring on the latest, baseline marker filled.
- Colour: line and markers use the heat token for the latest score band (`--m2-heat-0..3`); ring uses `--m2-ai`; text uses text tokens only.
- Labels: delta text to the right of the inline ribbon (`+4`, `-3`, `first run`), never a value on every point.
- Hover: tooltip with the full run chip, score, findings, verified word.
- Empty: a dotted 2 px baseline and "no runs" in muted text.

### 4.3 Score glyphs

The Ruler is the only score glyph. Three sizes: 48 (menu), 96 (tables), 240 (object header). Segments split at the configured thresholds; the fill ends at the score with a 4 px rounded end; a faint tick shows the previous run's score so change is visible without the ribbon.

### 4.4 Verified mark

A 14 px verdigris ring with a check, from `--m2-ai` and `--m2-glow-ai` only, followed by the word "Verified" in text colour. It appears next to any figure Aletheia has confirmed with evidence. It never appears on a measured-only figure. Hover: "Aletheia checked this against {n} evidence rows in {run chip}". It is the product's trust signature and it is the only glow on the page.

### 4.5 Surfaces and depth

Three lifts, already tokenised. Tables are flat (lift 0) on the canvas. Headline strips lift 1. The inspector lifts 2. No card-inside-card. No decorative gradients beyond the Home headline. Dark mode uses the same tokens; every chart colour is re-stepped for the dark surface (the dataviz validator must be run on both; the heat ramp and verdigris already exist as tokens, so the builder validates those values and reports the result in the PR).

### 4.6 Charts

Follow the dataviz method: one axis per chart, categorical colours assigned in a fixed order by object (the object's colour is stable across every screen, taken from a nine-step categorical theme added to tokens as `--m2-cat-1..9`), sequential magnitude in one hue, status colours reserved. Every chart ships with a table view toggle (ChartTable already exists) and a hover layer. Charts render real backend data only; a missing series is omitted and a one-line reason is printed where it would have been.

### 4.7 Copy

Sentence case. Plain verbs. Buttons say what happens ("Open 1,204 findings", "Compare with run 1", "Run again"). No tracked-out uppercase eyebrows. No middle dots in product copy (U+00B7 is forbidden under `frontend/`); use a comma or two spaces. Every code shows its description beside it: rule id and rule name, field code and field label, value and value text, record key and record description, plant code and plant name. The i18n `t()` wrapper covers every string, en, de, ja.

---

## 5. First-use ease

One obvious next action per page, placed top right as the only filled button; everything else is a quiet button or link. The first-run experience (`Welcome.tsx` exists) is shortened to three steps: Connect a system, Run it, Open Objects.

| Page | Primary action |
|---|---|
| Home | Open Objects (or Connect a system when none) |
| Objects | Open the worst object (named) |
| Object Overview | Open its open findings in Work |
| Object at old run | Go to current |
| Runs | Compare latest two runs of the named system |
| Run detail | Open what got worse |
| Compare | Open what got worse |
| Fix / Action centre | Start triage |
| Work queue | Accept the first suggested fix |
| Rules library | Open the rule with most findings |
| Promotion | Approve the top candidate |
| Dry run | Run the draft against current |
| Learned rules | Review the newest learned rule |
| Monitors | Open the breached monitor |
| Master data pages | the page's own create or review verb |
| Migration | Open S/4 readiness |
| Systems | Connect a system / Run again |

Empty states are directions, not moods: "No runs yet. Run this system to score its objects." with the button. Errors say what failed and what to do: "Could not load runs for SuccessFactors. Retry, or open Systems to check the connection."

Post-clean monitoring stays surfaced: Object Overview has a "Since cleansing" line reading from the monitors feed (`learned_monitors.py`, `drift_alerts.py`; exact hook **unverified**), and the Fix group keeps Monitors and Cleansing side by side.

ECC to S/4 views keep paired quality: Object Overview on an ECC object shows Source score, Projected S/4 score and, when a target run exists, Actual S/4 score, with the reasons they differ listed under them (from `migration.py` / S4Readiness; the reasons list is **unverified** as an endpoint and listed in section 9).

---

## 6. Screen catalogue

For each screen: purpose, primary action, data source, and the five states (empty, loading, error, old run, inactive system). Where a state is "n/a" the page has no run or system dimension. Hooks are from `lib/v2/runs-queries.ts` and existing screen files unless flagged.

### Spine screens (new or rebuilt)

**Home `/`** (rebuild of `Landscape.tsx`)
Purpose: what needs attention across every system, today. Layout: a headline strip per system (name, Active/Inactive, run chip, score word, ruler 96, ribbon, open findings, value at risk), then three columns: "Worst movers since last run" (objects with the largest negative delta, from timeline), "Fix queue" (top five from `attention.py`), "Verified this week" (Aletheia facts with the mark, from the evidence ledger when it exists; until then from `aletheia_anomaly_rules.py`, **unverified**). Data: `useLandscape()` current, `useTimeline` per system, `useStatus` per system (**backend gap**: `build_status` is tenant-wide). States: empty = connect prompt; loading = strip skeletons; error = per-system band; old run = n/a (Home is always Current); inactive = chip and no Run again.

**Objects `/objects`** (new): section 2.3.

**Object `/o/{system}/{object}`** and tabs: section 2.4. Existing tab components (`Rule`, `RecordCanvas`, `RunsTab` renamed Trend, `ReadinessTab`, `ProcessesTab`, `LineageTab`, `ProfileTab`, `GlossaryTab`, `GoldenTab`, `LedgerSlot`) stay; each receives `run` from the header picker. Record detail `/o/.../records/{key}` opens in the inspector (`RecordInspector`) with the run chip in its title.

**Runs `/runs`, Run `/run/{id}`, Compare `/run/{a}/vs/{b}`**: sections 2.6 and 2.7. Data: `useTimeline`, `useRunSteps`, `useScoreDelta`, `useCompareSummary`, `useCompareRecords`, `useVersionChanges`. States: empty = "No runs yet"; loading = chip skeletons; error = band; old run = n/a (a run page is a run); inactive = chip on the system header, runs still open.

**System `/s/{id}`** (`System.tsx`): purpose: this system's objects, runs, extractions and connection. Add the Inactive chip, keep extractions (`useSystemExtractions`), profiles, config load, object list. Primary: Run again (hidden when inactive). **Systems `/s`** lists systems with the same header strip as Home. **Connect `/s/new`** unchanged in flow, restyled.

### Fix group

**Action centre `/attention`** (`Attention.tsx`): findings ranked by value and age from `attention.py`. Primary: Start triage. States: empty = "Nothing needs attention. Next run is scheduled for {date}" (date **unverified**); run dimension: shows Current only, with the run chip per object in each row.
**Work `/work` and tabs** (`Work.tsx`, `Triage`, `Exceptions`, `WorkMonitor`, `WorkAnalytics`): the fix ledger. Keyboard scope "ledger" already exists. Each row shows its object and run chip; acting is allowed only on Current rows.
**Fix drafts `/fix-drafts`**, **Cleansing `/cleansing`**, **Requests `/requests`**, **People `/people`** (and `PeopleActions`): keep data hooks; restyle to the catalogue; add the one primary action; add the object and run chip to every row that has one.

### Rules group

**Rules library `/rules`** (`RulesLibrary.tsx`, `RuleOverview`, `RuleRootCause`), **Rule `/r/{id}`**: each rule shows id and name, its object, findings in the Current run, and a ribbon of findings per run (from compare summaries; **backend gap** for more than two runs). **Promotion `/rule-promotion`**, **Dry run `/rule-dry-run`**, **Learned rules `/anomaly-rules`**, **Monitors `/monitors`** (`LearnedMonitors`, `ObjectMonitors`), **Survivorship `/aletheia-survivorship`**: keep hooks, restyle, primary action per table above. **Evidence ledger `/aletheia/evidence`**: reserved. Shell, menu entry and empty state ("Aletheia evidence will appear here after the next checked run") are built in PR 5; the content is specified by its own upcoming spec.

### Master data group

**MDM health `/mdm`**, **Entry gate `/entry-gate`** (`EntryGate`, `EntryDuplicates`), **Reference data `/reference-data`**, **Links `/links`**, **Materials `/materials`** (`Material.tsx`), **Issues `/issues`**, **Mining `/mining`**, **Processes `/processes`** (`ProcessDiscovery`, `ProcessDesigner`): keep hooks and content; restyle; add descriptions beside every code; add the system chip where the page is system-specific. Processes keeps the as-is L5 discovery view with a run chip (discovery runs are a separate kind on the timeline, `kind` field, and are excluded from score trends).

### Migration group

**Migration `/migration`** (`Migration`, `MigrationScenarios`, `WhatIf`, `BlastRadius`), **S/4 readiness `/s4`** (`S4Readiness`), **Go-live `/go-live`** (`FlightDeck`), **Forecast `/forecast`**, **Value `/value`**, **Score lens `/score`** (`ScoreLens`), **Insights `/insights`**, **Settings `/config`**: keep hooks; restyle. S/4 readiness and Migration show source and target quality paired per object (section 5). Value shows value at risk per object with its ribbon where the backend has the series.

### Other

**Reports `/reports`**, **Atlas `/atlas`**, **Administration `/admin`, `/admin/{section}`**, **Share `/share/{token}`**, **Status `/status`**: restyle only. Share pages show the run chip and the Verified mark exactly as the app does, read-only.

Screens with no route found in `app/(v2)`: `Cockpit`, `CommandCentre`, `Ledger`, `AletheiaFound`, `BasisHome`, `Status` (served by `(v2status)`), `Welcome` (likely rendered by Home when empty, **unverified**). `Cockpit` and `CommandCentre` are superseded by Home and Objects and should be deleted in PR 2 if nothing imports them.

---

## 7. Build order: six PRs

Each PR is one branch, many commits, opened not auto-merged. Builders use fixtures (`?fixture=1`) with no personal data and verify `lint:tokens`, the U+00B7 check, and i18n keys for en, de, ja before opening.

**PR 1: Run model and shell** (unblocks everything)
- `scope.ts`: `?run=` only; `useObjectRun(systemId, module)` returns `{runId, isLatest, chip}`; redirect `?as_of=` to `?run=`.
- Run chip component, run label formatter, status word map.
- New rail and flyout replacing `MapPane` and `m2-mnav`; breadcrumb replacing Map button; remove ScopeMenu and tenant-wide RunMenu from the top bar; extend `keys.ts` go chords.
- StatusStrip becomes per-system strips (reads landscape systems and each `latest_run_id`), no tenant-wide `useStatus` on Home.
- Tokens added (section 8). Nothing visual beyond the shell changes yet.

**PR 2: The spine**
- Objects board `/objects`; Home rebuild; Object header with per-object run picker and Overview tab; Run Ribbon and ObjectTrend in three sizes; Trend tab; old-run band and action gating; delete `Cockpit` and `CommandCentre` if unreferenced.

**PR 3: Runs and compare**
- Runs ledger grouped by system; Run detail with object list and change sentence; Compare with same-system guard and "Open what got worse".

**PR 4: Fix group**
- Attention, Work and its tabs, Fix drafts, Cleansing, Requests, People: restyle, run chips on rows, primary actions, Current-only gating on actions.

**PR 5: Rules and Aletheia**
- Rules library, Rule, Promotion, Dry run, Learned rules, Monitors, Survivorship: restyle, descriptions beside codes, Verified mark where facts are checked; Evidence ledger route shell and empty state.

**PR 6: Master data and Migration**
- All pages in both groups: restyle, paired source and target quality on ECC objects, value at risk ribbons where the series exists, Reports, Atlas, Admin, Share.

Closing step after all six (per standing instruction): refresh help videos and the admin guide.

---

## 8. Shared components and tokens

Add
- `RunChip` (full and short, with status word and baseline tag).
- `RunPicker` (per system; grouped when a board spans systems).
- `ObjectTrend` (ribbon, header, card) built on `TrendChart`, `DeltaBar`, `ChartFrame`.
- `VerifiedMark`.
- `SystemStrip` (Home and Systems header row).
- `OldRunBand`, `InactiveChip`, `NotInThisRunRow`.
- `Rail`, `Flyout`, `Breadcrumb`.
- `CodeWithText` (renders `code  description` for rule, field, value, record, plant; used by every table).
- Tokens: `--m2-cat-1..9` (categorical by object, validated with the dataviz script in light and dark), `--m2-rail-w: 64px`, `--m2-flyout-w: 280px`, `--m2-ribbon-h` three sizes, `--m2-ring-verified` (alias of `--m2-ai`). No raw hex outside `tokens.css`; `lint-tokens.allow.txt` stays empty.

Retire
- `MapPane`, `m2-mnav`, `ScoreTrend` (8-run unlabelled sparkline), `ScopeMenu`, top-bar `RunMenu` and `RunTimelineMenu` "As of" select, `useRunPicker(latestId)` tenant semantics, the hero gradient panel on Landscape, any gauge, the "Map" button, `Cockpit.tsx`, `CommandCentre.tsx` if unreferenced.

Keep unchanged
- Inspector (`?open=kind:id`), Ruler, heat ramp, shadows, type scale, density modes, motion tokens, chart grammar, keyboard scopes, i18n plumbing, `V2Link` fixture handling.

---

## 9. Backend gaps (frontend must show a dash until closed)

1. `GET /runs/timeline` lacks `run_number` and `status`. Needed for every run chip. Add both; the frontend's ordinal fallback is temporary.
2. `GET /runs/timeline` objects carry `score, raw_score, capped` only. Needed per object per run: `findings_open`, `findings_new`, `findings_closed`, `value_at_risk` (currency and amount). Without these the Objects board Findings and At risk columns and two of the three trend series show a dash.
3. `build_status()` and `GET /status` are tenant-wide. Needed: `system_id` parameter or a per-system array in the landscape response.
4. `_SYSTEMS_SQL` in `landscape.py` filters `is_active`, so inactive systems disappear with their runs. Needed: return inactive systems with `is_active=false` (and keep them out of "Run again").
5. No single call for objects x runs; the board merges landscape current with one timeline call per system. Fine at two systems; add `GET /runs/matrix` when systems exceed five.
6. Per-rule findings per run across more than two runs (rule ribbon) has no endpoint; compare summary only covers a pair.
7. Reasons that source and target quality differ on ECC to S/4 views: endpoint **unverified** (`migration.py`, `S4Readiness`). If absent, the pane shows the three scores and a one-line "Reasons are not yet calculated".
8. Aletheia "verified" flag per figure: the `agents_complete` status is per run, not per figure. The Verified mark is shown at run level until a per-fact flag exists in the evidence ledger.
9. Next scheduled run date for empty states: **unverified**.

---

## 10. Acceptance checks for every PR

- No page mixes two runs of one object; a reviewer can name the run for every number on screen.
- Every run label includes the system name outside a system-scoped page.
- Inactive systems are visible, labelled, and openable.
- Every code in every table has its description beside it.
- Every chart has a table toggle, a hover layer, one axis, real data or a dash with a reason.
- `lint:tokens` passes with an empty allow list; no U+00B7 under `frontend/`; en, de, ja keys present.
- One filled primary button per page; empty and error states give a next step.
- Dark mode validated with the dataviz palette script for the categorical and heat tokens; result pasted in the PR.
