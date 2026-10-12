# Meridian colour and motion spec: bold instrument

Date: 2026-10-12. Status: design spec for builders. Supersedes the colour, decoration and motion sections of `docs/superpowers/specs/2026-10-12-ui-polish-design.md` (W10, section 0.8, section 3 token deletions, EmptyState ghosts, sign-in, apple icon). Everything else in that spec stands.

Base branch for tokens: `origin/ui/t10` `frontend/design/tokens.css` (warm paper neutrals, cobalt accent). Foundations and pages: `origin/design/ui-polish-audit`.

## 0 Direction in one paragraph

Meridian is an instrument, not a dashboard theme. The chrome stays warm paper and cobalt. Colour is spent in four places and nowhere else: a deep cobalt hero band with one ember flare (login, home verdict, report covers, empty-state illustrations); a per-domain hue that follows each SAP object everywhere it appears; rich status tones that read as fill, not tint; and a ten-hue categorical palette that charts and the process map share. Depth is three shadow tokens and one hover lift. Motion is a count-up, a stagger, a draw-in and a shimmer on fixed durations. No glass, no blur, no purple-to-blue soup, no raster, no emoji, no all-caps.

Rule of thumb for every builder decision: if the hue tells the steward something (which object, how bad, how many), use it. If it only decorates, it is allowed in a hero zone and nowhere else.

### 0.1 Format rules for this spec

- All colour tokens are 6-digit hex so `scripts/check-contrast.mjs` can resolve them. OKLCH is given once per hue as a reference for designers only. Never write OKLCH into tokens.css.
- Every gradient, shadow, keyframe and millisecond value lives in `frontend/design/tokens.css`. `scripts/lint-tokens.mjs` rejects them anywhere else. Never add to `scripts/lint-tokens.allow.txt`.
- Dark values must be written twice: under `[data-theme="dark"]` and under `@media (prefers-color-scheme: dark) :root:not([data-theme="light"]):not([data-theme="dark"])`, value for value.
- Contrast ratios below were computed with the WCAG 2.x relative luminance formula against the exact hex values listed. All text pairs are at or above 4.5:1.

## 1 Palette

### 1.1 Neutrals (unchanged from ui/t10)

| Token | Light | Dark |
|---|---|---|
| `--m-canvas` | `#F4F3EF` | `#0C0D11` |
| `--m-sheet` | `#FFFFFF` | `#131519` |
| `--m-sheet-raised` | `#FAF9F6` | `#1A1C22` |
| `--m-sheet-sunken` | `#EFEDE8` | `#0F1014` |
| `--m-rail` | `#F4F3EF` | `#0A0B0E` |
| `--m-line` | `#E4E2DB` | `#24262E` |
| `--m-line-strong` | `#CFCCC3` | `#34373F` |
| `--m-ink` | `#141519` | `#EDEDF0` |
| `--m-ink-2` | `#4A4C55` | `#AEB0B8` |
| `--m-ink-3` | `#686A74` | `#85878F` |
| `--m-ink-4` | `#A3A5AD` | `#4F525B` |
| `--m-ink-on-accent` | `#FFFFFF` | `#0C0D11` |

Ink on sheet 17.4:1 light, 14.6:1 dark. Ink-3 on sunken 4.60:1 light, ink-3 on raised 4.75:1 dark (the tightest neutral pairs; do not darken sunken or lighten raised).

### 1.2 Signature accent: cobalt (unchanged values, extended role)

Reference OKLCH `oklch(0.50 0.22 268)`.

| Token | Light | Dark |
|---|---|---|
| `--m-accent` | `#2B4BE0` | `#8DA3FF` |
| `--m-accent-hover` | `#2340C4` | `#A3B5FF` |
| `--m-accent-active` | `#1C35A8` | `#7891F2` |
| `--m-accent-soft` | `#E9EDFC` | `#1A2247` |
| `--m-accent-soft-2` | `#D5DCF8` | `#222D5C` |
| `--m-accent-ink` | `#1E3AB8` | `#B7C4FF` |
| `--m-accent-ring` | `rgb(43 75 224 / 0.35)` | `rgb(141 163 255 / 0.40)` |

Contrast, light: accent on sheet 6.59, on canvas 5.94, on raised 6.26; ink-on-accent on accent 6.59; accent-ink on accent-soft 7.64, on sheet 8.93. Dark: accent on sheet 7.67, on canvas 8.15; ink-on-accent on accent 8.15; accent-ink on accent-soft 9.06.

Role: selection, focus, links, primary button, active nav, series 1, sequential ramp, hero band base. Cobalt remains the only hue allowed on interactive chrome.

### 1.3 Secondary accent: ember (new)

Reference OKLCH `oklch(0.55 0.20 38)`. One warm flare against cobalt. Used only in hero zones (section 2), the brand mark, the login instrument, the count-up settle flash and report covers. Never on chips, severity, charts, tables or nav. Ember is deliberately close to `--m-high`; the hero-zone-only rule is what keeps them from being confused, and lint enforces it (section 6.3).

| Token | Light | Dark |
|---|---|---|
| `--m-ember` | `#CC3410` | `#FF7A45` |
| `--m-ember-soft` | `#FFE8DF` | `#3F170A` |
| `--m-ember-ink` | `#A32A08` | `#FFA882` |
| `--m-ember-on` | `#FFFFFF` | `#0C0D11` |

Contrast, light: ember on sheet 5.16, on canvas 4.65; ember-on on ember 5.16; ember-ink on ember-soft 6.18, on sheet 7.26, on canvas 6.54. Dark: ember on sheet 7.07, on canvas 7.51; ember-on on ember 7.51; ember-ink on ember-soft 8.35, on canvas 10.34. Ember on hero-bg: 6.77 light, 7.25 dark.

### 1.4 Hero surface (new)

The one dark surface that exists in both themes. Everything on it uses the hero ink tokens, never `--m-ink`.

| Token | Light | Dark |
|---|---|---|
| `--m-hero-bg` | `#0E1540` | `#0A0F2E` |
| `--m-hero-bg-2` | `#1C35A8` | `#16288A` |
| `--m-hero-ink` | `#EDEDF0` | `#EDEDF0` |
| `--m-hero-ink-2` | `#B7C4FF` | `#B7C4FF` |
| `--m-hero-ink-3` | `#AEB0B8` | `#AEB0B8` |
| `--m-hero-line` | `rgb(237 237 240 / 0.14)` | `rgb(237 237 240 / 0.14)` |

Contrast on hero-bg: hero-ink 14.98 light / 16.04 dark; hero-ink-2 10.29 / 11.02; hero-ink-3 8.09 / 8.7. Hero-ink on hero-bg-2 (`#1C35A8`) 9.89.

### 1.5 Status tones (critical, high, medium, low, pass, info)

Each tone has four variants: solid (fills, bars, dots, strokes), soft (tinted background), ink (text on soft or on sheet), on (text on solid). `low` becomes a real tone instead of an alias. `info` stays an alias of accent.

Light:

| Tone | solid | soft | ink | on | OKLCH ref |
|---|---|---|---|---|---|
| critical | `#B42318` | `#FCEBE9` | `#8E1B12` | `#FFFFFF` | `oklch(0.50 0.19 28)` |
| high | `#BA4A0B` | `#FDEEE3` | `#8F3908` | `#FFFFFF` | `oklch(0.55 0.17 48)` |
| medium | `#946200` | `#FBF1DB` | `#6E4900` | `#FFFFFF` | `oklch(0.54 0.12 80)` |
| low | `#5B5E6B` | `#EFEDE8` | `#4A4C55` | `#FFFFFF` | `oklch(0.47 0.02 275)` |
| pass | `#157A3C` | `#E4F4EA` | `#0F5C2D` | `#FFFFFF` | `oklch(0.52 0.14 150)` |
| info | = accent | = accent-soft | = accent-ink | = ink-on-accent | |

Dark:

| Tone | solid | soft | ink | on |
|---|---|---|---|---|
| critical | `#F2756B` | `#3A1512` | `#FFA69E` | `#0C0D11` |
| high | `#F39A4B` | `#3B2010` | `#FFBE85` | `#0C0D11` |
| medium | `#E2B646` | `#352A0C` | `#F3D27E` | `#0C0D11` |
| low | `#9EA1AB` | `#1A1C22` | `#AEB0B8` | `#0C0D11` |
| pass | `#5FCF8A` | `#0F2F1C` | `#93E3B1` | `#0C0D11` |

Contrast (light / dark), all at or above 4.5:

| Pair | critical | high | medium | low | pass |
|---|---|---|---|---|---|
| solid on sheet | 6.57 / 6.56 | 5.16 / 8.30 | 5.24 / 9.59 | 6.45 / 7.08 | 5.41 / 9.38 |
| solid on canvas | 5.92 / 6.97 | 4.64 / 8.82 | 4.72 / 10.19 | 5.80 / 7.53 | 4.87 / 9.97 |
| solid on raised | 6.24 / 6.11 | 4.90 / 7.73 | 4.98 / 8.93 | 6.12 / 6.60 | 5.14 / 8.74 |
| on-colour on solid | 6.57 / 6.97 | 5.16 / 8.82 | 5.24 / 10.19 | 6.45 / 7.53 | 5.41 / 9.97 |
| ink on soft | 7.86 / 8.64 | 6.72 / 9.25 | 7.15 / 9.63 | 7.31 / 7.87 | 7.12 / 9.60 |
| ink on sheet | 9.07 / 9.75 | 7.62 / 11.28 | 8.03 / 12.47 | 8.55 / 8.44 | 8.11 / 12.07 |
| solid on soft | 5.70 / 5.81 | 4.55 / 6.81 | 4.67 / 7.40 | 5.51 / 6.60 | 4.75 / 7.47 |
| ink-1 on soft | 15.81 / 13.87 | 16.09 / 12.84 | 16.25 / 12.08 | 15.59 / 14.58 | 16.01 / 12.45 |

Readiness aliases stay: `--m-go*` = pass, `--m-at-risk*` = medium, `--m-no-go*` = critical, each now also with `-on`.

Severity keeps its shape pairing (critical square, high triangle, medium circle, low ring, pass check). Colour never carries severity alone.

### 1.6 Domain colour map for SAP objects (new)

Every SAP object family gets one hue that follows it across nav icons, table rows, chart series, process map nodes and report covers. Hues are drawn from the categorical palette so a chart coloured by object and a chart coloured by series never disagree.

Light:

| Domain token | Objects (module ids) | solid | soft | ink | OKLCH ref |
|---|---|---|---|---|---|
| `--m-dom-material` | material_master, bom, routing, classification | `#0E7490` | `#DFF3F8` | `#0B5A70` | `oklch(0.52 0.11 215)` |
| `--m-dom-customer` | customer_master, sales areas, credit | `#6D28D9` | `#EFE7FD` | `#5620B0` | `oklch(0.47 0.24 295)` |
| `--m-dom-vendor` | vendor_master, purchasing org data | `#BE185D` | `#FCE7F1` | `#9A1249` | `oklch(0.52 0.21 356)` |
| `--m-dom-partner` | business_partner, contacts, relationships | `#A21CAF` | `#FAE8FB` | `#7E1587` | `oklch(0.50 0.22 325)` |
| `--m-dom-finance` | gl_account, cost_center, profit_center, bank, company code | `#946200` | `#FBF1DB` | `#6E4900` | `oklch(0.54 0.12 80)` |
| `--m-dom-people` | SuccessFactors employee, position, org unit, payroll | `#0E6FA8` | `#E3F1FB` | `#0B5380` | `oklch(0.52 0.13 240)` |
| `--m-dom-plant` | plant, storage location, work_center, equipment, functional_location | `#4D7C0F` | `#EDF6DF` | `#3B6009` | `oklch(0.53 0.15 128)` |
| `--m-dom-asset` | fixed_asset, asset class | `#8A3B12` | `#F9EAE0` | `#6B2D0D` | `oklch(0.42 0.13 42)` |
| `--m-dom-other` | pricing conditions, reference data, any unmapped module | `#475569` | `#EAEEF3` | `#334155` | `oklch(0.45 0.03 260)` |

Dark:

| Domain token | solid | soft | ink |
|---|---|---|---|
| `--m-dom-material` | `#4FC3DB` | `#0D2A33` | `#8ADCEC` |
| `--m-dom-customer` | `#B79AF5` | `#241A42` | `#CDB9FA` |
| `--m-dom-vendor` | `#F27AB0` | `#3B1326` | `#F8A8CB` |
| `--m-dom-partner` | `#E68AF0` | `#33123A` | `#F0B4F6` |
| `--m-dom-finance` | `#E2B646` | `#352A0C` | `#F3D27E` |
| `--m-dom-people` | `#5BB8F0` | `#0E2A3F` | `#9AD3F7` |
| `--m-dom-plant` | `#A3CF5F` | `#1E2C0C` | `#C3E08E` |
| `--m-dom-asset` | `#FF8A4C` | `#3D1C0C` | `#FFB088` |
| `--m-dom-other` | `#A0AEC2` | `#1C222C` | `#C2CDDB` |

`-on` for every domain: `#FFFFFF` light, `#0C0D11` dark.

Contrast (light / dark): solid on sheet material 5.36 / 8.84, customer 7.10 / 7.79, vendor 6.04 / 7.12, partner 6.32 / 8.06, finance 5.24 / 9.59, people 5.44 / 8.32, plant 4.99 / 10.14, asset 7.73 / 7.83, other 7.58 / 8.12. Solid on canvas, lowest is plant 4.50 light; all others above 4.6. Ink on soft: material 6.76 / 9.69, customer 7.86 / 9.16, vendor 6.98 / 8.76, partner 7.68 / 9.75, finance 7.15 / 9.63, people 7.12 / 9.17, plant 6.58 / 10.12, asset 8.91 / 8.35, other 8.89 / 9.93. On-colour on solid equals solid on sheet in each theme.

Mapping lives in `frontend/design/tokens.ts` as `domainOf(moduleId: string): DomainKey` with a prefix table (`material`, `bom`, `routing` map to material, and so on) and `other` as the fallback. Builders never hard-code a domain per page.

### 1.7 Categorical data-viz palette (ten hues)

Order is fixed so series 1 is always cobalt and series 2 always pass green.

| Token | Light | Dark | Shared with |
|---|---|---|---|
| `--m-viz-1` | `#2B4BE0` | `#8DA3FF` | accent |
| `--m-viz-2` | `#157A3C` | `#5FCF8A` | pass |
| `--m-viz-3` | `#946200` | `#E2B646` | medium, finance |
| `--m-viz-4` | `#0E7490` | `#4FC3DB` | material |
| `--m-viz-5` | `#6D28D9` | `#B79AF5` | customer |
| `--m-viz-6` | `#B42318` | `#F2756B` | critical |
| `--m-viz-7` | `#BE185D` | `#F27AB0` | vendor |
| `--m-viz-8` | `#4D7C0F` | `#A3CF5F` | plant |
| `--m-viz-9` | `#0E6FA8` | `#5BB8F0` | people |
| `--m-viz-10` | `#A21CAF` | `#E68AF0` | partner |

Every viz hue is at or above 4.5:1 on sheet and canvas in both themes (lowest: viz-8 on canvas 4.50 light). `--m-viz-area` stays `rgb(43 75 224 / 0.10)` light, `rgb(141 163 255 / 0.14)` dark.

### 1.8 Sequential and diverging ramps (new)

Sequential (density, counts, coverage), five steps, cobalt:

| Token | Light | Text token on it | Ratio | Dark | Text on it | Ratio |
|---|---|---|---|---|---|---|
| `--m-seq-1` | `#E9EDFC` | ink | 15.62 | `#1A2247` | ink | 13.18 |
| `--m-seq-2` | `#B9C6F6` | ink | 10.83 | `#2A3A80` | ink | 8.92 |
| `--m-seq-3` | `#8BA0F0` | ink | 7.28 | `#4360C8` | ink | 4.80 |
| `--m-seq-4` | `#3650D6` | ink-on-accent | 6.41 | `#8DA3FF` | ink-on-accent | 8.15 |
| `--m-seq-5` | `#1C35A8` | ink-on-accent | 9.89 | `#C5D0FF` | ink-on-accent | 12.80 |

Diverging (deltas, run comparison), critical to pass through neutral:

| Token | Light | Text | Ratio | Dark | Text | Ratio |
|---|---|---|---|---|---|---|
| `--m-div-neg-2` | `#B42318` | ink-on-accent | 6.57 | `#F2756B` | ink-on-accent | 6.97 |
| `--m-div-neg-1` | `#F4B3AC` | ink | 10.33 | `#6B2520` | ink | 9.41 |
| `--m-div-mid` | `#EFEDE8` | ink | 15.59 | `#1A1C22` | ink | 14.58 |
| `--m-div-pos-1` | `#A9DEBB` | ink | 12.04 | `#1D5A36` | ink | 7.00 |
| `--m-div-pos-2` | `#157A3C` | ink-on-accent | 5.41 | `#5FCF8A` | ink-on-accent | 9.97 |

Rule: steps 1 to 3 of either ramp take `--m-ink` text, steps 4 and 5 and the diverging ends take `--m-ink-on-accent`. Expose this as `seqInk(step)` in tokens.ts so builders never guess.

## 2 Gradients and depth

### 2.1 Gradient tokens (the only gradients allowed)

Light values; dark values follow.

```
--m-grad-hero: linear-gradient(135deg, #0E1540 0%, #16288A 58%, #2B4BE0 100%);
--m-grad-hero-flare: radial-gradient(70% 90% at 100% 0%, rgb(204 52 16 / 0.42) 0%, rgb(204 52 16 / 0) 68%);
--m-grad-login: linear-gradient(160deg, #0E1540 0%, #1C35A8 70%, #2B4BE0 100%);
--m-grad-login-flare: radial-gradient(55% 55% at 18% 88%, rgb(204 52 16 / 0.55) 0%, rgb(204 52 16 / 0) 70%);
--m-grad-cover: linear-gradient(180deg, #0E1540 0%, #1C35A8 100%);
--m-grad-ghost: linear-gradient(180deg, var(--m-accent-soft) 0%, var(--m-sheet) 100%);
--m-grad-fade-bottom: linear-gradient(180deg, rgb(255 255 255 / 0) 0%, var(--m-sheet) 100%);
--m-grad-count-settle: linear-gradient(90deg, var(--m-ember-soft) 0%, transparent 100%);
```

Dark:

```
--m-grad-hero: linear-gradient(135deg, #0A0F2E 0%, #16288A 62%, #3650D6 100%);
--m-grad-hero-flare: radial-gradient(70% 90% at 100% 0%, rgb(255 122 69 / 0.38) 0%, rgb(255 122 69 / 0) 68%);
--m-grad-login: linear-gradient(160deg, #0A0F2E 0%, #16288A 70%, #3650D6 100%);
--m-grad-login-flare: radial-gradient(55% 55% at 18% 88%, rgb(255 122 69 / 0.50) 0%, rgb(255 122 69 / 0) 70%);
--m-grad-cover: linear-gradient(180deg, #0A0F2E 0%, #16288A 100%);
--m-grad-ghost: linear-gradient(180deg, var(--m-accent-soft) 0%, var(--m-sheet) 100%);
--m-grad-fade-bottom: linear-gradient(180deg, rgb(19 21 25 / 0) 0%, var(--m-sheet) 100%);
--m-grad-count-settle: linear-gradient(90deg, var(--m-ember-soft) 0%, transparent 100%);
```

Where each may appear:

| Token | Allowed surface | Nowhere else |
|---|---|---|
| `--m-grad-hero` plus `--m-grad-hero-flare` layered | Home verdict band (`.m-hero`), insights index header, executive summary header | Cards, tiles, tables, nav, buttons |
| `--m-grad-login` plus `--m-grad-login-flare` | Signed-out brand panel (`.m-brand-panel`) | |
| `--m-grad-cover` | Report cover tile in Insights reports, PDF cover preview, OG image | |
| `--m-grad-ghost` | EmptyState illustration backdrop (`.m-ghost-bg`) | |
| `--m-grad-fade-bottom` | Truncated text fade in drawers and AiSummary | |
| `--m-grad-count-settle` | Stat value background flash on count-up settle, 480 ms then gone | |

Hero band text uses `--m-hero-ink*` only. The flare is a second `background-image` layer on the same element, never a separate absolutely positioned blob.

No glass. `backdrop-filter` stays banned. Scrim stays flat `--m-scrim`.

### 2.2 Elevation tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--m-elev-0` | `none` | `none` | Flat regions |
| `--m-elev-1` | `0 0 0 1px var(--m-line)` | `0 0 0 1px var(--m-line)` | Every card, stat, table frame at rest |
| `--m-elev-2` | `0 0 0 1px var(--m-line), 0 4px 12px rgb(20 21 25 / 0.08)` | `0 0 0 1px var(--m-line-strong), 0 4px 16px rgb(0 0 0 / 0.5)` | Menus, popovers, flyouts, hover lift |
| `--m-elev-3` | `0 0 0 1px var(--m-line), 0 16px 48px rgb(20 21 25 / 0.16)` | `0 0 0 1px var(--m-line-strong), 0 24px 64px rgb(0 0 0 / 0.7)` | Dialog, drawer, command palette only |
| `--m-elev-focus` | `0 0 0 2px var(--m-sheet), 0 0 0 4px var(--m-accent)` | same | Focus ring |
| `--m-elev-accent` | `0 1px 2px rgb(43 75 224 / 0.30)` | `0 1px 2px rgb(0 0 0 / 0.5)` | Primary button |
| `--m-elev-hero` (new) | `0 0 0 1px rgb(14 21 64 / 0.20), 0 12px 32px rgb(14 21 64 / 0.22)` | `0 0 0 1px rgb(0 0 0 / 0.5), 0 12px 32px rgb(0 0 0 / 0.6)` | Hero band and login panel only |
| `--m-elev-glow-critical` (new) | `0 0 0 3px rgb(180 35 24 / 0.22)` | `0 0 0 3px rgb(242 117 107 / 0.28)` | Bottleneck node halo in DFG, nothing else |

Hover lift is allowed on interactive cards and stats only: `.m-lift` adds `transform: translateY(-2px)` and `box-shadow: var(--m-elev-2)` on hover and focus-visible, transition `--m-motion-duration` on `--m-ease-spring`. Static cards never lift. Rows never lift. Lint already rejects `--m-elev-2` to `-4` outside overlay selectors in CSS declarations; `.m-lift` and `.m-stat-link:hover` are added to that selector allow pattern in the script (section 6.3).

## 3 Component treatments

### 3.1 KPI hero tiles (Stat)

Two Stat modes. Props: existing `tone`, plus new `domain?: DomainKey`, `spark?: number[]`, `countUp?: boolean`, `delta` already exists.

Standard Stat (tables pages, objects page): white sheet, `--m-elev-1`, radius tile 14, padding 16 by 20. Left accent edge replaces the 3 px top bar: a 4 px full-height bar on the left inside the radius, colour `var(--m-${tone})` for tone, or `var(--m-dom-${domain})` for domain, or `--m-line-strong` when neither. Label `--m-text-meta` in `--m-ink-3`. Value `--m-text-stat` 600 `m-numeric` in `--m-ink`. Delta chip (section 3.2) sits right of the value, baseline aligned. Sparkline 60 by 16 under the value when `spark` has at least 3 points, stroke `var(--m-${tone})` when tone is set, else accent. Hint `--m-text-micro` in `--m-ink-3`.

Hero Stat (inside `.m-hero` on home and insights index): background `rgb(255 255 255 / 0.06)`, no shadow, 1 px border `--m-hero-line`, radius tile. Label `--m-hero-ink-2`, value `--m-text-hero` 56/60 in `--m-hero-ink`, hint `--m-hero-ink-3`. Tone bar on left 4 px in the dark-theme tone solid (always the dark set, because the hero is dark in both themes: expose as `--m-hero-tone-critical` and so on, equal to the dark tone solids). Sparkline stroke `--m-hero-ink-2`. Count-up on by default (section 4.1), with `--m-grad-count-settle` flashing behind the value for one `--m-motion-draw` on settle.

Stat skeleton stays 88 px tall so the page does not shift when values arrive. Hero Stat skeleton 112 px.

### 3.2 Status chips, badges and delta chip

Pill (`.m-pill`): soft fill, tone-ink text, 6 px dot in solid, 22 px tall, as today. Add `--m-pill-ember` for hero zones only (ember-soft, ember-ink). Add `variant="solid"`: solid fill, `-on` text, no dot, used when the chip is the row's primary verdict (Readiness column, FindingDrawer header). Never mix solid and soft variants in one column.

Badge (`.m-badge`): unchanged, accent fill. New `.m-badge-critical` (critical solid, critical-on) for count badges that mean failing items (Fix queue count in rail).

Delta chip (`Delta` becomes a chip, not bare text): 18 px tall, radius pill, padding 0 6 px, `--m-text-micro` 600 `m-numeric`, arrow glyph drawn with a 3 px CSS triangle not a character. Up and good: pass-soft background, pass-ink text. Down and bad: critical-soft, critical-ink. Zero: sheet-sunken, ink-2. `invert` prop when a lower number is better (open findings). On hero: background `rgb(255 255 255 / 0.12)`, text hero-ink-2 for neutral, pass dark solid `#5FCF8A` for good, critical dark solid `#F2756B` for bad (both above 6:1 on hero-bg).

Domain chip (new `DomainChip`): soft fill `--m-dom-*-soft`, ink `--m-dom-*-ink`, 8 px square swatch in solid at left instead of a dot (square distinguishes domain from status). Used in Objects table first column, Rules filter bar, record page header, command palette results.

### 3.3 DataTable

Row at rest: sheet. Row hover: `--m-sheet-raised`. Selected: `--m-accent-soft`. Keyboard cursor: 2 px accent outline (as today). Zebra stays off.

Severity bar: when a column is declared `severity` (new column meta `meta: { severity: true }`), the row gets a 3 px left bar in the severity solid, drawn as `box-shadow: inset 3px 0 0 var(--m-critical)` on the first cell, so no layout shift and no extra column. Bar only; the cell still shows the SeverityDot shape and the word.

Readiness cell: solid Pill (`Go` pass, `At risk` medium, `No-go` critical). DQS cell: ScoreRing 24 plus number; number colour `--m-ink`, never the band colour (the ring carries it).

Numeric heat cell (coverage, share, fitness): background from `--m-seq-1..5` by quintile, text from `seqInk(step)`. Declare with `meta: { heat: "seq" }` or `"div"`. Header for a heat column gets a 5-step legend strip 40 by 6 px, no labels.

Domain column: DomainChip. Table frame `--m-elev-1`; sticky header sheet with bottom `--m-line`. Row height tokens unchanged.

### 3.4 Charts

`chartTheme.series` becomes the ten-hue `--m-viz-1..10`. `chartTheme.domain(key)` returns the domain solid. `chartTheme.seq`, `chartTheme.div` return the ramps.

Line: stroke 2 px, dots only at the last point (r 3, filled, 2 px sheet ring). Area under the first series only, `--m-viz-area`. Draw-in on mount (section 4.4). Threshold line dashed 4 by 4 in `--m-ink-3`.

Bar and Pareto: fill by series or domain; the Pareto cumulative line in `--m-ink` 1.5 px. Bars grow from the baseline on mount. Hover bar: `--m-accent-hover` overlay at 12 percent via a second rect, never a colour swap.

Heatmap readiness (home, insights readiness): cell fill tone soft, 3 px left bar in tone solid, value text tone-ink, 6 px dot removed (the bar replaces it). Hover and focus 2 px accent outline unchanged. Heatmap density (process coverage, mining): seq ramp with `seqInk`. Heatmap delta (run compare): div ramp.

Radar: stroke series colour 2 px, fill same at 15 percent opacity through a `--m-viz-N-fill` set (`rgb(r g b / 0.15)` of each viz hue, light and dark, twenty tokens).

Funnel and Waterfall: step fill by seq step for funnel; waterfall increase pass, decrease critical, total accent.

Sparkline: stroke 1.5 px, colour by direction unchanged, plus `tone` override when inside a Stat.

Tooltip: `--m-viz-tooltip-bg` `#141519` light / `#EDEDF0` dark, `--m-viz-tooltip-ink` `#FFFFFF` / `#0C0D11`, radius control, `--m-elev-2`, swatch 8 px square in series colour.

Legend: 8 px square swatches, `--m-text-meta`, ink-2. Legend items clickable to isolate a series; isolated series keep colour, others drop to 25 percent opacity.

### 3.5 DFG process map (Graph)

Nodes: fill `--m-dom-*` solid of the node's owning module (passed as `domain` on node), stroke 1.5 px sheet, label `--m-hero-ink` inside when radius above 18 px, else `--m-ink-2` mono 11 below. Start and End pseudo nodes: `--m-ink-3` ring, no fill. Hover: stroke 2 px accent. Selected (drilled): `--m-elev-focus` ring. Weighted radius unchanged (`4 + 10 * sqrt(size / max)`).

Edges: width `1 + 4 * weight` (1 to 5 px). Colour by frequency band: weight under 0.25 `--m-line-strong`; 0.25 to 0.6 `--m-ink-3`; above 0.6 `--m-accent`. Arrowhead same colour, 6 px. Edge label (median wait) `--m-text-micro` mono in `--m-ink-2` on a sheet pill with `--m-elev-1`.

Bottleneck: an edge whose median wait is in the top decile of the run gets stroke `--m-critical` and the target node gets `box-shadow: var(--m-elev-glow-critical)` via an SVG filter-free approach: a second circle behind the node, radius plus 3, fill `rgb(180 35 24 / 0.22)` light `rgb(242 117 107 / 0.28)` dark, exposed as `--m-glow-critical-fill`. Pulse once on mount (section 4.6), then static. Rework edges (target earlier than source in rank) dashed 6 by 4 in `--m-high`.

Legend row above the map: three edge swatches for the frequency bands, one critical swatch labelled `Bottleneck`, one dashed high swatch labelled `Rework`, and a DomainChip per module present. "View as table" toggle unchanged.

### 3.6 Nav and shell

Rail background `--m-rail`. Group label `--m-text-micro` 500 ink-3 sentence case. Item icon colour: inactive `--m-ink-3`; active `--m-accent-ink`. Active item: `--m-accent-soft` fill, 2 px accent bar at left (as today, but 20 px tall). Hover: `--m-rail-hover`.

Section icon per domain: nav items that are object pages (Objects children, MDM, Fix) take a 6 px square swatch in `--m-dom-*` solid at the icon's bottom-right corner, 1.5 px sheet border, replacing nothing (the HealthPip dot stays top-right for Systems). Collapsed rail shows the swatch too.

TopBar: 48 px, sheet, bottom `--m-line`. Breadcrumb current item `--m-ink`, earlier items `--m-ink-3`. Run selector pill accent-soft when a non-latest run is pinned. Command palette `--m-elev-3`, result rows show DomainChip for object results.

Brand lockup in the rail: MeridianMark 24 px in accent, wordmark `--m-ink`. In the hero and login the mark is `--m-hero-ink` with the meridian line in `--m-ember`.

### 3.7 Login (signed-out frame)

Layout: left brand panel 45 percent (min 440, max 620), right form on canvas. Below `lg` the panel becomes a 200 px band on top.

Brand panel (`.m-brand-panel`): `background-image: var(--m-grad-login-flare), var(--m-grad-login)`; `box-shadow: var(--m-elev-hero)` on the panel's inner edge only (right side at lg, bottom below). Padding 48. Lockup top-left: MeridianMark 32 in `--m-hero-ink`, wordmark `--m-text-title` 600 `--m-hero-ink`.

Instrument, centred: the ScoreRing geometry at 320 px, track `rgb(237 237 240 / 0.14)`, arc stroke 6 in `--m-ember`, draws over `--m-motion-draw` on mount, with the vertical meridian line in `--m-hero-ink` at 40 percent. Inside the ring: one line `--m-text-verdict` 600 `--m-hero-ink` (copy from the current frame, "SAP data quality, measured."), one line `--m-text-body` `--m-hero-ink-2`. Below the ring, the four FACTS return as a 2 by 2 grid in `--m-hero-ink-2` with 6 px ember squares. Keep the count figures only if they are read from the licence manifest at build time; otherwise drop the numeric facts and keep the two non-numeric ones.

Bottom-left: `.m-meridian-line` 1 px `--m-hero-line` with a 24 px ember segment at its start.

Form card: 400 px, `--m-sheet`, radius sheet, `--m-elev-2` (one step up from in-app cards, because it sits on canvas with nothing around it). Title `--m-text-title` 600. Inputs 40 px (`--m-control-h-lg`), primary button full width 40 px with `--m-elev-accent`. Theme toggle bottom-right of main, ghost. Error notice unchanged (critical-soft, 3 px critical bar).

Motion: panel gradient static. Ring draws 480 ms. Lockup, ring, facts and card use `.m-motion-stagger` 40 ms steps. Nothing moves after first paint.

### 3.8 Empty states

Wrapper unchanged (`m-card m-elev-1`, max 560). Illustration area 120 px tall with `background: var(--m-grad-ghost)`, radius sheet, and a CSS-only figure drawn from spans and SVG primitives:

- table: three 8 px rows, widths 70, 50, 60 percent, `--m-accent-soft-2`, the first row with a 24 px `--m-dom-material` square at left
- chart: three bars 24 px wide heights 40, 64, 28, fills `--m-viz-4`, `--m-viz-1`, `--m-viz-2` at 60 percent opacity, baseline 1 px `--m-line-strong`
- grid: 3 by 3 of 16 px squares, `--m-accent-soft-2`, centre square `--m-accent`
- list: four rows with 10 px circles in `--m-viz-5`, `--m-viz-7`, `--m-viz-4`, `--m-viz-8` and 8 px bars
- ring: 64 px 270 degree arc, track `--m-accent-soft-2`, arc `--m-accent`, cap tick `--m-ember`
- stepper: four 12 px circles joined by a 2 px line, first two `--m-pass`, third `--m-accent`, fourth `--m-line-strong`

Opacity of the figure 0.9. Title `--m-text-section` 600 ink, detail body ink-2, action secondary button. Figure fades in with `.m-motion-fade`.

### 3.9 Focus rings

Unchanged token `--m-elev-focus` (2 px sheet, 4 px accent) on every focusable. On the hero and login panel, use `--m-elev-focus-hero`: `0 0 0 2px var(--m-hero-bg), 0 0 0 4px var(--m-hero-ink-2)`. Heat cells and graph nodes keep the 2 px accent outline with 2 px offset. Focus never changes fill colour.

### 3.10 Buttons and inputs

Unchanged, except primary button hover gains `transform: translateY(-1px)` under `.m-lift-sm` with the same spring, and danger button text uses `--m-critical-on`.

## 4 Motion

Durations and easings (tokens, tokens.css only):

| Token | Value | Use |
|---|---|---|
| `--m-motion-duration` | `120ms` | hover, colour, lift |
| `--m-motion-slow` | `240ms` | reveal, fade, menu open |
| `--m-motion-draw` | `480ms` | ring, line and bar draw-in, count settle flash |
| `--m-motion-count` (new) | `900ms` | count-up |
| `--m-motion-shimmer` | `1400ms` | skeleton sweep |
| `--m-motion-stagger-step` (new) | `40ms` | per-child delay |
| `--m-ease` | `cubic-bezier(0.2, 0, 0, 1)` | everything by default |
| `--m-ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | fades out |
| `--m-ease-spring` (new) | `cubic-bezier(0.34, 1.2, 0.64, 1)` | lift only |
| `--m-motion-rise-y` | `6px` | rise distance |

### 4.1 Count-up

`Counter` runs `--m-motion-count` with easeOutCubic, once per `versionId`, as today but 900 ms. Value cell has `min-width: 4ch` and `font-variant-numeric: tabular-nums` so width never changes. On settle, the `.m-count-settle` class is added for one `--m-motion-draw`: `background-image: var(--m-grad-count-settle)`, `background-size: 200% 100%`, animated from `background-position: 100% 0` to `-100% 0`, then removed. Under reduced motion the number renders final immediately and no flash.

### 4.2 Staggered reveal

`.m-motion-stagger > :nth-child(n)` gets `animation: m-rise var(--m-motion-slow) var(--m-ease) both` with `animation-delay: calc(var(--m-motion-stagger-step) * (n - 1))` for n 1 to 8; children past 8 share the 8th delay (280 ms). Applies to: hero stats, dimension strip, insights tiles, objects stat row, report list rows. Never to DataTable rows. Never on content that arrives after data; data arrival uses a plain `.m-motion-fade` (opacity only) so nothing shifts.

### 4.3 Hover lift

`.m-lift:hover, .m-lift:focus-visible { transform: translateY(-2px); box-shadow: var(--m-elev-2); }`, transition `transform var(--m-motion-duration) var(--m-ease-spring), box-shadow var(--m-motion-duration) var(--m-ease)`. Allowed on Stat with href, insight tiles, report cover tiles, the login form card never.

### 4.4 Chart draw-in

Line and Sparkline: `stroke-dasharray` equal to path length, `m-draw` keyframe over `--m-motion-draw`. Bars: `transform: scaleY(0)` to 1 with `transform-origin: bottom`, `--m-motion-draw`, staggered 20 ms per bar up to 12 bars via `--m-motion-stagger-step` halved (a second token `--m-motion-stagger-bar: 20ms`). Ring: existing. Heatmap: existing per-cell rise capped at 10 steps. Draw-in runs once per data identity (`versionId` or series key), never on re-render.

### 4.5 Skeleton shimmer

Unchanged: sunken base, 40 percent sweep in raised, `--m-motion-shimmer`. Hero skeleton uses `rgb(255 255 255 / 0.06)` base and `rgb(255 255 255 / 0.12)` sweep (`--m-hero-skeleton`, `--m-hero-skeleton-sweep`).

### 4.6 Bottleneck pulse

`m-pulse-once` keyframe: halo circle radius from plus 3 to plus 9 and opacity 1 to 0 over `--m-motion-draw`, then static halo at plus 3. Once per DFG load.

### 4.7 Reduced motion

The existing reduced-motion block sets every `--m-motion-*` duration to `0ms` and `animation: none` on all `.m-motion-*`. Extend it to `.m-lift` (no transform), `.m-count-settle` (no background animation), `m-pulse-once`. Counter snaps. Stagger delays become 0 by token.

### 4.8 No layout shift

Every animated element reserves its final box: skeleton heights equal final heights (Stat 88, hero Stat 112, DataTable row 36, InsightHeader 112, chart containers fixed height). Lift uses transform only. Count-up uses tabular numerals and min-width. Draw-in uses stroke-dasharray and transform, never width or height.

## 5 Token list

New tokens (light / dark). Add to tokens.css in these groups, after the existing accent block.

```
/* ember */
--m-ember: #CC3410 / #FF7A45
--m-ember-soft: #FFE8DF / #3F170A
--m-ember-ink: #A32A08 / #FFA882
--m-ember-on: #FFFFFF / #0C0D11

/* hero surface */
--m-hero-bg: #0E1540 / #0A0F2E
--m-hero-bg-2: #1C35A8 / #16288A
--m-hero-ink: #EDEDF0 / #EDEDF0
--m-hero-ink-2: #B7C4FF / #B7C4FF
--m-hero-ink-3: #AEB0B8 / #AEB0B8
--m-hero-line: rgb(237 237 240 / 0.14) / same
--m-hero-skeleton: rgb(255 255 255 / 0.06) / same
--m-hero-skeleton-sweep: rgb(255 255 255 / 0.12) / same
--m-hero-tone-critical: #F2756B / same
--m-hero-tone-high: #F39A4B / same
--m-hero-tone-medium: #E2B646 / same
--m-hero-tone-pass: #5FCF8A / same

/* status on-colour and low */
--m-critical-on, --m-high-on, --m-medium-on, --m-low-on, --m-pass-on, --m-info-on: #FFFFFF / #0C0D11
--m-low: #5B5E6B / #9EA1AB          (was alias of ink-3: CHANGED)
--m-low-soft: #EFEDE8 / #1A1C22     (was alias of sheet-raised: CHANGED)
--m-low-ink: #4A4C55 / #AEB0B8      (new)
--m-go-on, --m-at-risk-on, --m-no-go-on: aliases of pass-on, medium-on, critical-on

/* domains: solid / soft / ink, light then dark as in 1.6 */
--m-dom-material, --m-dom-material-soft, --m-dom-material-ink
--m-dom-customer, -soft, -ink
--m-dom-vendor, -soft, -ink
--m-dom-partner, -soft, -ink
--m-dom-finance, -soft, -ink
--m-dom-people, -soft, -ink
--m-dom-plant, -soft, -ink
--m-dom-asset, -soft, -ink
--m-dom-other, -soft, -ink
--m-dom-on: #FFFFFF / #0C0D11

/* viz */
--m-viz-9: #0E6FA8 / #5BB8F0        (new)
--m-viz-10: #A21CAF / #E68AF0       (new)
--m-viz-1-fill .. --m-viz-10-fill: rgb(<viz-n> / 0.15) light and dark (new, twenty tokens)
--m-viz-area: rgb(43 75 224 / 0.10) / rgb(141 163 255 / 0.14)   (dark CHANGED)
--m-viz-tooltip-bg: #141519 / #EDEDF0
--m-viz-tooltip-ink: #FFFFFF / #0C0D11

/* ramps */
--m-seq-1..5: #E9EDFC #B9C6F6 #8BA0F0 #3650D6 #1C35A8 / #1A2247 #2A3A80 #4360C8 #8DA3FF #C5D0FF
--m-div-neg-2, -neg-1, -mid, -pos-1, -pos-2: #B42318 #F4B3AC #EFEDE8 #A9DEBB #157A3C / #F2756B #6B2520 #1A1C22 #1D5A36 #5FCF8A

/* gradients: exact strings in 2.1 */
--m-grad-hero, --m-grad-hero-flare, --m-grad-login, --m-grad-login-flare, --m-grad-cover, --m-grad-ghost, --m-grad-fade-bottom, --m-grad-count-settle

/* elevation */
--m-elev-hero: see 2.2
--m-elev-glow-critical: see 2.2
--m-glow-critical-fill: rgb(180 35 24 / 0.22) / rgb(242 117 107 / 0.28)
--m-elev-focus-hero: 0 0 0 2px var(--m-hero-bg), 0 0 0 4px var(--m-hero-ink-2) / same

/* motion */
--m-motion-count: 900ms
--m-motion-stagger-step: 40ms
--m-motion-stagger-bar: 20ms
--m-ease-spring: cubic-bezier(0.34, 1.2, 0.64, 1)
```

Changed existing tokens: `--m-low`, `--m-low-soft` (real values instead of aliases), `--m-viz-area` dark, `--m-accent-ring` dark (`rgb(141 163 255 / 0.40)`, was derived from light). Everything else in ui/t10 tokens.css is kept as is.

New utility classes in tokens.css (keyframes and durations are lint-restricted to this file): `.m-hero`, `.m-brand-panel`, `.m-ghost-bg`, `.m-lift`, `.m-lift-sm`, `.m-count-settle`, `.m-motion-stagger` (extended to 8 children with the step token), `.m-motion-grow-y`, `.m-pulse-once`, `.m-pill-solid-*`, `.m-pill-ember`, `.m-badge-critical`, `.m-chip-domain-*`, `.m-stat-edge`, `.m-row-severity-*`, `.m-heat-seq-1..5`, `.m-heat-div-*`. Keyframes added: `m-grow-y`, `m-pulse-once`, `m-count-settle`.

tokens.ts additions: `DomainKey`, `domainOf(moduleId)`, `mColor.dom[key]`, `mColor.viz` extended to 10, `mColor.seq`, `mColor.div`, `seqInk(step)`, `mColor.hero.*`, `mColor.ember`, `mMotion.count = 900`, `mMotion.staggerStep = 40`, `mMotion.easeSpring`.

check-contrast.mjs pairs to add: ember on sheet, canvas, raised; ember-on on ember; ember-ink on ember-soft and sheet; hero-ink, hero-ink-2, hero-ink-3 on hero-bg and hero-bg-2; low on sheet, canvas, low-soft; low-ink on low-soft and sheet; for each domain: solid on sheet, canvas, raised, own soft; ink on own soft and sheet; dom-on on solid; viz-9 and viz-10 on sheet and canvas; ink on seq-1..3, ink-on-accent on seq-4..5; ink on div-neg-1, div-mid, div-pos-1; ink-on-accent on div-neg-2, div-pos-2; viz-tooltip-ink on viz-tooltip-bg.

## 6 Rule changes

### 6.1 Superseded rules

| Old rule (2026-10-12 spec, DESIGN.md, CLAUDE.md) | New rule |
|---|---|
| W10 "Zero decoration. Three elevations, one accent, no gradients" | Three elevations plus one hover lift. Two accents: cobalt for interaction, ember for hero zones only. Gradients only via `--m-grad-*` tokens on the six surfaces in 2.1 |
| "No gradients, glass or backdrop blur" | No glass, no backdrop blur. Gradients only via `--m-grad-*` tokens in hero zones |
| "No shadows" beyond elev-1 to 3 | Only `--m-elev-*` tokens. `--m-elev-2` on overlays and `.m-lift` hover. `--m-elev-3` on dialog, drawer, palette. `--m-elev-hero` on hero and login panel. `--m-elev-glow-critical` on DFG bottleneck only |
| "Hue means defect state" (sole meaning) | Hue means defect state, object domain, or series. Each use has its own token family and never borrows another's |
| Section 0.8 "Motion only on 120, 240, 480" | Motion only on `--m-motion-*` tokens: 120, 240, 480, 900 count, 1400 shimmer, 40 and 20 stagger steps |
| Section 0.8 "No m-motion-rise on content that arrives after data" | Unchanged. Stagger is for first paint; data arrival fades |
| Section 3 "delete gradient, brand-panel, glass tokens" | Delete glass. Replace the four old gradient tokens with the eight `--m-grad-*` above. `.m-brand-panel` returns, defined in tokens.css |
| EmptyState "flat --m-line outlines at 40 percent" | Coloured CSS and SVG figures on `--m-grad-ghost` (3.8). No raster |
| Sign-in "single centred card, no tagline, no FACTS, no ring" | Brand panel with instrument, tagline and facts (3.7). Card stays 400 px |
| Stat tone "3 px top bar" | 4 px left edge, tone or domain (3.1) |
| Pill "soft bg, tone-ink text, 6 px dot" | Soft remains default; solid variant for the primary verdict cell |
| Heatmap "soft tone fill plus 6 px dot" | Soft fill plus 3 px left bar; density and delta heatmaps use ramps |
| Graph "nodes --m-viz-1, edges --m-line-strong 1 to 3" | Nodes by domain, edges by frequency band 1 to 5 px, bottleneck and rework encodings (3.5) |
| Apple icon and OG "no gradient" | OG and apple icon use `--m-grad-cover` with the mark in hero-ink and the meridian line in ember |
| Sparkline "colour by direction" | Unchanged, plus tone override inside Stat |

Kept unchanged: sentence case everywhere, no all-caps eyebrows, no emoji, no icons without meaning, severity shape pairing, URL is state, light and dark equal, skeleton heights, virtualise above 200 rows, no raster illustration, no customer names in UI copy.

### 6.2 Discipline rules for review

1. Ember and `--m-grad-*` appear only inside `.m-hero`, `.m-brand-panel`, `.m-report-cover`, `.m-ghost-bg`, `.m-count-settle`, and the OG and apple icon generators. A PR that uses them elsewhere is rejected.
2. `--m-dom-*` appears only where the element stands for one SAP object: DomainChip, Stat edge, Graph node, chart series keyed by object, nav swatch, report cover stripe.
3. Status tones appear only on `[data-severity]` or `[data-tone]` elements (existing lint warning becomes an error).
4. One hero zone per page. Home has the verdict band; insights index has the header; everything else has none.
5. No new hex outside tokens.css. No new keyframe outside tokens.css. No new duration literal outside tokens.css.
6. Every new text on background pair is added to check-contrast.mjs before the PR opens.

### 6.3 Lint rule additions (scripts/lint-tokens.mjs)

Add to RULES, applied to every .ts, .tsx and .css outside `design/tokens.css`:

- `ember-outside-hero`: regex `var\(--m-ember` or `var\(--m-grad-` in a file whose path is not in the allow set `design/templates/HomePage.tsx`, `design/templates/InsightHeader.tsx`, `design/primitives/EmptyState.tsx`, `design/primitives/Counter.tsx`, `design/primitives/Stat.tsx`, `components/auth/auth-frame.tsx`, `app/(app)/insights/reports/page.tsx`, `app/icon.tsx`, `app/apple-icon.tsx`, `app/opengraph-image.tsx`. Error.
- `hero-elev-outside-hero`: `var\(--m-elev-hero` outside the same allow set. Error.
- `glow-outside-graph`: `var\(--m-elev-glow-|var\(--m-glow-` outside `design/charts/Graph.tsx`. Error.
- `status-without-data-attr`: the existing `var(--m-status-` and `var(--m-(critical|high|medium|low|pass)` warning becomes an error when the same JSX element or CSS rule lacks `data-severity`, `data-tone` or a `.m-pill-`, `.m-badge-`, `.m-row-severity-`, `.m-heat-` class. Error.
- `domain-literal`: `var\(--m-dom-(material|customer|vendor|partner|finance|people|plant|asset|other)` as a literal string outside `design/tokens.ts`, `design/tokens.css` and `design/primitives/DomainChip.tsx`. Pages must go through `domainOf()` and `mColor.dom`. Error.
- CSS-decl rule: `--m-elev-2` allowed in selectors matching `overlay|menu|popover|flyout|tooltip|palette|\.m-lift|\.m-stat-link:hover|\.m-brand-card`.

The allowlist file stays empty. The script's file allow sets above live in the RULES table, not in `lint-tokens.allow.txt`.

## 7 Rollout plan

Four parallel builder tasks, non-overlapping file ownership, one branch each off `origin/ui/t10` tokens merged onto `origin/design/ui-polish-audit`. Task A merges first; B, C and D rebase on A before opening PRs. Every task ends with `npm run lint:tokens`, `npm run check:contrast`, `npm run typecheck`, `npm run lint`, and light plus dark screenshots at 1440 and 390. Do not run `npm run build`. Do not touch port 3100.

### Task A: tokens and foundations

Owns: `frontend/design/tokens.css`, `frontend/design/tokens.ts`, `frontend/app/globals.css`, `frontend/scripts/lint-tokens.mjs`, `frontend/scripts/check-contrast.mjs`, `frontend/design/primitives/{Stat,Pill,Badge,Delta,Counter,EmptyState,Skeleton,Card,Button}.tsx`, new `frontend/design/primitives/DomainChip.tsx`, `frontend/design/charts/*`, `frontend/design/table/DataTable.tsx`, `frontend/design/shell/{Rail,TopBar,CommandPalette}.tsx`, `frontend/design/index.ts`, `frontend/DESIGN.md`, `frontend/CLAUDE.md` colour paragraph.

Steps: add every token in section 5 (light, dark, system-dark mirrored); add utility classes and keyframes; extend tokens.ts; extend check-contrast pairs; add lint rules 6.3; implement Stat edge, hero Stat, Delta chip, Pill solid, Badge critical, DomainChip, EmptyState figures, DataTable severity bar and heat cells, chart theme with ten hues and ramps, Graph domain nodes and edge bands and bottleneck halo, Rail domain swatch; update DESIGN.md principles 10 and 11 and CLAUDE.md sentence.

Acceptance: `check:contrast` passes with every pair from section 5 present (count the pairs array: at least 96 entries); `lint:tokens` passes with the six new rules and an intentional violation in a scratch file fails; Storybook-free check page `app/(app)/admin/design/page.tsx` (if it exists on the branch; otherwise a temporary route the task deletes before PR) renders every token swatch, both Stat modes, all five Pill tones in soft and solid, nine DomainChips, a 10-series Line, seq and div Heatmaps, a Graph with a bottleneck, every EmptyState ghost; screenshots light and dark; no raw hex outside tokens.css; `--m-low` no longer aliases ink-3.

### Task B: home, insights index, login, reports

Owns: `frontend/design/templates/{HomePage,InsightHeader,ReportPage}.tsx`, `frontend/app/(app)/home/**`, `frontend/app/(app)/insights/page.tsx`, `frontend/app/(app)/insights/reports/page.tsx`, `frontend/app/(app)/insights/exec/**`, `frontend/app/sign-in/**`, `frontend/app/(auth)/**` if present, `frontend/components/auth/auth-frame.tsx`, `frontend/app/{icon,apple-icon,opengraph-image}.tsx`, `frontend/public/brand/*.svg`.

Steps: HomePage verdict row becomes `.m-hero` band (grad-hero plus flare, elev-hero, radius tile, padding 28 by 32): verdict sentence in hero-ink at `--m-text-verdict`, DQS number as hero Stat with count-up and delta chip, run label hero-ink-3, capped Pill ember; dimension strip of six standard Stats with tone edge and sparkline in `.m-motion-stagger`; worst-objects DataTable with severity bar and DomainChip; readiness Heatmap with left bar. Insights index: InsightHeader as the page's hero zone with four hero Stats; tiles become `.m-lift` cards with a domain or viz colour edge. Reports: each report row gets a 56 by 40 `.m-report-cover` thumbnail (grad-cover, mark in hero-ink, ember stripe); executive summary page header uses the hero band. Login per 3.7. Icon, apple icon and OG per 6.1.

Acceptance: home verdict band renders in light and dark with all text from hero-ink tokens; DQS counts up once and never re-runs on refetch; Lighthouse CLS 0 on home and login at 1440 and 390; login screenshot shows ring draw and stagger, and reduced-motion screenshot shows final state at 0 ms; no `--m-ember` or `--m-grad-` outside the allow set; the middle-dot glyph (U+00B7) does not appear in any owned file (replace the run label separator with two spaces or a Pill).

### Task C: objects, rules, runs, systems, MDM, inbox, fix, import, admin

Owns: `frontend/app/(app)/objects/**`, `frontend/app/(app)/rules/**`, `frontend/app/(app)/runs/**`, `frontend/app/(app)/systems/**`, `frontend/app/(app)/mdm/**`, `frontend/app/(app)/inbox/**`, `frontend/app/(app)/fix/**`, `frontend/app/(app)/import/**`, `frontend/app/(app)/migration/**`, `frontend/app/(app)/admin/**` (except the temporary design route Task A owns), `frontend/design/templates/{ExplorerPage,RecordPage,EntityTabs,FindingDrawer,NextActions}.tsx`.

Steps: Objects table first column becomes DomainChip plus label; Readiness column solid Pill; Failing checks column declares `meta.severity`; objects stat row uses tone edges and `.m-motion-stagger`; record page header shows the DomainChip and a 4 px domain edge on the summary Card; FindingDrawer header severity solid Pill; Rules catalogue rows get severity bar and domain chip; Runs list status column solid Pill (pass, medium, critical by run status) and coverage column as seq heat; Systems health as Stat edges; Fix and Inbox queues severity bar; rail Fix badge uses `.m-badge-critical` when count above 0 (prop from Task A).

Acceptance: every table with a severity column shows the bar at 1440 and 390 without horizontal shift (row width unchanged, measured in screenshot diff); DomainChip resolves through `domainOf` for every module on the Objects page with no `other` fallback for material, customer, vendor, business partner, finance or employee modules; no literal `--m-dom-` in owned files; `lint:tokens` and `check:contrast` pass.

### Task D: process discovery and insight detail pages

Owns: `frontend/app/(app)/process/**`, `frontend/app/(app)/insights/process/**` (including designer), `frontend/app/(app)/insights/{readiness,impact,owners,duplicates,forecast,lineage,mining}/**`, `frontend/design/templates/JourneyStepper.tsx`.

Steps: FlowView passes `domain` per node from the model document's L1 owner module and marks bottleneck edges (top decile median wait) and rework edges; legend row per 3.5; conformance view uses div ramp for fitness deltas; coverage pill becomes seq heat; process catalogue DataTable gets DomainChip and seq coverage; designer migrates off `aurora-*` classes onto `m-*` with domain colours on lanes; readiness insight Heatmap uses left-bar cells; impact Pareto by domain colour; owners table with seq heat on score; duplicates clusters with viz palette per cluster; forecast Line with ten-hue series and draw-in; lineage Graph with domain nodes; mining heatmaps on seq ramp.

Acceptance: DFG with a bottleneck shows exactly one pulse on load and none on filter change; edge widths 1 to 5 px by weight (assert in a unit test on the width function); every Graph node colour comes from `mColor.dom`; no `aurora-*` class remains in `insights/process/designer/**`; keyboard order of nodes unchanged; `lint:tokens`, `check:contrast`, `typecheck` pass; screenshots of flow, conformance and readiness in light and dark at 1440.

### Merge order and review

A first. B, C, D rebase on A and open PRs the same day. Reviewer checklist is section 6.2 plus: no customer names, sentence case, no full stops in titles, no middle-dot glyph (U+00B7), no emoji, no raster, no new dependency.
