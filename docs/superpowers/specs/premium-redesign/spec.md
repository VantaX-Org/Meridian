# Meridian visual redesign — "The Instrument"

Design spec for the visual and brand layer. The information architecture, routes, templates and the `@/design` export list from `docs/superpowers/specs/2026-10-08-frontend-redesign-design.md` stay as they are. Implementers are engineers with no design context: when this document gives a number, use the number; when it names a token, use the token.

Repo paths are relative to `frontend/` unless they start with `api/` or `templates/`.

---

## 1. Direction

**Concept.** Meridian is a precision instrument for SAP data: it measures, it shows the reading, and it tells you what the reading means. The interface should feel like a well-made measuring device — a surveyor's theodolite, a lab balance, a flight instrument — not a dashboard template. Warm paper neutrals instead of the cool slate every competitor uses; one deep cobalt accent that behaves like the needle on a dial (it points at the thing that matters and nothing else); very large tabular numerals for readings; a serif display face reserved for the one sentence per page that states the verdict; monospace for every SAP identifier. Depth comes from a single thin "meridian" hairline that runs along the top of the shell and through the brand panel, from a soft glass top bar, and from exactly three elevation levels. The current app loses because everything is the same weight; this redesign wins by making one thing per screen loud and everything else quiet.

**Principles** (these replace rules 1–16 in the old `DESIGN.md`; the old ones that survive are folded in).

1. **One reading per screen.** Every page has one hero: a verdict sentence, a score gauge, a count-up number, or a graph. Nothing else on the page may exceed 15px type or carry the accent colour as a fill.
2. **Hue means defect state, cobalt means "you can act here".** Red, orange, amber, green are only ever severity or verdict. Cobalt (`--m-accent`) is only ever selection, focus, links, the primary button and the meridian hairline. No decorative colour.
3. **Severity is colour plus shape.** critical = square, high = triangle, medium = circle, low = ring (no hue), pass = check. Never colour alone.
4. **Show the cap.** When a Critical finding caps DQS at 85 or 70, the gauge shows both the measured value and the cap.
5. **Numbers are tabular, large, and open rows.** Every number on a page is a `DrillLink` to the rows behind it.
6. **Serif is for verdicts only.** `--m-font-display` appears in exactly four places: the home verdict sentence, the auth page headline, the report cover title, the OG image. Nowhere else.
7. **Mono is for SAP.** Check IDs, `TABLE.FIELD`, record keys, run IDs, sample values. Nothing else.
8. **Warm neutrals, cool accent.** The canvas is warm paper, the ink is warm graphite. The accent is cold cobalt. That contrast is the brand.
9. **Three elevations.** Flat (hairline border), raised (menus, popovers), floating (drawer, dialog, palette). Nothing in between.
10. **Glass is for chrome, never for content.** The top bar and the command palette backdrop may use `--m-glass-*`. Cards, tables and charts never do.
11. **Gradients are tokens, not decoration.** Exactly four gradient tokens exist (§2). A gradient that is not one of those four does not ship.
12. **Motion is 120 / 240 / 480 / 1400 ms, ease-out, and zero under `prefers-reduced-motion`.** Motion communicates one of: arrival (rise), change (count-up, draw), or waiting (sweep).
13. **Empty states are the product on day one.** Every empty state shows the ghost of what will fill in, one sentence saying what it will be, and the one action that gets there. No illustrations, no mascots.
14. **Sentence case everywhere. No all-caps eyebrows.** Hierarchy comes from size, weight and ink level.
15. **URL is state.** Filters, tabs, selected run, open drawer all live in the query string.
16. **Light and dark are equals.** Every token has both values; every screenshot in review is taken in both.

---

## 2. Tokens

Replace `design/tokens.css` with the block below. Token *names* that `tokens.ts`, `globals.css` and components already use are kept (`--m-canvas`, `--m-sheet`, `--m-sheet-raised`, `--m-line`, `--m-ink`, `--m-ink-2`, `--m-ink-3`, `--m-accent`, `--m-accent-soft`, `--m-critical`, `--m-high`, `--m-medium`, `--m-pass`, `--m-viz-1..8`, `--m-scrim`, `--m-font-sans`, `--m-font-mono`, `--m-space-*`, `--m-radius-control`, `--m-radius-sheet`, `--m-motion-*`, the `m-motion-*` and `m-skeleton-sweep` classes and the four keyframes). Everything else is new. No token is removed.

Contrast notes are in comments. Every ink-on-surface pair listed is ≥ 4.5:1; every status colour on its own `-soft` tint is ≥ 4.5:1; status colours on `--m-sheet` are ≥ 4.5:1 in both themes.

```css
/* frontend/design/tokens.css
 * The only file that may contain colour, shadow, gradient, blur, radius,
 * motion or duration literals. `npm run lint:tokens` enforces this.
 * Every token has a light value (:root) and a dark value ([data-theme="dark"]).
 */

:root {
  /* ---------- Surfaces (light: warm paper) ---------- */
  --m-canvas: #F4F3EF;          /* page background */
  --m-sheet: #FFFFFF;           /* cards, tables, forms */
  --m-sheet-raised: #FAF9F6;    /* table header rows, hover rows, inset wells */
  --m-sheet-sunken: #EFEDE8;    /* code/sample wells, ghost shapes */
  --m-rail: #F4F3EF;            /* sidebar background (same as canvas in light) */
  --m-line: #E4E2DB;            /* hairline borders (1px) */
  --m-line-strong: #CFCCC3;     /* input borders, table head rule */
  --m-scrim: rgb(20 21 25 / 0.32);

  /* ---------- Ink ---------- */
  --m-ink: #141519;             /* 16.4:1 on sheet */
  --m-ink-2: #4A4C55;           /* 8.1:1 */
  --m-ink-3: #6F717B;           /* 4.9:1 — minimum for body text */
  --m-ink-4: #A3A5AD;           /* disabled, decorative only; never for text */
  --m-ink-on-accent: #FFFFFF;

  /* ---------- Accent: cobalt ---------- */
  --m-accent: #2B4BE0;          /* 6.1:1 on sheet, 5.6:1 on canvas */
  --m-accent-hover: #2340C4;
  --m-accent-active: #1C35A8;
  --m-accent-soft: #E9EDFC;     /* selected row, active nav */
  --m-accent-soft-2: #D5DCF8;   /* selected + hover */
  --m-accent-ink: #1E3AB8;      /* accent used as text on soft tint: 7.4:1 */
  --m-accent-ring: rgb(43 75 224 / 0.35);

  /* ---------- Status scale (hue means defect state) ---------- */
  --m-critical: #B42318;        --m-critical-soft: #FCEBE9;   --m-critical-ink: #8E1B12;
  --m-high: #BA4A0B;            --m-high-soft: #FDEEE3;       --m-high-ink: #8F3908;
  --m-medium: #946200;          --m-medium-soft: #FBF1DB;     --m-medium-ink: #6E4900;
  --m-low: var(--m-ink-3);      --m-low-soft: var(--m-sheet-raised);
  --m-pass: #157A3C;            --m-pass-soft: #E4F4EA;       --m-pass-ink: #0F5C2D;
  --m-info: var(--m-accent);    --m-info-soft: var(--m-accent-soft);

  /* Readiness verdicts reuse the status scale */
  --m-go: var(--m-pass);        --m-go-soft: var(--m-pass-soft);        --m-go-ink: var(--m-pass-ink);
  --m-at-risk: var(--m-medium); --m-at-risk-soft: var(--m-medium-soft); --m-at-risk-ink: var(--m-medium-ink);
  --m-no-go: var(--m-critical); --m-no-go-soft: var(--m-critical-soft); --m-no-go-ink: var(--m-critical-ink);

  /* DQS bands (defaults; tenant thresholds from /api/v1/objects override) */
  --m-dqs-target: 90;           /* >= target  -> --m-pass   */
  --m-dqs-warning: 75;          /* >= warning -> --m-medium */
  --m-dqs-critical: 60;         /* >= critical-> --m-high, below -> --m-critical */
  --m-dqs-cap-one: 85;
  --m-dqs-cap-two: 70;
  --m-dqs-track: var(--m-sheet-sunken);
  --m-dqs-cap-line: var(--m-ink-2);

  /* ---------- Charts ---------- */
  --m-viz-1: #2B4BE0;  /* cobalt      */
  --m-viz-2: #157A3C;  /* green       */
  --m-viz-3: #946200;  /* amber       */
  --m-viz-4: #0E7490;  /* teal        */
  --m-viz-5: #6D28D9;  /* violet      */
  --m-viz-6: #B42318;  /* red         */
  --m-viz-7: #BE185D;  /* magenta     */
  --m-viz-8: #4D7C0F;  /* olive       */
  --m-viz-grid: var(--m-line);
  --m-viz-axis: var(--m-ink-3);
  --m-viz-threshold: var(--m-ink-2);
  --m-viz-area: rgb(43 75 224 / 0.10);
  --m-viz-tooltip-bg: var(--m-ink);
  --m-viz-tooltip-ink: var(--m-sheet);

  /* ---------- Type ---------- */
  --m-font-sans: var(--m-font-sans-loaded, "Instrument Sans", system-ui, sans-serif);
  --m-font-display: var(--m-font-display-loaded, "Instrument Serif", Georgia, serif);
  --m-font-mono: var(--m-font-mono-loaded, "JetBrains Mono", ui-monospace, monospace);

  --m-text-hero: 56px;      --m-leading-hero: 60px;      /* count-up DQS */
  --m-text-verdict: 28px;   --m-leading-verdict: 34px;   /* serif verdict sentence */
  --m-text-title: 22px;     --m-leading-title: 28px;     /* auth h1, record key */
  --m-text-stat: 26px;      --m-leading-stat: 30px;      /* KPI tile value */
  --m-text-section: 15px;   --m-leading-section: 20px;   /* h2, drawer title */
  --m-text-body: 13px;      --m-leading-body: 18px;
  --m-text-meta: 12px;      --m-leading-meta: 16px;
  --m-text-micro: 11px;     --m-leading-micro: 14px;     /* badges, kbd */
  --m-tracking-tight: -0.02em;   /* hero and stat numerals */
  --m-tracking-normal: 0;

  /* ---------- Space (4px grid) ---------- */
  --m-space-1: 4px;  --m-space-2: 8px;  --m-space-3: 12px; --m-space-4: 16px;
  --m-space-5: 20px; --m-space-6: 24px; --m-space-8: 32px; --m-space-10: 40px;
  --m-space-12: 48px; --m-space-16: 64px; --m-space-24: 96px;
  --m-page-max: 1280px;
  --m-page-pad: var(--m-space-6);

  /* ---------- Shape ---------- */
  --m-radius-control: 6px;      /* buttons, inputs, pills' inner shapes */
  --m-radius-sheet: 10px;       /* cards, tables, dialogs */
  --m-radius-tile: 14px;        /* KPI tiles, auth brand panel */
  --m-radius-pill: 999px;
  --m-border: 1px;
  --m-rail-w: 240px;
  --m-rail-w-collapsed: 56px;
  --m-topbar-h: 48px;
  --m-row-h: 36px;
  --m-row-h-dense: 30px;
  --m-control-h: 32px;
  --m-control-h-lg: 40px;

  /* ---------- Elevation (three levels + focus) ---------- */
  --m-elev-0: none;
  --m-elev-1: 0 0 0 1px var(--m-line);                                    /* flat card: hairline only */
  --m-elev-2: 0 0 0 1px var(--m-line), 0 4px 12px rgb(20 21 25 / 0.08);     /* menu, popover, tooltip */
  --m-elev-3: 0 0 0 1px var(--m-line), 0 16px 48px rgb(20 21 25 / 0.16);    /* drawer, dialog, palette */
  --m-elev-focus: 0 0 0 2px var(--m-sheet), 0 0 0 4px var(--m-accent);
  --m-elev-accent: 0 1px 2px rgb(43 75 224 / 0.30);                         /* primary button */

  /* ---------- Gradients (the only four) ---------- */
  --m-grad-meridian: linear-gradient(90deg, transparent 0%, var(--m-accent) 20%, var(--m-accent) 80%, transparent 100%);
  --m-grad-brand: linear-gradient(160deg, #0F1430 0%, #16214F 45%, #2B4BE0 100%);
  --m-grad-brand-glow: radial-gradient(60% 50% at 70% 20%, rgb(141 163 255 / 0.35) 0%, transparent 70%);
  --m-grad-fade-bottom: linear-gradient(180deg, transparent 0%, var(--m-sheet) 100%);

  /* ---------- Glass (chrome only) ---------- */
  --m-glass-bg: rgb(255 255 255 / 0.72);
  --m-glass-blur: 12px;
  --m-glass-line: rgb(20 21 25 / 0.08);

  /* ---------- Motion ---------- */
  --m-motion-duration: 120ms;    /* hover, focus, colour */
  --m-motion-slow: 240ms;        /* drawer, dialog, rail width */
  --m-motion-draw: 480ms;        /* chart draw, count-up */
  --m-motion-shimmer: 1400ms;    /* skeleton sweep */
  --m-motion-ease: cubic-bezier(0.2, 0, 0, 1);
  --m-motion-ease-out: ease-out;
  --m-motion-rise-y: 6px;
}

/* ---------- Dark ---------- */
[data-theme="dark"] {
  --m-canvas: #0C0D11;
  --m-sheet: #131519;
  --m-sheet-raised: #1A1C22;
  --m-sheet-sunken: #0F1014;
  --m-rail: #0A0B0E;
  --m-line: #24262E;
  --m-line-strong: #34373F;
  --m-scrim: rgb(0 0 0 / 0.6);

  --m-ink: #EDEDF0;             /* 15.2:1 on sheet */
  --m-ink-2: #AEB0B8;           /* 8.0:1 */
  --m-ink-3: #85878F;           /* 4.9:1 */
  --m-ink-4: #4F525B;
  --m-ink-on-accent: #0C0D11;

  --m-accent: #8DA3FF;          /* 8.3:1 on sheet */
  --m-accent-hover: #A3B5FF;
  --m-accent-active: #7891F2;
  --m-accent-soft: #1A2247;
  --m-accent-soft-2: #222D5C;
  --m-accent-ink: #B7C4FF;
  --m-accent-ring: rgb(141 163 255 / 0.40);

  --m-critical: #F2756B;  --m-critical-soft: #3A1512;  --m-critical-ink: #FFA69E;
  --m-high: #F39A4B;      --m-high-soft: #3B2010;      --m-high-ink: #FFBE85;
  --m-medium: #E2B646;    --m-medium-soft: #352A0C;    --m-medium-ink: #F3D27E;
  --m-pass: #5FCF8A;      --m-pass-soft: #0F2F1C;      --m-pass-ink: #93E3B1;

  --m-viz-1: #8DA3FF; --m-viz-2: #5FCF8A; --m-viz-3: #E2B646; --m-viz-4: #4FC3DB;
  --m-viz-5: #B79AF5; --m-viz-6: #F2756B; --m-viz-7: #F27AB0; --m-viz-8: #A3CF5F;
  --m-viz-area: rgb(141 163 255 / 0.14);
  --m-viz-tooltip-bg: #EDEDF0;
  --m-viz-tooltip-ink: #0C0D11;

  --m-elev-2: 0 0 0 1px var(--m-line-strong), 0 4px 16px rgb(0 0 0 / 0.5);
  --m-elev-3: 0 0 0 1px var(--m-line-strong), 0 24px 64px rgb(0 0 0 / 0.7);
  --m-elev-accent: 0 1px 2px rgb(0 0 0 / 0.4);

  --m-grad-brand: linear-gradient(160deg, #07091A 0%, #0F1430 45%, #1E3AB8 100%);
  --m-glass-bg: rgb(12 13 17 / 0.72);
  --m-glass-line: rgb(255 255 255 / 0.08);
}

/* System preference when no explicit theme is set. Keep in sync with the dark block above. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]):not([data-theme="dark"]) {
    --m-canvas: #0C0D11; --m-sheet: #131519; --m-sheet-raised: #1A1C22; --m-sheet-sunken: #0F1014;
    --m-rail: #0A0B0E; --m-line: #24262E; --m-line-strong: #34373F; --m-scrim: rgb(0 0 0 / 0.6);
    --m-ink: #EDEDF0; --m-ink-2: #AEB0B8; --m-ink-3: #85878F; --m-ink-4: #4F525B; --m-ink-on-accent: #0C0D11;
    --m-accent: #8DA3FF; --m-accent-hover: #A3B5FF; --m-accent-active: #7891F2;
    --m-accent-soft: #1A2247; --m-accent-soft-2: #222D5C; --m-accent-ink: #B7C4FF; --m-accent-ring: rgb(141 163 255 / 0.40);
    --m-critical: #F2756B; --m-critical-soft: #3A1512; --m-critical-ink: #FFA69E;
    --m-high: #F39A4B; --m-high-soft: #3B2010; --m-high-ink: #FFBE85;
    --m-medium: #E2B646; --m-medium-soft: #352A0C; --m-medium-ink: #F3D27E;
    --m-pass: #5FCF8A; --m-pass-soft: #0F2F1C; --m-pass-ink: #93E3B1;
    --m-viz-1: #8DA3FF; --m-viz-2: #5FCF8A; --m-viz-3: #E2B646; --m-viz-4: #4FC3DB;
    --m-viz-5: #B79AF5; --m-viz-6: #F2756B; --m-viz-7: #F27AB0; --m-viz-8: #A3CF5F;
    --m-viz-area: rgb(141 163 255 / 0.14); --m-viz-tooltip-bg: #EDEDF0; --m-viz-tooltip-ink: #0C0D11;
    --m-elev-2: 0 0 0 1px var(--m-line-strong), 0 4px 16px rgb(0 0 0 / 0.5);
    --m-elev-3: 0 0 0 1px var(--m-line-strong), 0 24px 64px rgb(0 0 0 / 0.7);
    --m-elev-accent: 0 1px 2px rgb(0 0 0 / 0.4);
    --m-grad-brand: linear-gradient(160deg, #07091A 0%, #0F1430 45%, #1E3AB8 100%);
    --m-glass-bg: rgb(12 13 17 / 0.72); --m-glass-line: rgb(255 255 255 / 0.08);
  }
}

/* ---------- Effect utilities (components use the class, never the literal) ---------- */
.m-glass {
  background: var(--m-glass-bg);
  -webkit-backdrop-filter: blur(var(--m-glass-blur));
  backdrop-filter: blur(var(--m-glass-blur));
  box-shadow: inset 0 -1px 0 var(--m-glass-line);
}
.m-meridian-line {               /* the 1px signature hairline */
  height: 1px;
  background: var(--m-grad-meridian);
}
.m-brand-panel {                 /* auth page right panel */
  background: var(--m-grad-brand);
  position: relative;
}
.m-brand-panel::before {
  content: "";
  position: absolute; inset: 0;
  background: var(--m-grad-brand-glow);
  pointer-events: none;
}
.m-fade-bottom { background: var(--m-grad-fade-bottom); }
.m-elev-1 { box-shadow: var(--m-elev-1); }
.m-elev-2 { box-shadow: var(--m-elev-2); }
.m-elev-3 { box-shadow: var(--m-elev-3); }
.m-numeric { font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" 1, "lnum" 1; }
.m-display { font-family: var(--m-font-display); font-weight: 400; letter-spacing: var(--m-tracking-normal); }

/* ---------- Motion ---------- */
@keyframes m-shimmer { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
@keyframes m-draw    { from { stroke-dashoffset: var(--m-draw-length, 1000); } to { stroke-dashoffset: 0; } }
@keyframes m-rise    { from { opacity: 0; transform: translateY(var(--m-motion-rise-y)); } to { opacity: 1; transform: translateY(0); } }
@keyframes m-sweep   { from { background-position: -200% 0; } to { background-position: 200% 0; } }
@keyframes m-scale-in{ from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
@keyframes m-slide-in-right { from { transform: translateX(16px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes m-meridian-sweep { from { background-position: -100% 0; } to { background-position: 200% 0; } }

.m-motion-width   { transition: width var(--m-motion-slow) var(--m-motion-ease); }
.m-motion-fade    { transition: opacity var(--m-motion-duration) var(--m-motion-ease-out); }
.m-motion-colors  { transition: color var(--m-motion-duration) var(--m-motion-ease-out), background-color var(--m-motion-duration) var(--m-motion-ease-out), border-color var(--m-motion-duration) var(--m-motion-ease-out), box-shadow var(--m-motion-duration) var(--m-motion-ease-out); }
.m-motion-rise    { animation: m-rise var(--m-motion-slow) var(--m-motion-ease) both; }
.m-motion-scale-in{ animation: m-scale-in var(--m-motion-slow) var(--m-motion-ease) both; }
.m-motion-slide-in-right { animation: m-slide-in-right var(--m-motion-slow) var(--m-motion-ease) both; }
.m-motion-draw    { animation: m-draw var(--m-motion-draw) var(--m-motion-ease-out) both; }
.m-motion-stagger > * { animation: m-rise var(--m-motion-slow) var(--m-motion-ease) both; }
.m-motion-stagger > :nth-child(2) { animation-delay: 40ms; }
.m-motion-stagger > :nth-child(3) { animation-delay: 80ms; }
.m-motion-stagger > :nth-child(4) { animation-delay: 120ms; }
.m-motion-stagger > :nth-child(5) { animation-delay: 160ms; }
.m-motion-stagger > :nth-child(n+6) { animation-delay: 200ms; }
.m-skeleton-sweep { animation: m-shimmer var(--m-motion-shimmer) linear infinite; }
.m-meridian-live  {   /* top-edge hairline while a job runs */
  background: var(--m-grad-meridian);
  background-size: 50% 100%;
  background-repeat: no-repeat;
  animation: m-meridian-sweep var(--m-motion-shimmer) var(--m-motion-ease) infinite;
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --m-motion-duration: 0ms;
    --m-motion-slow: 0ms;
    --m-motion-draw: 0ms;
    --m-motion-shimmer: 0ms;
    --m-motion-rise-y: 0px;
  }
  .m-motion-rise, .m-motion-scale-in, .m-motion-slide-in-right, .m-motion-draw, .m-motion-stagger > *,
  .m-skeleton-sweep, .m-meridian-live { animation: none; }
  .m-motion-width, .m-motion-fade, .m-motion-colors { transition: none; }
}
```

### 2.1 `design/tokens.ts` additions (no renames)

Add to `mColor`: `sheetSunken`, `rail`, `lineStrong`, `ink4`, `inkOnAccent`, `accentHover`, `accentInk`, `criticalSoft`, `highSoft`, `mediumSoft`, `passSoft`, `criticalInk`, `highInk`, `mediumInk`, `passInk`, `vizArea`, `vizTooltipBg`, `vizTooltipInk` — each as `"var(--m-…)"`. Add `mRadius.tile = 14`, `mRadius.pill = 999`. Change `mMotion` values to `{ duration: 120, slow: 240, draw: 480, shimmer: 1400, ease: "cubic-bezier(0.2, 0, 0, 1)" }`. Add `mElev = { flat: "var(--m-elev-1)", raised: "var(--m-elev-2)", floating: "var(--m-elev-3)", focus: "var(--m-elev-focus)" }`. Add `dqsBand(score, bands): "pass" | "medium" | "high" | "critical"` returning the colour key for a score (≥target pass, ≥warning medium, ≥critical high, else critical). `Severity`, `severityShape`, `severityColor`, `isSeverity`, `reducedMotion` unchanged.

### 2.2 `app/globals.css` bridge changes

- `--radius: var(--m-radius-sheet)` (was control).
- Add `--font-display: var(--m-font-display)` to `@theme inline`.
- `body { font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" 1, "lnum" 1; background: var(--m-canvas); color: var(--m-ink); }`.
- `:focus-visible { outline: none; box-shadow: var(--m-elev-focus); border-radius: var(--m-radius-control); }`.
- `::selection { background: var(--m-accent-soft-2); }`.
- Keep `html { font-size: 13px }` — legacy rem layouts depend on it.
- Scrollbar: `scrollbar-color: var(--m-line-strong) transparent`.

---

## 3. Typography

| Role | Family | Weights | `next/font` export | CSS var |
|---|---|---|---|---|
| UI / body | **Instrument Sans** (Google) | 400, 500, 600 | `Instrument_Sans` | `--m-font-sans-loaded` |
| Display (verdicts only) | **Instrument Serif** (Google) | 400, 400 italic | `Instrument_Serif` | `--m-font-display-loaded` |
| SAP identifiers | **JetBrains Mono** (Google) | 400, 500 | `JetBrains_Mono` | `--m-font-mono-loaded` |

`app/layout.tsx`:

```ts
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from "next/font/google";

const sans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--m-font-sans-loaded", display: "swap" });
const display = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--m-font-display-loaded", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--m-font-mono-loaded", display: "swap" });
// <html className={`${sans.variable} ${display.variable} ${mono.variable}`}>
```

Tabular figures: `body` sets `font-variant-numeric: tabular-nums` globally (Instrument Sans ships `tnum`). Mono gets `slashed-zero` as today.

Type scale (use the tokens, not literals):

| Token | Size/leading | Weight | Use |
|---|---|---|---|
| hero | 56/60 | 600, tracking tight | Count-up DQS on home, system detail |
| verdict | 28/34 | display 400 | Home verdict sentence; auth h1 |
| title | 22/28 | 600 | Record key on RecordPage, dialog title |
| stat | 26/30 | 600, tracking tight | KPI tile value |
| section | 15/20 | 600 | h2, card title, drawer title, tab (selected) |
| body | 13/18 | 400/500 | everything |
| meta | 12/16 | 400 | labels, captions, breadcrumbs crumbs |
| micro | 11/14 | 500 | Badge, kbd, table header |

`h1` is rendered once, by `Breadcrumb` (unchanged). Page bodies never render `h1`.

---

## 4. Logo

**Concept — the gauge and the meridian.** The mark is the product's own hero widget made into a symbol: a 270° measuring arc (the DQS score ring, open at the top where the reading is taken) crossed by a single vertical line that runs past the arc at both ends — the meridian, the reference line everything is measured against. Read fast it is a dial with a needle at zero; read slowly it is a globe with its prime meridian; read as a letter it is a lower-case "i" turned into an instrument. Two strokes, one weight, no fill. It is the ScoreRing primitive at rest.

Geometry (32-unit grid, used by every asset):

- Arc: centre (16,16), radius 10, stroke 3, round caps, gap of 70° centred on 12 o'clock. Path: `M21.74 7.81 A10 10 0 1 1 10.26 7.81`.
- Meridian: `M16 3 V29`, stroke 3, round caps.
- Two-tone: arc in `--m-ink`, meridian in `--m-accent` (light) or arc `#EDEDF0`, meridian `#8DA3FF` (dark). Mono: both in one colour.

Files delivered beside this spec: `logo-mark.svg`, `logo-wordmark.svg`, `logo-lockup.svg`, `logo-lockup-dark.svg`, `favicon.svg`, `apple-icon.svg`, `og-image.svg`.

Wordmark: "MERIDIAN" is not typeset; it is drawn as monoline strokes (stroke 3, round caps/joins, cap height 24) on the same grid as the mark so the lockup is one construction. Only the wordmark may use the drawn capitals; UI text is always sentence case Instrument Sans.

Usage rules:

- **Minimum size.** Mark 16px (favicon uses stroke 4 and no two-tone). Lockup 96px wide. Below 96px, use the mark alone.
- **Clear space.** Half the mark's height (16 units at 32) on every side. Nothing enters it, including the word "Meridian" in UI chrome — the Rail brand row uses the mark plus a text label set in Instrument Sans, not the lockup.
- **Colour.** Two-tone on `--m-canvas`/`--m-sheet` only. Mono-ink on photography, dark gradients or when the accent is not available. Reversed (paper on dark) is `logo-lockup-dark.svg`. Never on a tile or rounded square except the OS app icon (`apple-icon.svg`), which uses `--m-grad-brand`.
- **Do not** rotate, add a drop shadow, fill the arc, close the arc, change the gap angle, or place text inside the arc.
- **In product.** `MeridianMark` (`components/meridian/icons.tsx`) renders the geometry above with `variant="two-tone" | "mono"`; the old `"tile"` variant is deleted (one call site: Rail; one in AuthFrame). `app/icon.svg` = `favicon.svg`. `public/brand/mark-light.svg` = `logo-mark.svg`; `brand-rasterise.mjs` reads *both* paths (`d` attributes of the two `<path>` elements).
- `public/brand/brand.json` → `{"accent":"#2B4BE0","accentDark":"#8DA3FF","canvas":"#F4F3EF","canvasDark":"#0C0D11","ink":"#141519","inkDark":"#EDEDF0"}`.

---

## 5. Shell

Layout: `flex h-screen`. Rail left (`--m-rail-w` / `--m-rail-w-collapsed`), then a column: 1px `m-meridian-line` at the very top of the content column, TopBar, `main`. The hairline is the brand signature in the app; while any job is running (`useJobs().active.length > 0`) the `(app)/layout.tsx` swaps its class to `m-meridian-live`.

### 5.1 Rail (`design/shell/Rail.tsx`)

- Background `--m-rail`, no right border in light (canvas = rail); in dark a 1px `--m-line` right border.
- Brand row: height `--m-topbar-h`, padding-left 16. `MeridianMark size={22} variant="two-tone"` + "Meridian" 15/20 600 `--m-ink`. Collapsed: mark centred, no text.
- Group label: 11/14 500 `--m-ink-3`, padding `20px 16px 6px`. Collapsed: replaced by an 8px gap with a 1px `--m-line` rule, 24px wide, centred.
- Row: height 32, margin `0 8px`, padding `0 8px`, radius `--m-radius-control`, icon 16 at `--m-ink-3`, label 13/18 500 `--m-ink-2`. Hover: bg `--m-sheet-raised` (dark: `--m-sheet`), label `--m-ink`. Active: bg `--m-accent-soft`, label and icon `--m-accent-ink`, 600, plus a 2px × 16px accent bar at x=-8 (left edge of rail gutter), radius 1. No 3px border-left on the row itself any more.
- Badge: `Badge` at row end; `Systems` health pip 6px (`--m-pass` / `--m-critical`) at the icon's top-right.
- Depth-1 children: height 28, padding-left 36, 12/16, no icon.
- Collapse control: bottom, height 40, icon `PanelLeft` 16, same row styling, tooltip "Collapse [".
- Flyout (collapsed hover): `m-elev-2`, bg `--m-sheet`, radius `--m-radius-sheet`, min-w 200, padding 6, items as rows above; `m-motion-scale-in`.
- Width transition `m-motion-width`. Keyboard `[` unchanged.

### 5.2 TopBar (`design/shell/TopBar.tsx`)

- `sticky top-0 z-20`, height `--m-topbar-h`, class `m-glass`, padding `0 24px`. (The hairline above it is in the layout, not the bar.)
- Left: `Breadcrumb`. Right cluster, gap 8: `RunSelector`, `CommandPalette` trigger, `JobTray`, `ThemeToggle`, `UserMenu`.
- `TopBar` keeps its props `{ runSelector, commandPalette, userMenu }`; `userMenu` now receives `<UserMenu />` (new, `components/user-menu.tsx`), which itself contains the `ThemeToggle`. No `@/design` export changes.

### 5.3 Breadcrumb

Crumbs 12/16 `--m-ink-3`, separator a 3px dot (`•`) in `--m-ink-4` instead of `/`; last crumb is the `h1` 15/20 600 `--m-ink`. Crumb hover: `--m-ink`. Max 3 leading crumbs; earlier ones collapse to `…` with a `Menu` listing them.

### 5.4 RunSelector

A `Select` styled as a 32px control: bg `--m-sheet`, border `--m-line-strong`, radius control, left label "Run" 12/16 `--m-ink-3` inside the control, value 13/18 500 `--m-ink` in `--m-font-mono` for the run id with the human label after it in sans. Width 240 at `xl`, icon-only (History icon) below `lg`.

### 5.5 Command palette (`design/shell/CommandPalette.tsx`)

- Trigger: 32px control, 220px at `xl`: Search icon 14 `--m-ink-3`, "Search or jump to…" 13 `--m-ink-3`, right `kbd` "⌘K" 11/14 mono `--m-ink-3` with 1px `--m-line` border, radius 4, bg `--m-sheet-raised`. Below `xl`: 32×32 IconButton.
- Dialog: backdrop `--m-scrim` with `m-glass` (blur the app behind); panel 640w, top 15vh, bg `--m-sheet`, radius `--m-radius-sheet`, `m-elev-3`, `m-motion-scale-in`.
- Input row height 52, 15/20, no border, bottom hairline `--m-line`. Placeholder "Type a page, object, check ID or record key".
- Groups: label 11/14 500 `--m-ink-3` padding `12px 16px 4px`. Items height 36, radius control, margin `0 8px`; icon 16 `--m-ink-3`; label 13/18; right-aligned `shortcut` in kbd style. Selected (`data-selected`): bg `--m-accent-soft`, label `--m-accent-ink`. SAP identifiers in results render in `Mono`.
- Footer row height 36, bg `--m-sheet-raised`, three kbd hints (↑↓ navigate, ↵ open, esc close) 11/14 `--m-ink-3`.
- Empty: "Nothing matches. Try a check ID like `MM-001` or a material number." 13 `--m-ink-3`, padding 24.

### 5.6 User menu and theme toggle

`UserMenu` (new, `components/user-menu.tsx`, built on `Menu`): trigger is a 28px circle with the user's initials, bg `--m-accent-soft`, `--m-accent-ink` 11/14 600; focus ring per global. Menu `m-elev-2`, width 240: header (name 13/18 500, email 12/16 `--m-ink-3` in mono, role `Pill tone="neutral"`), separator, "Theme" row containing a three-segment control Light / System / Dark (32h, segments radius control, selected bg `--m-sheet`, `m-elev-1`), separator, "Keyboard shortcuts  ?" , "Sign out". `ThemeToggle` stays exported from `components/theme-toggle.tsx` and now renders that segmented control (used inside the menu and on the auth pages' top-right corner).

### 5.7 JobTray

Trigger IconButton `Activity` icon; when `active.length > 0` the icon gets a 6px `--m-accent` pip and the top hairline animates (5 above). Drawer content: each job a row with label 13/18 500, status 12/16 `--m-ink-3`, a 4px progress track `--m-sheet-sunken` with `--m-accent` fill, percentage in `m-numeric`.

### 5.8 Toasts (`design/shell/Toaster.tsx`)

`position="bottom-right"`, `expand`, `richColors={false}`. Toast: bg `--m-sheet`, `m-elev-3`, radius `--m-radius-sheet`, padding 12 16, 13/18; a 3px left bar in the tone colour (`--m-pass`, `--m-critical`, `--m-accent` for info); title 500, description `--m-ink-2`; action rendered as `Button variant="ghost"`. Sonner CSS vars: `--normal-bg: var(--m-sheet)`, `--normal-border: transparent`, `--border-radius: var(--m-radius-sheet)`; tone bars via `[data-type]` selectors in `globals.css`.

### 5.9 Loading (`app/(app)/loading.tsx`)

Page-level: a 24px Skeleton at 360 wide (title), then a 1280-max grid of three `KpiTile` skeletons (height 96) then one 320 skeleton. All inside `m-motion-stagger`.

---

## 6. Login and auth pages

Routes: `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/licence-error` (`/login` redirects). All use `AuthFrame` (`components/auth/auth-frame.tsx`); its props stay `{ title, lead, side, children }`.

### 6.1 Layout

Two columns from `lg` (≥1024): **brand panel left** 45% (min 440, max 620), **form column right** flex-1. Below `lg`: brand panel becomes a 160px band at the top with the lockup and the hairline only.

**Brand panel** (`aside.m-brand-panel`, radius 0; padding 48):
- Top: `logo-lockup-dark.svg` geometry at 32px high (mark two-tone: arc `#8DA3FF`, meridian `#EDEDF0`).
- Middle (vertically centred): a large decorative instrument — the ScoreRing geometry at 320px, stroke 6, track `rgb(255 255 255 / 0.10)`, arc `#8DA3FF`, drawn with `m-motion-draw` on mount to 72% and the meridian line descending through it (`m-motion-rise`). Inside the ring the serif line "SAP data quality, measured." at 28/34 `#EDEDF0` plus 13/18 `rgb(255 255 255 / 0.72)` "Every check is deterministic. Every number opens the rows behind it." These texts are static copy in the component, not customer data.
- Bottom: four facts as a 2×2 grid of 12/16 `rgb(237 237 240 / 0.72)` lines with a 6px `#8DA3FF` dot: "Runs inside your network", "800+ SAP checks", "29 modules, 7 system types", "Nothing leaves this server". Then the 1px `m-meridian-line` across the panel width.
- Colours inside the brand panel are the only place a component may use literal paper/accent values — they come from `--m-grad-brand` tokens plus `--m-ink-on-accent`-style tokens; add `--m-brand-ink: #EDEDF0`, `--m-brand-ink-2: rgb(237 237 240 / 0.72)`, `--m-brand-accent: #8DA3FF`, `--m-brand-track: rgb(255 255 255 / 0.10)` to tokens.css (both themes identical).

**Form column**: bg `--m-canvas`; `ThemeToggle` segmented control top-right at 24px inset; form card centred, width 400, bg `--m-sheet`, radius `--m-radius-tile`, `m-elev-1`, padding 32, `m-motion-rise`. Inside: mark 24 two-tone (only below `lg`, when the brand panel is a band), `h1` 28/34 display serif (`m-display`) `--m-ink`, lead 13/18 `--m-ink-2`, form, then footer line 12/16 `--m-ink-3` "Meridian runs inside your network. No data leaves this server. v1.2.3" (version mono).

### 6.2 Form

- Inputs: `authInputClass` → height 40, radius control, bg `--m-sheet`, border `--m-line-strong`, 13/18, padding 0 12, hover border `--m-ink-3`, focus `--m-elev-focus` and border `--m-accent`. Label 12/16 500 `--m-ink-2` above. Error 12/16 `--m-critical` below with a 10px square SeverityDot-critical.
- `PasswordField`: Show/Hide becomes an icon button (Eye/EyeOff 16) inside the input at right, 32×32.
- Primary button full width, height 40.
- `AuthNotice`: bg `--m-critical-soft`/`--m-pass-soft`, border none, left 3px bar in tone, text `--m-critical-ink`/`--m-pass-ink`, radius control.
- Links `--m-accent`, underline on hover only.
- Submit pending: button label swaps to a 16px ring spinner (ScoreRing geometry rotating, `--m-motion-shimmer` duration) + "Signing in…".

### 6.3 Per page

| Route | h1 | Lead | Form | Notes |
|---|---|---|---|---|
| sign-in | "Sign in" | none | Email, Password, [Sign in], "Forgot password?" link right of actions | Redirect via `resolveNavHref`. |
| sign-up | "Create your account" | "You were invited to this Meridian." | Name, Email, Password, Confirm | Only when invites allow. |
| forgot-password | "Reset your password" | "We'll email a link that works for one hour." | Email, [Send link], "Back to sign in" | Success swaps form for `AuthNotice success`. |
| reset-password | "Choose a new password" | token note | New, Confirm, [Save] | Expired → danger notice + link. |
| accept-invite | "Join Meridian" | inviter sentence | Name, Password, [Accept] | |
| licence-error | "Licence needed" | the API's reason | none; `AuthNotice danger`, [Open Meridian HQ] secondary, [Retry] primary | Brand panel ring shows 0% in `--m-brand-track` only. |

Loading state for every auth page: the card renders with three 40px Skeletons and a 40px button skeleton (`m-motion-stagger`) while `useAuroraPrefs`/session resolves. Empty state is not applicable (forms are always present).

---

## 7. Primitives

All in `design/primitives/`. Export names unchanged. Styles come from classes defined in `globals.css` `@layer components` (which may only reference tokens) or inline `var()` — never literals.

### 7.1 Button (`Button.tsx`)
- Sizes: `sm` 28h / 12px type, `md` 32h / 13px (default), `lg` 40h / 13px. Padding 0 12 (sm 0 10, lg 0 16). Radius control. Gap 8. Weight 500. `m-motion-colors`.
- `primary`: bg `--m-accent`, text `--m-ink-on-accent`, `--m-elev-accent`; hover `--m-accent-hover`; active `--m-accent-active`.
- `secondary`: bg `--m-sheet`, border `--m-line-strong`, text `--m-ink`; hover bg `--m-sheet-raised`, border `--m-ink-3`.
- `ghost`: transparent, text `--m-ink-2`; hover bg `--m-sheet-raised`, text `--m-ink`.
- New variant `danger`: bg `--m-critical`, text white; only inside confirm dialogs.
- Disabled: opacity .5. Loading prop `pending`: spinner replaces leading icon. `render` prop unchanged.

### 7.2 IconButton
28×28 (`sm`) / 32×32 default, radius control, ghost styling, icon 16 `--m-ink-2`; hover `--m-ink`.

### 7.3 Field / Select / Combobox / inputs
- Control height 32 (`--m-control-h`), radius control, bg `--m-sheet`, border `--m-line-strong`, padding 0 10, 13/18, placeholder `--m-ink-3`. Hover border `--m-ink-3`. Focus: border `--m-accent` + `--m-elev-focus`. Invalid: border `--m-critical`.
- `Field` label 12/16 500 `--m-ink-2`, gap 6; error 12/16 `--m-critical` with critical square 8px.
- `Select` popup: `m-elev-2`, bg `--m-sheet`, radius sheet, padding 4; items 32h radius control; selected bg `--m-accent-soft` text `--m-accent-ink`; check icon right.
- Checkbox (DataTable select): 16px, radius 4, border `--m-line-strong`; checked bg `--m-accent` white check.

### 7.4 Card (new export `Card`, `design/primitives/Card.tsx`)
`Card({ title?, meta?, actions?, children, padding = "md", tone? })`. bg `--m-sheet`, radius `--m-radius-sheet`, `m-elev-1`, padding 20 (md) / 12 (sm) / 24 (lg). Header row: title 15/20 600, meta 12/16 `--m-ink-3` right, actions. Templates currently open-code this box (`InstrumentPanel`, `EmptyState`, object detail) — they switch to `Card`. **Rename list: none; `Card` is an addition.**

### 7.5 Pill
Height 22, padding 0 8, radius pill, 12/16 500. Filled soft style: bg `--m-{tone}-soft`, text `--m-{tone}-ink`, no border; leading 6px dot in `--m-{tone}` for go/at-risk/no-go. `neutral`: bg `--m-sheet-raised`, text `--m-ink-2`, border 1px `--m-line`. Tones unchanged (`neutral | go | at-risk | no-go`); add `info` (accent-soft / accent-ink).

### 7.6 Badge
Height 18, min-w 18, radius pill, 11/14 600 mono, bg `--m-accent`, text `--m-ink-on-accent`. In the Rail, when the row is active, invert: bg `--m-accent-ink` text `--m-accent-soft`.

### 7.7 Tabs
List: bottom hairline `--m-line`. Tab: height 36, padding 0 2, margin-right 20, 13/18 500 `--m-ink-3`; hover `--m-ink`; selected `--m-ink` 600 with a 2px `--m-accent` underline radius 1 that slides between tabs (`transition: transform var(--m-motion-slow)` via a single indicator element). Optional count in `Badge`-style neutral.

### 7.8 Table (`design/table/DataTable.tsx`)
- Wrapper: `Card` padding 0, overflow hidden.
- Header: height 36, bg `--m-sheet-raised`, 11/14 500 `--m-ink-3`, sorted column `--m-ink` with 12px arrow; bottom border `--m-line-strong`.
- Rows: height `--m-row-h` (36), border-bottom `--m-line`, 13/18 `--m-ink`; numeric cells right-aligned `m-numeric`; identifier cells `Mono`. Hover bg `--m-sheet-raised`. Selected bg `--m-accent-soft`. Row click cursor pointer; the first text cell gets `--m-accent` on hover when `onRowClick` exists.
- Density toggle `dense` → `--m-row-h-dense`.
- `Pager`: right-aligned 12/16 `--m-ink-3` "1–50 of 2,310" plus two IconButtons (ChevronLeft/Right).
- `BulkBar`: floats at the bottom of the viewport (sticky, bottom 16), width fit, bg `--m-ink`, text `--m-sheet`, radius pill, `m-elev-3`, padding 8 16, `m-motion-rise`; actions are ghost buttons inverted.

### 7.9 Stat / KPI tile (`Stat.tsx`)
`Stat({ label, value, delta, hint?, href?, tone? })` renders a tile: bg `--m-sheet`, radius `--m-radius-tile`, `m-elev-1`, padding 16 20, min-w 160. Label 12/16 `--m-ink-3`; value 26/30 600 tracking tight `m-numeric` `--m-ink`; delta row 12/16 (`Delta` + hint). Optional `tone` paints a 3px top bar in the tone colour. When `href` set the whole tile is a `DrillLink` and hovers to `--m-elev-2`. Stats placed in a `grid auto-fit minmax(160px,1fr) gap 12`. Existing call sites passing `delta` strings keep working (delta is `ReactNode`).

### 7.10 ScoreRing / DQS gauge (`ScoreRing.tsx`)
- Geometry = the logo: 270° arc open at 12 o'clock, track `--m-dqs-track`, value arc coloured by `dqsBand`, stroke = size/10 (min 3), round caps; a 1px vertical meridian line through the centre in `--m-line-strong` at sizes ≥ 96 only.
- Sizes: 24 (table), 48 (inline), 96 (card), 160 (hero). Centre number `m-numeric` 600 at size/2.8; at ≥96 add "/100" 12/16 `--m-ink-3` under it.
- **Cap**: new prop `cap?: number`. When set, a 2px `--m-dqs-cap-line` tick at the cap angle and the measured value drawn as a dashed ghost arc beyond the cap; label under the ring "Capped at 85 — 1 critical" 12/16.
- Draw on mount with `m-motion-draw` (`--m-draw-length` = circumference). Reduced motion: static.
- Export `DEFAULT_SCORE_BANDS` unchanged.

### 7.11 Counter
Unchanged behaviour; font 56/60 600 tracking tight (`--m-text-hero`), `m-numeric`.

### 7.12 Charts (`design/charts/*`)
- `chartTheme` additions: `area: mColor.vizArea`, `tooltipBg`, `tooltipInk`, `threshold: mColor.ink2`.
- Grid: horizontal only, `--m-viz-grid`, `strokeDasharray` none. Axes: no axis line, ticks 12/16 `--m-viz-axis`, `tickLine={false}`.
- Line: stroke 2 `--m-viz-1`, area fill `--m-viz-area` beneath (`Area` under `Line`), dots hidden except `activeDot` r 4 fill `--m-viz-1` with 2px `--m-sheet` ring. Threshold line `--m-viz-threshold` dashed 4 4 with a right-aligned label "Target 90".
- Bar: radius 3 top corners, fill `--m-viz-1`; bars below threshold fill `--m-high`; hover fill `--m-accent-hover`. Gap 40%.
- Waterfall: increases `--m-pass`, decreases `--m-critical`, totals `--m-ink-2`.
- Radar: stroke `--m-viz-1`, fill `--m-viz-area`, polygon grid `--m-viz-grid`.
- Heatmap: cells radius 3, gap 2, colours `--m-{go|at-risk|no-go}-soft` with a 6px dot of the full tone centred; hover ring `--m-accent`. Row/col labels 12/16.
- Sparkline: stroke 1.5, colour by direction, last point dot r 2.
- Graph (duplicates): nodes 8px circles `--m-viz-1`, master node 12px `--m-ink`, edges `--m-line-strong` width by confidence (1–3), labels mono 11.
- Tooltip (custom, all charts): bg `--m-viz-tooltip-bg`, ink `--m-viz-tooltip-ink`, radius control, padding 8 10, 12/16, value `m-numeric`; no arrow.
- Series palette order: viz-1…8. Never more than 8 series; collapse the rest into "Other" `--m-ink-4`.

### 7.13 Dialog
Panel 480w, bg `--m-sheet`, radius `--m-radius-sheet`, `m-elev-3`, `m-motion-scale-in`, padding 24. Title 17/24 600 (`--m-text-title` −5 → use section token at 17? No: use `title` 22/28 for destructive confirms, `section` 15/20 for forms). Body 13/18 `--m-ink-2`. Footer right-aligned, gap 8, secondary then primary (or `danger`). Backdrop `--m-scrim`.

### 7.14 Drawer
Width 480 (was 420), bg `--m-sheet`, `m-elev-3`, `m-motion-slide-in-right`, inset 8px from top/right/bottom with radius `--m-radius-sheet` (floating sheet, Linear-style) at ≥ `lg`; full-height flush below. Header 56h: title 15/20 600, subtitle slot 12/16 `--m-ink-3` (e.g. check ID in Mono), close IconButton. Body padding 20. Optional sticky footer for actions.

### 7.15 Skeleton
bg `--m-sheet-sunken`, radius control, sweep layer `--m-sheet-raised` → use a 40% band; animated with `m-skeleton-sweep`. Compose page skeletons inside `m-motion-stagger`.

### 7.16 EmptyState
`EmptyState({ title, detail, action, ghost })` unchanged API. Visual: `Card` max-w 560; the ghost drawn in `--m-sheet-sunken` shapes with a `m-fade-bottom` overlay; below it title 15/20 600, detail 13/18 `--m-ink-2`, action primary `md`. Add ghost kinds `"ring"` (a 96px ScoreRing track with no value and a dashed meridian) and `"stepper"`. Page-level empty states should also set the verdict slot (home) or the summary slot (explorer) to a one-sentence sentence in `--m-ink-3`.

### 7.17 ErrorState
Same card as EmptyState with a 3px `--m-critical` top bar, title "Could not reach the server.", message mono 12 `--m-ink-3`, Retry secondary button.

### 7.18 Mono
`font-family: var(--m-font-mono)`, 12/16 inside 13px text, `--m-ink`, bg `--m-sheet-sunken`, padding 1 4, radius 4 when `inline` prop; bare otherwise.

---

## 8. Insight layer, personas, screens and access

Page-level design lives in two companion files in this folder. Implementers read them with this spec:

- **`screens.md`** — the insight contract every page obeys (§1), the three persona journeys with click counts (§2), the composition of every route including hero, empty and loading states (§3), and the backend coverage matrix mapping all 397 endpoints and 88 schema models to a screen, with every gap closed by a designed screen (§4).
- **`rbac.md`** — roles, the resource × action matrix, scoping, the Admin › Roles & access UI, persona gating, the backend contract that extends `api/services/rbac.py` without breaking a call site, and the migration.

### 8.1 Why this beats the market

Linear, Vercel, Stripe, Datadog, Ataccama ONE and Collibra are the floor, not the target. What each does well and where Meridian goes past it:

| Pattern they own | Where Meridian goes further |
|---|---|
| **Ataccama ONE** — a DQ score per catalog item, a rule library, a "DQ issues" tab per table | A score that **explains itself** on hover (`ScoreExplainer`: weights, caps, the five rules that moved it) and that drills to failing SAP keys in ≤3 clicks. Ataccama shows the number; Meridian shows the computation and the rows. |
| **Collibra** — data stewardship workflows, glossary, lineage diagrams | Stewardship is **ranked by money and go-live impact** (`NextActions` from `analytics/prescriptive` + `simulations`): "+3.2 DQS, 412 records, 2 features unblocked" on every card. Collibra queues tasks; Meridian tells the steward which one pays. |
| **Informatica / SAP MDG** — match & merge, survivorship, golden records | Every merge decision has an **Explain tab** (per-rule match scores) and a one-click **Undo**/**Revert** on the event timeline, with pair constraints inline. Match tuning shows a precision/recall curve before saving. |
| **Datadog** — dense instrument dashboards, annotated timeseries, live job status | The DQS trend carries **run, config-sync and rule-change annotations** so a drop is attributed on hover; a **readiness funnel per migration wave** (Records → Mapped → Valid → Loadable → Signed off) shows exactly where records fall out, with each drop-off a link to the rows. No DQ vendor ships this funnel. |
| **Linear** — command palette, keyboard-first, calm density | The palette parses **natural-language SAP sentences** ("critical material master findings in PRD last run") into URL filters deterministically, with the parsed chips shown before Enter. Every filter lives in the URL; every view is saveable and shareable. |
| **Stripe** — plain-language explanations next to numbers, impeccable empty states | Every page opens with four sentences — **Situation · Changed · Why it matters · Do next** — each a link to its evidence, each with a designed fresh-install sentence. Stripe explains a charge; Meridian explains a score, a wave and a system the same way. |
| **Vercel** — brand confidence, light/dark parity, restraint | A warm-paper light theme and an ink dark theme that share one token file, one logo that works at 16 px, and a gauge-and-meridian mark that means what the product does. |
| **All of them** — an "AI insights" badge with no provenance | The AI row is labelled **"AI summary from deterministic findings"**, states which run and how many findings it saw, has thumbs that feed `POST /ai/feedback`, and falls back to the deterministic narrator when the model is off. Nothing on screen is a model's number. |

Two things no competitor does because none of them sit inside an SAP programme: **config impact** (a failing rule names the S/4 feature it blocks, in currency) surfaces in the "Why it matters" cell of every page, and **S/4 readiness per object × wave** is the home heatmap for a programme lead.

### 8.2 Insight-first contract (summary)

Every route: Breadcrumb → `InsightHeader` (Situation / Changed / Why / Do next; `AiSummary` row where a narrative exists) → hero visual → `NextActions` where actions exist → evidence tables and forms. New design exports: `templates/InsightHeader`, `templates/NextActions`, `primitives/AiSummary`, `primitives/ScoreExplainer`, `charts/Funnel`, `charts/Pareto`, and a `Line` `annotations` prop. Full specs: `screens.md` §1. Every number is an existing endpoint field; every insight is a `DrillLink`; score → failing rows ≤ 3 clicks; filters in URL; `DataTable` gains column chooser, multi-sort, saved views, export, density (wave 7).

### 8.3 Persona journeys (summary)

Programme lead: sign in → home heatmap cell (1) → object impact (2) → assign owner (3); weekly wave cockpit + sign-off in 2. Data steward: sign in → rank-1 batch (1) → record fix sheet (2) → bulk accept/approve (3). SAP Basis: sign in → degraded system (1) → Configuration › Drift row (2) → re-sync; Extract now in 1. Step-by-step with screen names: `screens.md` §2.

### 8.4 Per-route composition

`screens.md` §3 (3.1 Home … 3.14 Design) replaces the former §8 of this document and is the binding reference for waves 8–10 and 17. Coverage matrix and the gap screens it adds (Operations, Reports hub, MDM overview, Audit log with AI audit, Roles & access, Notifications, Jobs, Reference data, What-if, Rule drafts, DDIC dictionary, plus new tabs on Systems, Runs, Rule, Golden, Inbox, Fix batch and Wave): `screens.md` §4.

---
## 9. Report branding (PDF and Excel)

### 9.1 PDF (`templates/assets/report.css`, `templates/_base.html`, `templates/assets/brand/`)
- Fonts: add `InstrumentSans-400/500/600.woff2`, `InstrumentSerif-400.woff2` to `templates/assets/fonts/`; keep JetBrains Mono. `html { font-family: "Instrument Sans"; font-size: 9pt; }`.
- Variables: `--ink #141519; --ink-2 #4A4C55; --ink-3 #6F717B; --line #E4E2DB; --wash #FAF9F6; --accent #2B4BE0; --ok #157A3C; --warn #946200; --high #BA4A0B; --bad #B42318;` (print is always light).
- **Cover** (`.cover`): full-bleed left band 38mm in `--accent` → `#0F1430` vertical gradient (print-safe, two-stop) carrying the mark reversed (arc `#8DA3FF`, meridian `#EDEDF0`) at 20mm from top; right area on white: eyebrow 9pt 500 `--ink-3` ("Data quality assessment"), title 30pt Instrument Serif `--ink`, subtitle 11pt `--ink-2`, meta block (Run id mono, System, Generated, Prepared for tenant name — never a customer name in the template itself) as a 2-col definition list at the bottom, and a 0.6pt accent rule above it. A 48mm ScoreRing (same geometry, stroke 2.4mm) with the DQS and cap note sits in the right column when the report has a DQS.
- **Running header** (`@page` top-left/right): left = mark 5mm mono `--ink-3` + "Meridian" 7.5pt 500; right = report title 7.5pt `--ink-3`. A 0.3pt `--line` rule beneath.
- **Running footer**: left "Generated {date} · {run id in mono}", centre "Confidential — stays inside your network", right "Page X of Y" 7.5pt `--ink-3`.
- Section headings 13pt 600 with a 0.3pt `--line` rule; tables: head row `--wash` 8pt 500 `--ink-3`, 0.3pt `--line` row rules, numeric right-aligned tabular; severity cells colour+shape glyphs (■ ▲ ● ○ ✓) in the status colours.

### 9.2 Excel (`api/services/branded_xlsx.py`)
- Constants: `ACCENT = "2B4BE0"`, `_LINE = "E4E2DB"`, `_WASH = "FAF9F6"`, `_INK = "141519"`, `_INK3 = "6F717B"`, `_NAVY = "0F1430"`.
- **Cover sheet** "Cover": column A width 4 filled `_NAVY` rows 1–40 (the band); mark PNG (`templates/assets/brand/mark-light.png` regenerated from `logo-mark.svg` at 256px, reversed-on-navy variant `mark-dark.png`) anchored B2 at 64px; B5 title 20pt bold `_INK`; B6 subtitle 12pt `_INK3`; B8… meta rows label bold / value (mono "Consolas" for ids); "Sheets" list with hyperlinks; last row 8pt `_INK3` "Generated by Meridian · stays inside your network".
- **Data sheets**: header row fill `ACCENT`, white 11pt bold; freeze panes A2; autofilter; mono columns Consolas 10; status columns `fill_by_value` with soft tints `FCEBE9/FDEEE3/FBF1DB/E4F4EA` and ink `8E1B12/8F3908/6E4900/0F5C2D`; alternating row fill `_WASH`; column widths as today.
- Sheet tab colours: Cover `_NAVY`, data `ACCENT`.

---

## 10. Build order

Each wave is one implementer, one PR branch, `npm run lint:tokens`, `npm run lint`, `npm run typecheck` green at the end. No wave edits `lint-tokens.allow.txt`. Waves 5, 6, 7 can run in parallel after wave 1; 9 and 10 after 8; 13 and 17 can start after 1; 14–16 follow 13; 18 follows 7, 9, 10 and 17. Eighteen waves in total.

| # | Wave | Files touched | Acceptance checks |
|---|---|---|---|
| 1 | **Tokens, fonts, globals** | `design/tokens.css` (replace with §2), `design/tokens.ts` (§2.1), `app/globals.css` (§2.2), `app/layout.tsx` (§3 fonts), `DESIGN.md` (rewrite from §1–§3, §7), `public/brand/brand.json` | `lint:tokens` ok; every `--m-*` name used anywhere in `design/`, `app/`, `components/` resolves (grep `var(--m-` names against tokens.css: zero unresolved); `/design` renders in both themes; `document.fonts` lists Instrument Sans / Serif / JetBrains Mono; computed `font-variant-numeric` on body includes `tabular-nums`; contrast script (`scripts/check-contrast.mjs`, new, reads tokens.css) reports ≥4.5 for every ink/surface and status/soft pair listed in §2. |
| 2 | **Brand assets** | `app/icon.svg`, `app/apple-icon.png` (rasterised from `apple-icon.svg`), `app/opengraph-image.png` (from `og-image.svg`), `public/brand/mark-light.svg`, `public/brand/mark-dark.svg`, `public/brand/lockup-*.svg`, `scripts/brand-rasterise.mjs` (read two paths), `templates/assets/brand/mark-light.{svg,png}` + `mark-dark.png`, `components/meridian/icons.tsx` (`MeridianMark` two-tone/mono), `app/layout.tsx` metadata (icons, OG) | Favicon legible at 16px in a browser tab (screenshot); `npm run brand:rasterise` succeeds; `MeridianMark` has no `"tile"` variant and no remaining call sites; OG image validates at 1200×630; Rail/AuthFrame still compile. |
| 3 | **Shell** | `design/shell/Rail.tsx`, `TopBar.tsx`, `Breadcrumb.tsx`, `RunSelector.tsx`, `CommandPalette.tsx`, `JobTray.tsx`, `Toaster.tsx`, `components/theme-toggle.tsx`, new `components/user-menu.tsx`, `app/(app)/layout.tsx`, `app/(app)/loading.tsx` | Rail 240/56 toggles with `[` and persists; active row shows accent bar + soft bg; top hairline present and animates while a job runs, static otherwise; top bar is glass (computed `backdrop-filter` non-none) in both themes; ⌘K opens palette with groups/footer; user menu contains theme segmented control and sign out; existing Rail tests pass; no `shadow-*` Tailwind classes remain in `design/shell`. |
| 4 | **Auth pages** | `components/auth/auth-frame.tsx`, `app/sign-in/[[...sign-in]]/page.tsx`, `app/sign-up/**`, `app/forgot-password/page.tsx`, `app/reset-password/**`, `app/accept-invite/**`, `app/licence-error/page.tsx`, tokens.css (add `--m-brand-*` four tokens) | Brand panel renders gradient + 320 ring that draws on mount and is static under reduced motion; form card 400w with serif h1; all six pages screenshot light/dark at 1440 and 390 widths; password eye toggle has `aria-pressed`; `lint:tokens` ok (no literals in auth-frame). |
| 5 | **Primitives A: controls** | `design/primitives/Button.tsx`, `IconButton.tsx`, `Field.tsx`, `Select.tsx`, `Combobox.tsx`, `Pill.tsx`, `Badge.tsx`, `Tabs.tsx`, `Tooltip.tsx`, `Menu.tsx`, `Mono.tsx`, new `Card.tsx`, `design/index.ts` (export `Card`) | `/design` shows every variant × size × state; Tabs indicator slides; Pill tones render soft fill + dot; all existing props still accepted (typecheck across app); `Card` exported. |
| 6 | **Primitives B: readings and charts** | `Stat.tsx`, `ScoreRing.tsx`, `Counter.tsx`, `Delta.tsx`, `SeverityDot.tsx`, `Skeleton.tsx`, `EmptyState.tsx` (+ `ring`, `stepper` ghosts), `ErrorState.tsx`, `Dialog.tsx`, `Drawer.tsx`, `design/charts/theme.ts`, `Line.tsx`, `Bar.tsx`, `Waterfall.tsx`, `Radar.tsx`, `Heatmap.tsx`, `Sparkline.tsx`, `Graph.tsx`, new `charts/Tooltip.tsx` | ScoreRing 24/48/96/160 render; `cap` shows tick + ghost arc + label; draw animation zero under reduced motion; Stat renders as tile and accepts legacy `delta` strings; Drawer floats inset at ≥lg; charts use custom tooltip; no raw colours (`lint:tokens`). |
| 7 | **Table and drawers** | `design/table/DataTable.tsx`, `Pager.tsx`, `BulkBar.tsx`, `design/templates/FindingDrawer.tsx` | Header 36h wash, rows 36h, hover/selected states, numeric right-aligned, Mono ids; BulkBar floats; virtualised branch (>2000 rows) unaffected (existing test); FindingDrawer uses new Drawer header subtitle for check ID. |
| 8 | **Templates and home** | `design/templates/HomePage.tsx`, `GhostPanel.tsx`, `JourneyStepper.tsx`, `ExplorerPage.tsx`, `ReportPage.tsx`, `RecordPage.tsx`, `app/(app)/home/_persona-home.tsx`, `home/*/page.tsx` | Home shows serif verdict, ScoreRing 160 with cap, Line+Bar grid, heatmap card; fresh-install home shows stepper card + ghost ring; three personas screenshot light/dark; `ExplorerPage`/`ReportPage` loading and empty states match §7.15–7.16. |
| 9 | **Routes A** | `app/(app)/systems/**`, `objects/**`, `runs/**`, `rules/**`, `search/page.tsx`, `import/page.tsx`, `migration/**` | Each route in §8.2–8.5, 8.10, 8.12, 8.13 has hero, empty and loading per spec; every number cell is a DrillLink; no literal colours/shadows introduced; e2e smoke for empty states (`e2e/empty-states.spec.ts`, new) passes against a fresh DB. |
| 10 | **Routes B** | `app/(app)/insights/**`, `mdm/**`, `inbox/page.tsx`, `fix/**`, `admin/**`, `design/page.tsx` | §8.6–8.9, 8.11, 8.14; `Banner` usages in insights replaced with the notice pattern; `/design` gallery complete and is the review surface; same e2e smoke. |
| 11 | **Report branding** | `templates/assets/report.css`, `templates/_base.html`, `templates/assets/fonts/*`, `templates/assets/brand/*`, `api/services/branded_xlsx.py`, `api/services/pdf_reports.py` (cover variables) | Each PDF template renders with new cover/header/footer (WeasyPrint snapshot of first page); XLSX cover sheet has band, mark, meta, hyperlinks; data sheets have accent header, wash alternation, status tints; existing export tests pass. |
| 12 | **QA and accessibility** | `scripts/check-contrast.mjs`, `e2e/visual.spec.ts` (new: screenshots of every route light/dark/reduced-motion), `DESIGN.md` final | All routes pass axe (no colour-contrast violations); reduced-motion run shows zero animations (computed `animation-name: none`); `lint:tokens`, `lint`, `typecheck`, unit, e2e green; `lint-tokens.allow.txt` unchanged (two comment lines). |
| 13 | **RBAC backend** | `api/services/rbac.py`, `db/schema.py` (+4 models), `db/migrations/versions/044_rbac_scopes.py`, `api/routes/roles.py`, `api/routes/me.py` (`/me/permissions`), `api/routes/users.py`, `api/routes/auth.py`, `tests/test_rbac_legacy_snapshot.py`, `tests/test_rbac_scopes.py` | `rbac.md` §6 wave 13: legacy (role, action) snapshot unchanged; existing rbac tests untouched and green; `/me/permissions` shape per `rbac.md` §3.3; scoped deny works; backfill idempotent. |
| 14 | **RBAC scope rollout + migration** | ten route modules named in `rbac.md` §3.2, `scope_from_path`, JSONB object-approval conversion endpoint | `rbac.md` §6 wave 14. |
| 15 | **Admin › Roles & access UI** | `app/(app)/admin/roles/**`, `lib/api/roles.ts`, `lib/api/me.ts`, `components/admin/role-matrix.tsx`, `grants-picker.tsx`, `effective-permissions.tsx`, invite Drawer, accept-invite grants preview | `rbac.md` §6 wave 15. |
| 16 | **Persona gating + request access** | `lib/nav.ts` (`requires`), `design/shell/Rail.tsx`, `lib/permissions.tsx` (`usePermissions`, `<Can>`), page action bars, `components/request-access-dialog.tsx`, 403 handler in `lib/api/client.ts`, `RunSelector` scope filter | `rbac.md` §6 wave 16. |
| 17 | **Insight layer** | `design/templates/InsightHeader.tsx`, `NextActions.tsx`, `design/primitives/AiSummary.tsx`, `ScoreExplainer.tsx`, `design/charts/Funnel.tsx`, `Pareto.tsx`, `Line.tsx` (`annotations`), `lib/palette-grammar.ts` (+ unit test), `design/shell/CommandPalette.tsx`, `lib/api/analytics.ts`, `lib/api/simulation.ts`, `design/index.ts`, every `(app)` page (header slot) | Every route renders `InsightHeader` with real endpoint fields and designed fresh-install sentences (e2e against empty DB); `AiSummary` shows deterministic fallback when `health/llm` is not ok; `ScoreExplainer` on every Counter/ScoreRing ≥ 48 and score cells; score → failing rows in ≤ 3 clicks (e2e click count per persona journey in `screens.md` §2); palette parses the eight grammar examples in the test; `lint:tokens` green. |
| 18 | **Gap screens and detail depth** | `app/(app)/insights/operations`, `insights/reports`, `mdm/page.tsx`, `mdm/survivorship`, `admin/audit`, `admin/notifications`, `admin/jobs`, `admin/reference`, `fix/what-if`, `rules/drafts`, `rules/dictionary`, new tabs on `systems/[systemId]`, `runs/[versionId]`, `rules/[ruleId]`, `mdm/golden/[id]`, `inbox`, `fix/[batchId]`, `migration/[waveId]`; `design/table/DataTable.tsx` (column chooser, saved views, export, density); `lib/nav.ts`; backend: `GET/PUT /survivorship-rules`, `GET /audit/llm` | Coverage matrix in `screens.md` §4 has no remaining GAP row (checked by reading each route in e2e smoke); every DataTable exposes views/columns/export/density; every detail page has Overview/Related/History/Audit/Export tabs; no string "coming soon" in `app/` (grep). |

Renames: **none**. Additions to `@/design`: `Card` (wave 5), `charts/Tooltip` (internal, not exported), `mElev`, `dqsBand` (tokens.ts); wave 17 adds `InsightHeader`, `NextActions`, `AiSummary`, `ScoreExplainer`, `Funnel`, `Pareto` and a `Line.annotations` prop (additive, no signature change). Wave 16 adds `lib/permissions.tsx` (`usePermissions`, `Can`). Deleted: `MeridianMark variant="tile"` (wave 2). New dependencies: **none**.
