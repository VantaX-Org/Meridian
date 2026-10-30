# Meridian frontend

Next.js (App Router, TypeScript strict). The interface is one map, one canvas and one inspector: there is no menu of
pages. Read `docs/guide/overview.md` first, then `DESIGN.md`.

- **The map** (left): Landscape, Work, Runs and People, then each connected system with its objects, every row with
  its score and the records to fix.
- **The canvas** (middle): the place chosen on the map. The landscape at `/`, an object at `/o/{system}/{object}` with
  its tabs (rules, records, fixes, runs, readiness, processes, lineage, glossary, golden records), a rule at `/r/{id}`,
  the Work ledger at `/work`, a run at `/run/{id}` and two runs at `/run/{a}/vs/{b}`, a system at `/s/{id}`, People,
  Reports, the rules library at `/rules` and Administration at `/admin/{section}`.
- **The inspector** (right): whatever is selected, in the address as `?open=kind:id` (a record, a rule, a run, a job,
  a batch, a person, a system, and the panels: inbox, help, preferences, waves, triage). `Esc` closes it.

The signed-out pages (`/sign-in`, `/forgot-password`, `/reset-password`, `/accept-invite`, `/licence-error`) and the
status page (`/status`) stand without the shell. Every address of the interface retired at the cut-over redirects to
its new place (`next.config.ts`, table in `docs/guide/redirects.md`).

## Where things are

| | |
|---|---|
| `app/(v2)/` | the routes of the shell; `app/(auth)/` the signed-out pages; `app/(v2status)/` the status page |
| `design/v2/` | the shell, the screens, the inspector panels and their CSS over `design/v2/tokens.css` |
| `lib/v2/` | pure logic, queries, the i18n catalogues (`lib/v2/i18n`, English, German, Japanese) and help |
| `lib/api/v2/` | typed API clients; `?fixture=1` answers every read from `lib/api/v2/fixtures` without a backend |
| `docs/guide/` | the guide: chapters, tours, what's new; `docs/help-videos/` its recordings |
| `e2e/` | Playwright: every screen in fixture mode with axe, the sign-in states and the redirects |

## Commands

```bash
npm run dev                      # http://localhost:3000; add ?fixture=1 to any page to run without an API
npx tsc --noEmit -p .            # types
npm run lint                     # eslint, no warnings
npm run lint:tokens              # no raw colours, gradients, blur or motion literals outside the token files
node scripts/i18n-extract.mjs    # every visible string translated in en, de and ja
npm test                         # vitest
npm run build && npm run start:standalone
npx playwright test              # against PLAYWRIGHT_BASE_URL or a dev server
npm run guide:pdf                # the printable guide
```
