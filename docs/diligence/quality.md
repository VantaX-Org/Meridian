# Quality

What is tested, what CI enforces on every change, and what was measured for this package. Measured at
commit `5cf7161c` on 2026-10-30; commands in [README.md](README.md) and below.

**Update, 30 October 2026.** A buyer's critique read this document as overstating test credibility; the
points it raised are answered in place below. Fixes named by commit hash are on the backend remediation
line and are not yet merged into the branch this package describes. "Being fixed (October 2026)" means
work is under way and could not be verified here.

What the numbers do and do not show:

- 10,109 of the 18,292 Python test items (55%) are generated per-rule proofs and 1,955 are rule-schema
  checks. They show every rule discriminates on synthetic records; they do not show SAP semantic
  correctness on real data.
- Every Playwright spec runs in fixture mode with the API stubbed, so the end-to-end layer tests the
  screens, not the engine; no test checks the fixtures against the API (DR-1).
- At least 17 test files assert on source text rather than calling the code; one of them passed while the
  function it guarded raised `NameError` (D-35, PC-9).

## 1. Test inventory

| Layer | Files | Tests | Command |
|---|---|---|---|
| Python, all | 505 `test_*.py` | 18,292 collected (18,288 run by default; 4 performance tests are opt-in with `-m perf`) | `pytest tests/ --collect-only -q` |
| ...rule proofs (`tests/checks/test_rule_proofs.py`) | 1 | 10,109: one proof per shipped rule, passing and failing fixtures | |
| ...rule integrity (`tests/checks/test_rule_integrity.py`) | 1 | 1,955: schema, fields, dimensions and severities of every rule | |
| ...other check-engine tests (`tests/checks/`) | | 882 | |
| ...against a live Postgres (`*_pg.py`) | 89 | 445 items in the collected set run against Postgres with RLS; they skip without `MERIDIAN_TEST_DB_URL` | |
| ...agents, services, SAP connectors, db, workers, golden, process discovery | | 42, 55, 65, 8, 10, 35, 132 | |
| ...top-level API, route and service tests | | 4,995 | |
| Frontend unit and component (Vitest, jsdom) | 121 | 1,264 | `cd frontend && npx vitest run` |
| End-to-end (Playwright, Chromium) | 17 spec files in the `chromium` project | 398 | `npx playwright test --list` |
| Help recordings (Playwright, `recording` project) | 1 (`e2e/guided-tours-v2.spec.ts`) | the guided tours | `record-help-videos.yml`, manual |
| Shell | 1 (`tests/test_update_script.sh`) | update script structure | |
| Load test | `scripts/loadtest_v2.py` with `scripts/seed_loadtest.py` | 6 read endpoints, N users | manual |

Python test code is 81,662 lines; test items per directory are in `docs/diligence/generated/counts.json`
after `--full`.

## 2. What CI runs

From `.github/workflows/` (read in full for this document):

| Workflow | Trigger | What it gates |
|---|---|---|
| `unit-tests.yml` | every PR, push to main | requirements lock consistency; `python -m checks.rule_reconciler --strict` (every rule reconciles with the SAP field dictionary); `scripts/generate_ddic_rules.py --check` (generated rules current); `tests/test_update_script.sh`; collection; the whole pytest suite in 6 shards against Postgres 16 and Redis 7 |
| `aurora-e2e.yml` | push to main, PRs touching `frontend/` | `tsc --noEmit`; ESLint with `--max-warnings 0`; Vitest with coverage thresholds; `lint:tokens`; the i18n gate; `check:contrast`; then 16 Playwright specs against the production build in 4 shards (370 tests) |
| `rls-tests.yml` | PRs touching migrations, schema, tenancy, purge and several services | `tests/test_rls_integration.py` and three RLS-sensitive Postgres suites |
| `perf-400k.yml` | weekly, PRs touching the engine | `tests/checks/test_perf_400k.py` |
| `deploy-smoke.yml` | PRs touching the installer, backup, restore, `docker/`, migrations | builds the images and runs `meridian-deploy.sh` on a clean Ubuntu runner |
| `security-scan.yml` | PRs touching manifests, weekly | pip-audit (requirements.txt), npm audit |
| `dependency-audit.yml` (new) | PRs touching manifests or SBOMs, push to main, weekly | pip-audit on `requirements.lock`, npm audit `--omit=dev` failing on high or critical, SBOM drift |
| `image-scan.yml` | PRs touching Dockerfiles or manifests, push to main, weekly | Trivy on the five production images, high or critical |
| `build-and-deploy.yml` | push to main (not docs-only) | builds and pushes the images |
| `record-help-videos.yml` | manual | records the help videos |

Gaps:

- `e2e/v2-step10.spec.ts` (28 tests: policy packs, digests, sandbox, record history) is not in the CI spec
  list (D-06). Fixed in commit `47f53c3a` (added to `SPECS` in `aurora-e2e.yml`); not yet merged here.
- No Python lint or type-check step (D-29, PC-10). The ruff E9 and F errors, including the two undefined
  names, were cleared in commit `6fdf345f`; a `ruff check` gate in CI is being added (October 2026). No
  type checker gate exists or is yet committed.
- No full-stack end-to-end test in CI. A live-stack acceptance spec (`frontend/e2e/acceptance.spec.ts`,
  commit `d49301fd`) exists and is skipped unless `ACCEPTANCE_BASE_URL` is set.

## 3. Coverage (measured once for this package)

| Suite | Lines | Statements | Functions | Branches |
|---|---|---|---|---|
| Vitest, `app`, `components`, `design`, `hooks`, `lib`, `context` | 83.67% (13,189 of 15,762) | 82.03% | 78.03% | 74.50% |
| pytest, fast unit set (below), statements of `api`, `workers`, `checks`, `agents`, `sap`, `llm`, `db` | 16.8% (10,330 of 61,315) | | | not measured |

- Vitest: `npx vitest run --coverage --coverage.reportOnFailure` (v8 provider). CI enforces floors of
  lines 60, functions 46, branches 50, statements 56 (`frontend/vitest.config.ts`); the measured figures
  are well above them. 1,262 of 1,264 tests passed in that run; the two failures assert wall-clock
  budgets and passed when re-run alone (D-28). Output: `docs/diligence/generated/vitest-coverage.txt`.
- pytest: the fast unit set is the directory suites `tests/agents tests/services tests/workers tests/db
  tests/golden tests/process_discovery` without `*_pg.py` files: 273 tests, all passed, 8 min 40 s with
  coverage. By package: `db` 66.9%, `agents` 63.0%, `checks` 50.1%, `llm` 25.1%, `workers` 18.6%, `sap`
  18.4%, `api` 8.9%. The low `api` figure is a property of the subset, not of the suite: the API's route
  and service tests are the 4,995 top-level tests and the 89 Postgres files, which this set leaves out.
  It is a floor, not an estimate of whole-suite coverage. Output:
  `docs/diligence/generated/pytest-coverage.txt` and `.json`.
- Not measured: whole-suite Python coverage (PC-8). Adding coverage to the CI shards and publishing a
  floor is being fixed (October 2026); until a measured figure is published here, treat 16.8% as the only
  measured Python number, on a subset. The full suite takes about 70 minutes of CI time across six
  shards; with coverage it did not fit this review on a shared 4-core host. To measure it, add
  `--cov=api --cov=workers --cov=checks --cov=agents --cov=sap --cov=llm --cov=db` to each shard in
  `unit-tests.yml` and combine the `.coverage` files with `coverage combine`.

## 4. Type safety

- TypeScript: `strict: true` in `frontend/tsconfig.json`; `npx tsc --noEmit` exits 0. `any` appears twice
  in application code (`grep -rc ": any\b\|as any\b" app design lib context hooks`).
- Python: type hints are the standard (`CLAUDE.md`), Pydantic models on request and response bodies, but
  no type checker (mypy or pyright) runs in CI. A scan with the default ruff rules
  (`ruff check --isolated --select E4,E7,E9,F api workers checks agents sap llm db`) finds 161 issues,
  including 4 undefined names: 3 are string annotations, and one is a real defect, `Session` in
  `api/routes/system_objects.py:153` (D-35). Fixed on the remediation line: the import in commit
  `6fdf345f`, and `tests/test_catalogue_stale_serve.py` now runs the rebuild instead of reading its source
  (commit `a28f5517`).

## 5. Lint gates

| Gate | Command | Status today |
|---|---|---|
| ESLint (Next, TypeScript, React hooks, the house writing and structure rules, no third-party icon libraries, no inline style in `app/`) | `npm run lint` (`--max-warnings 0`) | exit 0; some rule globs are stale (D-04) |
| Design tokens | `npm run lint:tokens` | "ok (0 warnings) (0 legacy files allowlisted)"; the allow-list holds only its header |
| Translations | `node scripts/i18n-extract.mjs` | 4,074 keys used, 4,231 in catalogue, 0 untranslated, 0 missing, 0 gaps |
| Colour contrast | `npm run check:contrast` | in CI |
| No middle dot (U+00B7) under `frontend/` | `pytest tests/test_no_middle_dot.py` | 2 passed. It scans frontend source only; the API put the character into the receipt formula on screen, fixed in commit `f905081b` (not yet merged here) |
| Rules reconcile with the SAP dictionary | `python -m checks.rule_reconciler --strict` | in CI |
| Python lint | none in CI | D-29: errors cleared in `6fdf345f`; a CI gate is being added (October 2026) |

## 6. End-to-end and accessibility evidence

- 398 Playwright tests in 17 specs cover every screen in fixture mode (API stubbed, DR-1) at 1440 and
  390 px, light and dark:
  landscape (20), object (34), rules (16), work (20), people (32), runs (36), systems (24), MDM (21),
  admin (24), status (16), help (12), roles (7), step 9 (36), step 10 (28), accessibility (24), sign-in
  states (7) and the redirects of every retired address (41). The list is
  `docs/diligence/generated/playwright-list.txt`.
- Accessibility: axe-core on 30 page states in three languages and two themes, keyboard-only journeys,
  200% zoom and 320 px reflow, reduced motion, contrast arithmetic. Report:
  [docs/accessibility/audit-2026-10.md](../accessibility/audit-2026-10.md); conformance report
  [docs/accessibility/VPAT-2.5-meridian-2.md](../accessibility/VPAT-2.5-meridian-2.md). Not done: a
  screen-reader session and testing with disabled users (stated in the audit).

## 7. Performance evidence

| Evidence | Result | Where |
|---|---|---|
| Check engine, 400,000 vendor rows | realistic rule mix inside a 60 s budget with exact injected-defect counts and grain-correct totals | `tests/checks/test_perf_400k.py`, weekly in `perf-400k.yml` |
| v2 read endpoints, 400,000 work records, 50 users, 120 s, 3 API processes on a shared host at load 8 to 12 | p50 / p95 / p99 ms after pre-aggregation: landscape 458 / 1,044 / 1,935; work summary 443 / 1,001 / 2,347; object receipt 647 / 1,382 / 2,450; people 686 / 1,451 / 3,018; runs timeline 514 / 1,171 / 2,963; work records 690 / 1,433 / 2,887. Throughput 19 to 68 requests/s; every endpoint under the 1.5 s p95 threshold. Before: p95 3,234 to 5,329 ms. | commit `9c94b9ea` message; method `scripts/loadtest_v2.py`, data `scripts/seed_loadtest.py` |
| Idle, uncached | landscape 155 to 179 ms before, 23 ms after; landscape open-work query 180.7 ms to 0.33 ms (`EXPLAIN ANALYZE`) | same commit |
| Full analyses on a pilot sandbox (8 cores, 30 GB) | SuccessFactors 9 objects: lifecycle step about 2 minutes; ECC 4 objects: checks in about 14 minutes, then the issue lifecycle hit the 6 h limit at 2.78 million issues; reworked into batches on 2026-10-24, not re-measured since | `docs/analysis-throughput.md`, D-24 |

The load-test results live in a commit message, not in a results file; a buyer who wants them as an
artefact should run `scripts/loadtest_v2.py` against a database seeded by `scripts/seed_loadtest.py` and keep
its table and JSON summary with the release; it exits 1 when any p95 is above `--p95-ms` (default 1,500).
