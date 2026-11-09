# Test strategy and report

## Strategy

Meridian is tested in layers. Each layer catches a different kind of fault. Every pull request to main runs the CI workflows below. A screen is tested before work moves to the next screen, and its tests are committed with it.

| Layer | Tool | What it proves |
|---|---|---|
| Unit and service | pytest | Rules, services, routes, SAP connectors and workers behave as written |
| Database and row-level security | pytest against PostgreSQL | Tenant isolation and queries that need a real database |
| Frontend unit | vitest | Screens and components render and behave as written |
| End to end | Playwright | Screens work together in a browser, including accessibility checks |
| Full stack | Playwright against a seeded stack | The acceptance journeys work with a real API and database |
| Visual regression | Playwright screenshots | Screens do not change by accident |
| Supply chain and images | pip-audit, CycloneDX, Trivy | Dependencies and images have no known critical faults |
| Signed-in acceptance | Manual run by a tester | The release works on the customer deployment with real data |

## Test counts

Counts were taken on 9 November 2026 by listing files in the repository.

| Layer | Count | Where |
|---|---|---|
| pytest files | 635 `test_*.py` files | `tests/` and its subfolders (agents, checks, db, fixtures, golden, process_discovery, sap, services, workers) |
| pytest functions | About 4,498 `def test_` functions. Parametrised cases are not counted. | `tests/` |
| Shell test | 1 | `tests/test_update_script.sh` |
| vitest files | 209 `*.test.ts` and `*.test.tsx` files | `frontend/`, and `cloudflare/licence-worker/src/index.test.ts` |
| Playwright specs | 20 `*.spec.ts` files | `frontend/e2e/` |
| Visual regression baselines | 582 PNG files | `frontend/e2e/__screenshots__/` |

The Playwright specs are: acceptance, guided-tours-v2, v2-a11y, v2-admin, v2-help, v2-journeys, v2-landscape, v2-mdm, v2-object, v2-people, v2-roles, v2-rules, v2-runs, v2-status, v2-step9, v2-step10, v2-systems, v2-work, redirects and sign-in-states.

How to refresh baselines is in [docs/ops/vr-baselines.md](../ops/vr-baselines.md). How to run the tests is in [docs/testing-guide.md](../testing-guide.md).

## CI workflows

All workflows are in `.github/workflows/`.

| Workflow | Runs on | What it runs |
|---|---|---|
| unit-tests.yml | Pull request and push to main | ruff, the mypy ratchet, pytest in 10 shards, the requirements lock test and `checks.rule_reconciler --strict` |
| aurora-e2e.yml | Push and pull request | Typecheck, lint, vitest with coverage, token lint, i18n extract, contrast check and Playwright in 4 shards |
| fullstack-e2e.yml | Pull request and push to main | Seeds a full stack with `ci_fullstack_seed.py`, then runs the acceptance spec |
| rls-tests.yml | Pull request and push to main | Row-level security and PostgreSQL tests |
| deploy-smoke.yml | Pull request | Deployment smoke test |
| rollback-schema.yml | Pull request and push to main | `check_rollback_schema.sh` |
| dependency-audit.yml | Pull request, push to main and schedule | pip-audit and CycloneDX |
| security-scan.yml | Pull request and schedule | Security scans |
| image-scan.yml | Pull request, push to main and schedule | Trivy image scan |
| perf-400k.yml | Schedule, manual and pull request | Performance check at 400,000 rows |
| record-help-videos.yml | Manual | Records the guided tour videos |
| build-and-deploy.yml | Push to main and manual | Builds and tags the release |

## Tests added in this release

- `tests/test_aletheia_engine.py`
- `tests/test_workbook_learned_fields.py`
- `frontend/design/v2/__tests__/AletheiaEngine.test.tsx`
- `frontend/design/v2/__tests__/table-spec.test.ts`

Tests changed in this release: `tests/test_update_script.py`, `test_migration_workbook.py` and `test_sf_workbook_entities.py`.

## Current state

- Commit 212edf03d fixed the axe `scrollable-region-focusable` failures in the Aurora E2E shards at 390 pixels wide.
- Commit 6f3686569 fixed a mypy error in the Employee Central rule sidecar.
- The CI result for PR #639: To confirm (Release manager). It could not be read when this report was written.
- The signed-in go-live acceptance run in [docs/journeys/go-live-acceptance-test.md](../journeys/go-live-acceptance-test.md) was done by the customer team on the customer deployment on 9 November 2026, and reported complete. Load-tool validation against real import templates (section 4) stays open as RAID R-01.
- The migration workbook fill was checked against the customer's real Employee and Foundation workbooks. Employee: 21 sheets, 19 filled, 372 of 547 columns matched, 2 mandatory columns unmatched (Pay Component). Foundation: 42 sheets, 40 filled, 729 of 800 columns matched, every mandatory column matched.

## Report sign-off

| Role | Result | Date |
|---|---|---|
| Test lead | To confirm | To confirm |
| Engineering lead | To confirm | To confirm |
| Product owner | To confirm | To confirm |
