# Design refresh: palette, density, charts, first impressions, motion

The refresh keeps the interface's structure (the map, the canvas, the inspector, the ruler, the grid and the command
line) and refines what sits on it. The rules it follows are in `DESIGN.md`; this page shows the result, before and
after, on fixture data only (`?fixture=1` in a demo build). Every screenshot is 1440 by 900 unless it says 390 (a
phone).

## What changed

1. **Theme and palette.** The colours now come from two ramps, a cool slate neutral ramp and the Meridian blue ramp
   (step 700, `#1B3F8F`, is the brand blue). Semantic tokens name a step per theme: pass, warn, fail, critical and
   info, each with a mark colour, a wash and the ink on the wash. Light mode puts white sheets on a whisper of slate, so
   the canvas reads as the work surface without a shadow. A categorical palette of eight hues, a sequential blue scale
   and an ordinal severity scale serve the charts. Every pair is measured in light and dark by
   `design/v2/__tests__/tokens.test.ts` (text 4.5:1, marks 3:1), and the categorical hues by colour-vision checks
   (worst neighbours 9.6 simulated, 17.2 full vision). A tenant accent that does not reach 4.5:1 is clamped to the
   nearest shade of it that does, and the Appearance form offers that shade. Notices became washes instead of coloured
   left borders.
2. **Density.** Compact (28 pixel rows, 13 pixel text) and comfortable (36 pixel rows, 14 pixel text), chosen in
   Preferences and saved with the other preferences. Until a person chooses, stewards and SAP Basis start compact and
   everyone else comfortable. Tokens drive the rows, the cell padding and the text step; the virtual grid measures with
   the same heights.
3. **Chart grammar.** One set of components in `design/v2/charts`: the trend chart (the object's score over runs), the
   distribution (a run's objects by measured score), the stacked bar (findings by severity), small multiples (every
   object over the last runs), the sparkline (each object's trend in the map, a rule's failing records in its
   inspector) and the change bar (compare two runs). Same axes, labels, tooltip and states everywhere; each chart is
   reachable by keyboard, reads its points aloud and has its figures as a table.
4. **First impressions.** The sign-in page says what the product does beside the form, with the ruler drawn as the
   brand's picture; the Aletheia attribution strip stays under it. An empty tenant's landscape is one stepper that says
   which step it is on. A person's first visit opens with a short welcome (the map, the canvas, the inspector, the keys),
   kept away once dismissed.
5. **Motion and feedback.** State changes ease in 150 milliseconds; the inspector, menus and notices arrive in 200 by
   moving, never by fading their text; placeholders hold the final geometry of a canvas or an inspector and breathe
   while they wait; a notice waits while it is pointed at or focused. Nothing moves under reduced motion.
6. **Craft.** The run's status line wraps on a phone instead of running off the edge, the phone's ground is the sheet,
   the empty-tenant fixture (`?landscape=empty`) shows a tenant on its first day, and the score trend names its last
   value in ink beside a ringed end dot.

## Before and after

### Sign in

The bare card became a two-column page: the promise and three facts on the left, the form on the right.

| Before | After |
|---|---|
| ![Sign in, before](design-refresh/before-sign-in-d-light.png) | ![Sign in, after](design-refresh/after-sign-in-d-light.png) |
| ![Sign in on a phone, before](design-refresh/before-sign-in-m-light.png) | ![Sign in on a phone, after](design-refresh/after-sign-in-m-light.png) |

### Landscape

Slate ground and white sheets; the map's rows carry each object's trend under its ruler.

| Before | After |
|---|---|
| ![Landscape, before](design-refresh/before-landscape-d-light.png) | ![Landscape, after](design-refresh/after-landscape-d-light.png) |
| ![Landscape in dark, before](design-refresh/before-landscape-d-dark.png) | ![Landscape in dark, after](design-refresh/after-landscape-d-dark.png) |

The first visit, after only (the welcome is new):

![The welcome on a first visit](design-refresh/after-welcome-d-light.png)

### The empty tenant's guided start

Three cards became one stepper with the current step open. The before screenshot is the previous three cards rendered
on the empty-tenant fixture, which this refresh added, so it already carries the new palette.

| Before | After |
|---|---|
| ![Guided start, before](design-refresh/before-landscape-empty-d-light.png) | ![Guided start, after](design-refresh/after-landscape-empty-d-light.png) |

### Object, Runs tab

The score trend in the chart grammar: the wash under the line, the last value named in ink at a ringed end dot.

| Before | After |
|---|---|
| ![Object runs, before](design-refresh/before-object-runs-d-light.png) | ![Object runs, after](design-refresh/after-object-runs-d-light.png) |
| ![Object runs in dark, before](design-refresh/before-object-runs-d-dark.png) | ![Object runs in dark, after](design-refresh/after-object-runs-d-dark.png) |

### One run

New: the run's objects by measured score against the verdict bands, and its findings by severity.

| Before | After |
|---|---|
| ![Run, before](design-refresh/before-run-d-light.png) | ![Run, after](design-refresh/after-run-d-light.png) |
| ![Run in dark, before](design-refresh/before-run-d-dark.png) | ![Run in dark, after](design-refresh/after-run-d-dark.png) |
| ![Run on a phone, before](design-refresh/before-run-m-light.png) | ![Run on a phone, after](design-refresh/after-run-m-light.png) |

### Runs, compare, work

| Before | After |
|---|---|
| ![Runs, before](design-refresh/before-runs-d-light.png) | ![Runs, after](design-refresh/after-runs-d-light.png) |
| ![Compare, before](design-refresh/before-compare-d-light.png) | ![Compare, after](design-refresh/after-compare-d-light.png) |
| ![Work, before](design-refresh/before-work-d-light.png) | ![Work, after](design-refresh/after-work-d-light.png) |

### Inspector and administration

| Before | After |
|---|---|
| ![Preferences, before](design-refresh/before-preferences-d-light.png) | ![Preferences, after](design-refresh/after-preferences-d-light.png) |
| ![Rule inspector in dark, before](design-refresh/before-inspector-rule-d-dark.png) | ![Rule inspector in dark, after](design-refresh/after-inspector-rule-d-dark.png) |
| ![Settings in dark, before](design-refresh/before-admin-settings-d-dark.png) | ![Settings in dark, after](design-refresh/after-admin-settings-d-dark.png) |

## How the screenshots were made

A demo build (`NEXT_PUBLIC_MERIDIAN_DEMO=1 npm run build`, then `npm run start:standalone`) in Chromium at 1440 by
900 and 390 by 844, light and dark, every page with `?fixture=1`; no customer data. The before set is the interface
as it stood before the refresh, except the guided start, as noted above.
