# Meridian design system

Source of truth for the visual layer. Values live in `frontend/ui/tokens.css`, the only file of the interface that may
hold raw colour, shadow and motion. Every other file reads `var(--mx-*)`; `npm run lint:tokens` rejects raw hex,
gradients, blur, ad hoc shadows and motion literals elsewhere, and `scripts/lint-tokens.allow.txt` stays empty.

## Direction

Design C, "Split analyst": a master list on the left, the detail of what is selected on the right, one place to act.
The shell is a top bar with five sections (Home, Work, Load, Runs, More), the Aletheia chat in a panel beside the
content, and sheets for anything that is a task rather than a place. Light is the default; dark applies when
`html[data-theme="dark"]` or when the system is dark and the person chose nothing.

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
- **Type**: IBM Plex Sans for UI and numerals, IBM Plex Mono for SAP identifiers only, self-hosted from `app/_fonts`
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

## Keyboard

`Cmd` or `Ctrl` plus `K` opens the command palette. `g` then a letter jumps: `h` Home, `w` Work, `l` Load, `r` Runs,
`m` More, `u` Rules, `c` MDM, `k` Insights.
