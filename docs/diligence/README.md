# Technical diligence package

The technical description of Meridian for an acquirer's engineering, security and legal reviewers.
Every number in these documents was measured in this repository at commit `5cf7161c` (branch
`m2-complete`, equal to `origin/main` at release v0.0.536; the describe command in this clone prints
`v0.0.511-25` because the later tags were not fetched) on 2026-10-30, and every one can be
reproduced with a command named next to it or below. Where a promise in older documents is not backed by
code, these documents say so.

## Documents

| Document | Answers |
|---|---|
| [architecture.md](architecture.md) | What the components are, how data flows, how tenants are isolated, how the check engine and scoring work, where the model is and is not used, the SAP connectors, the control plane, and the frontend (map, canvas, inspector, tokens, i18n, fixture mode). |
| [security.md](security.md) | The threat model (STRIDE), authentication, authorisation and the route guard test, row-level security on every table (with the table list), secrets, encryption, input hardening, rate limiting, audit coverage, the error handler, dependency scanning, SBOMs, and every finding with its disposition. |
| [licences.md](licences.md) | Every third-party licence grouped by family, the decision on each copyleft or unusual one, the product's own licence, and whether the IP-protection build does what the documentation claims. |
| [quality.md](quality.md) | How many tests exist at each layer, what CI runs on every PR, measured coverage, type safety, lint gates, end-to-end and accessibility evidence, performance evidence. |
| [operations.md](operations.md) | Deployment, upgrade and migration, backup and restore, RPO and RTO, monitoring, retention, scaling, the licence worker's failure behaviour, the support model. |
| [data-governance.md](data-governance.md) | What data is stored and where, what leaves the deployment, retention and deletion, GDPR-relevant processing, policy packs, sandbox mode, the audit trail. |
| [roadmap-and-debt.md](roadmap-and-debt.md) | The technical debt register (35 items with location, expected behaviour, effort, risk) and what the architecture allows next. |
| [competitive-position.md](competitive-position.md) | A capability comparison with Informatica, Collibra, Ataccama, SAP MDG, Monte Carlo and Soda, each Meridian claim tied to a route or screen. |
| [demo-script.md](demo-script.md) | A 30-minute buyer demo by role on fixture-mode URLs, and a 10-minute technical deep dive with commands. |

Supporting material:

- `sbom/python.cdx.json`, `sbom/frontend.cdx.json`: CycloneDX SBOMs (checked for drift in CI).
- `generated/`: the raw outputs of the audit run (counts, scanner JSON, licence tables, coverage, the
  Playwright list, the source-strip reproduction). Do not edit by hand.
- Repository root: `LICENSE`, `SECURITY.md`, `THIRD_PARTY_NOTICES.md`.
- Older material these documents build on: `docs/ARCHITECTURE.md`, `docs/security/`,
  `docs/accessibility/`, `docs/ops/`, `docs/legal/` (templates awaiting counsel).

## Reproducing the figures

```bash
# fast (about 5 minutes): counts, pip-audit, npm audit, SBOMs, licence tables, notices
bash scripts/diligence_audit.sh

# full (about 30 minutes on 4 cores): adds pytest collection, live RLS, OpenAPI operations,
# pytest coverage on the fast unit set, Vitest coverage, the Playwright list
export MERIDIAN_TEST_DB_URL=postgresql://user@host/throwaway_db   # Postgres 16; tests migrate it
(cd frontend && npm ci)
bash scripts/diligence_audit.sh --full
```

| Figure | Value | Source |
|---|---|---|
| Rules | 8,380 (5,623 hand-written and enabled, 2,757 DDIC-generated and shipped disabled), 47 modules, 21 check classes | `scripts/diligence_counts.py` |
| API | 693 operations on 594 paths; 125 route modules; 120 routers registered | `--openapi`, `api/main.py` |
| Migrations | 114 files, head `116` | `db/migrations/versions/` |
| Row-level security | 153 of 153 tenant tables enabled, 152 forced; 156 tables with RLS in total | `--rls` |
| Roles and permissions | 14 roles, 26 actions | `api/services/rbac.py` |
| Beat schedule | 31 entries | `workers/scheduler.py` |
| Python tests | 505 files, 18,292 collected (4 opt-in performance tests deselected by default), 89 Postgres files | `--collect` |
| Frontend unit tests | 121 Vitest files, 1,264 tests; coverage 83.67% lines, 82.03% statements, 78.03% functions, 74.5% branches | `vitest --coverage` |
| End-to-end | 17 Playwright spec files in the chromium project, 398 tests (370 run in CI) | `playwright test --list` |
| Translations | 4,074 keys used, 4,231 in the catalogue, 0 untranslated, 0 missing, 0 gaps | `node frontend/scripts/i18n-extract.mjs` |
| Python advisories | 0 in 134 locked packages | `pip-audit -r requirements.lock` |
| npm advisories, runtime | 0 frontend; 1 moderate in `cloudflare/portal` | `npm audit --omit=dev` |
| Licences | 0 strong copyleft inside our images; 4 weak-copyleft Python packages, 14 LGPL optional sharp binaries, 1 CC-BY data package; Garage (AGPL) as a separate container | `scripts/diligence_licences.py` |

## The five things a reviewer should read first

1. **The API image keeps its Python source** (security.md F-1, roadmap D-01): the strip step in
   `docker/Dockerfile.api.prod` is a silent no-op. The IP-protection claim does not hold for that image
   today; the fix is small.
2. **The HTTPS block in nginx is never enabled by the installer** (D-11): a default install serves HTTP
   unless the operator adds TLS.
3. **Tenant isolation is enforced by Postgres**, not only by application code, and is tested both
   statically and against a live database (security.md section 5).
4. **Every number is deterministic**; the model writes prose around aggregates, and the product runs with
   no model at all. Two optional helpers do send redacted sample values to a configured model (security.md
   section 9).
5. **A licence worker outage blocks connected installs after 2 to 8 hours** (operations.md section 8,
   D-25).

## Method and limits

- Measured on Linux with Python 3.13 for the tooling and Postgres 16; CI and the images use Python 3.12.
  The dependency set measured is `requirements.lock`, which is what CI and the images install.
- Two Vitest tests failed in the full coverage run while the machine was shared with other builds and
  passed when run alone; both assert wall-clock budgets (D-28). Coverage figures come from that run.
- No Docker daemon was available, so the image findings were reproduced on the exact shell commands of
  the Dockerfiles with the same `find` version (findutils 4.9.0) rather than by building the images.
- Competitor cells in competitive-position.md come from desk research, not product trials.
