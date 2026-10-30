# Demo script

A 30-minute product demo by role, a live demo against a running API, and a 10-minute technical deep dive.

**Read this first: Part 1 runs on fixture data, not on the product's engine.** Fixture mode (`?fixture=1`)
makes the frontend answer every read from static files in `frontend/lib/api/v2/fixtures` and never call the
API. No backend, SAP system, check engine or licence is involved. Every number in Part 1 is a fixture: the
systems, extraction dates and record counts, every score (71.8 measured, 70 capped), the verdicts, the rule
and record counts, "25,712 records to fix", the money at risk, the batches and approvals, the run
comparison and the connection errors. They were written by hand to exercise the screens, and the
end-to-end specs (`frontend/e2e/*.spec.ts`) assert them, so a passing spec proves the screens render these
values, not that the engine would produce them. In the walkthrough, say so before the first screen.

What a buyer should know about the fixtures (logged as DR-1 in [roadmap-and-debt.md](roadmap-and-debt.md)):

- No test checks the fixtures against the API. Some fixture module ids are not ids the engine emits
  (`purchasing`, `gl_accounts`, `vendor_master`, `customer_master`, `sales_orders` in
  `frontend/lib/api/v2/fixtures/landscape.json`, where the engine uses `mm_purchasing`, `fi_gl`,
  `accounts_payable`, `accounts_receivable`, `sd_sales_orders`).
- The rules library fixture holds a handful of rules, not the 8,380 the engine ships; the status strip's
  "5,178 rules measured" is a fixture figure.
- Fixture mode is in the production bundle and nothing on screen says the data is a demo (PC-4).
- Some fixture screens contradict each other (SuccessFactors "Not extracted yet" beside failing Employee
  Central rules).

To see the engine produce numbers, use the live demo below; its figures are whatever the engine computes
from the uploaded data.

## Setup (5 minutes, before the meeting)

```bash
cd frontend
npm ci
npm run build && npm run start:standalone     # the production build on http://localhost:3000
# or: npm run dev
```

Open `http://localhost:3000/?fixture=1`. Light and dark theme follow the operating system; switch language
in Preferences (`?open=preferences`) to show German or Japanese. For the deep dive you also need Python 3.12
with `requirements.txt` installed and a throwaway Postgres 16 (`MERIDIAN_TEST_DB_URL`).

The demo tenant: three systems. ECC production (ECC 6.0 EHP8, client 100) was extracted on 16 Oct 2026 at
04:41 with 400,662 records and analysed; S/4HANA sandbox was extracted (212,480 records) but not analysed;
SuccessFactors is not extracted yet. Fifteen objects are scored on ECC production.

## Part 1: product demo by role (30 minutes)

### 1. Programme lead: the landscape (6 minutes)

| Step | URL | What they will see |
|---|---|---|
| 1 | `/?fixture=1` | the landscape: systems as columns, objects as rows, one ruler per cell. The sentence: "11 of 15 objects are held under 85 by 70 critical rules over tolerance". Verdicts: 2 go, 2 at risk, 11 no-go. The status strip: run 16 Oct 2026, 05:17; 400,662 records checked; 5,178 rules measured; scored in 11 m 42 s. |
| 2 | point at the SuccessFactors column | "Not extracted yet." The product shows what it has not measured instead of hiding it. |
| 3 | `/?fixture=1&view=waves` | migration waves and their readiness; open `&open=certificate:w-2` for a readiness certificate with sign-off. |
| 4 | type `MM014` in the command line (Ctrl+K) | "MM014: Base unit of measure not valid" opens the rule from anywhere. |

Message: one screen answers "can we go live, and what holds us back", in SAP objects rather than tables.

### 2. Programme lead: one object and its score (6 minutes)

| Step | URL | What they will see |
|---|---|---|
| 1 | `/o/ecc-production/material-master?fixture=1` | Material master: the ruler with six weighted segments (25, 25, 20, 10, 10, 10), the measured score 71.8 as a tick and the capped score 70 as the number; "Capped at 70 by MM014 and MM031"; the receipt footer names the tolerance ("10% of rows or 25 rows"). 913 rules measured, 61,816 records checked, 25,712 records to fix. |
| 2 | Rules tab (`/o/ecc-production/material-master/rules?fixture=1`) | rules ranked by consequence; each row opens in the inspector without leaving the page. |
| 3 | `/r/MM014?fixture=1` | the rule across systems: definition, failing records, blocked SAP features, history. |
| 4 | Runs tab, then `/runs?fixture=1` | compare with the baseline: "12 of 15 objects scored higher and 3 lower. 14 rules started failing and 37 stopped." and "14 new, 37 fixed, 23 worse, 61 better". |

Message: the score is a receipt, not a gauge; every point traces to named rules and records.

### 3. Data steward: fixing records (7 minutes)

| Step | URL | What they will see |
|---|---|---|
| 1 | `/work?fixture=1&persona=steward` | "25,712 records to fix, 3,418 with a suggested value." State chips: To fix 25,712; Fix proposed 3,418; Waiting for approval 612; Exceptions 48. |
| 2 | click record `000000000000000232` | the record inspector: every field as TABLE-FIELD with its description (`MARA-MEINS`, "Hex bolt M8 zinc"), the failing rule MM014, the suggested value and the possible values. |
| 3 | accept the suggested value | the toast "Accepted 1 suggested value"; To fix drops to 25,711 and Waiting for approval rises to 613; press Ctrl+Z: "Undone: accepted 1 suggested value" and the counts return to 25,712 and 612. |
| 4 | select three rows | the bulk bar ("3 records"): fill down, accept all, assign. |
| 5 | Export | the fix sheet: the same columns as the screen, with blank New value and Decision columns to fill in and import back. |
| 6 | `/work?fixture=1&policy=gxp:batch_identity&filter=open` | the ledger filtered to the GxP batch identification class of the policy pack. |

Message: the work is done in the product, with SAP field names, undo, and an export people already know
how to use. (Note for the buyer: the export does not yet carry the batch and policy filters; see
roadmap-and-debt.md, D-03.)

### 4. Data owner: approvals (4 minutes)

| Step | URL | What they will see |
|---|---|---|
| 1 | `/?fixture=1&persona=owner` | the same landscape with the owner's next step: "Approve batch B-241". |
| 2 | `/people?fixture=1&persona=owner` | "2 batches wait for your approval"; the person inspector lists the approvals waiting. |
| 3 | `/work?fixture=1&persona=owner&filter=approvals` | 612 records waiting; approve batch B-241: "Approved batch B-241". |
| 4 | `/work?fixture=1&persona=steward&filter=open&batch=B-236` | a batch already sent: "Sent to SAP, 180 records". Say what this means: the batch's load file was exported (batch status `exported`, labelled "Sent to SAP" in `frontend/lib/v2/batches.ts`); a person loads that file in SAP. Nothing was written to SAP by Meridian. |

Message: four-eyes approval before a fix leaves the product.

How fixes reach SAP (state this to the buyer as written): file export always; live BAPI write-back for
material master, customer and business partner (simulate then commit, per-record RETURN messages); other
objects export only. The BAPI mappings are being implemented in October 2026; in the code this script was
written against, `BAPI_FIELDS` in `api/routes/writeback.py` is empty and live write-back is off by default,
so every on-premise fix leaves as a file (roadmap-and-debt.md, DR-2). Do not demonstrate or describe live
write-back until DR-2 is closed.

### 5. SAP Basis and administrator (5 minutes)

| Step | URL | What they will see |
|---|---|---|
| 1 | `/?fixture=1&persona=basis` | the landscape shaped for Basis, with the next step "Extract SuccessFactors"; it opens the system inspector showing "Sign-in refused", and Test connection answers "OData connection failed" (the demo system is deliberately broken). |
| 2 | `/s/a1b2c3d4-0001-4000-8000-000000000001?fixture=1&tab=extractions` | ECC production: extractions, schedules (`&tab=schedules`), configuration and drift (`&tab=configuration`), custom Z objects (`&tab=custom-objects`). |
| 3 | `/admin/users?fixture=1`, then `/admin/settings?fixture=1` | users and roles; settings with Appearance, Compliance and Sandbox. |
| 4 | `/admin/policypacks?fixture=1&open=policypack:sox` | the SOX pack: classes, the rules that evidence them, breaches. |
| 5 | `/work?fixture=1&sandbox=1` | "Sandbox mode is on: decisions apply to the sandbox run only." and "Sandbox: nothing leaves this deployment." |
| 6 | `/status?fixture=1` | the public status page: components, uptime, maintenance. |

### 6. Close (2 minutes)

`/reports?fixture=1`: the board pack and scheduled reports. Then switch the language to Japanese in
Preferences and reload the landscape. The interface catalogue is complete (4,074 keys, 0 gaps), but some
text the API composes in English (dimension names, the cap rule, linked object names on the object page)
stays English on screen; say so if the buyer reads German or Japanese.

## Live demo: against a running API (45 minutes to set up)

There is no seeded demo tenant in this repository and no prepared live demo. What exists is the tooling to
build one from synthetic data and the record of one acceptance run.

Tooling in this branch:

- `scripts/e2e-seed-data.py` writes synthetic business partner, material master and GL extracts as CSV
  (`--rows`, default 5,000) from the generators in `tests/fixtures/synthetic_sap_data.py`, ready for
  `POST /api/v1/upload`.
- `tests/fixtures/realistic_sap_data.py` generates deterministic extracts with seeded failures (bad partner
  numbers, missing countries, `00000000` dates, missing material types).
- `scripts/seed_loadtest.py` seeds a migrated database with three systems, run history and 400,000 work
  records for the load test. It writes rows directly, not through the engine, so it is for performance, not
  for showing computed numbers.

Steps, on a throwaway machine:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d   # Postgres, Redis, API, worker, beat, frontend
docker compose exec api alembic upgrade head
python scripts/e2e-seed-data.py --rows 5000 --out seed                   # seed/business_partner.csv and others
```

1. Sign in as `admin@meridian.local` with the default password the API writes to its log at first start
   (`api/main.py`), and change it.
2. Register a system in Administration (`frontend/design/v2/admin/data.tsx`). An ECC system with no
   reachable SAP is enough: the connection test reports that PyRFC is not installed, and uploads can still
   be attached to it.
3. Upload `seed/business_partner.csv` and `seed/material_master.csv` attached to that system
   (`POST /api/v1/upload` with `system_id`, or the upload in Administration, runs and jobs,
   `frontend/design/v2/admin/runs.tsx`), and let the worker finish the analysis.
4. Walk the same screens as Part 1 without `?fixture=1`. The numbers now come from the check engine and
   the scoring on the synthetic data, so they differ from Part 1.

No SAP system is involved in any of this: the extracts are synthetic. A demo on a buyer-supplied ECC
sandbox needs the SAP NW RFC SDK (customer supplied, `vendor/nwrfcsdk/README.md`), an RFC user with
read access to the tables in `sap/extraction_registry.py`, and Basis approval for `RFC_READ_TABLE`
(see PC-1 in the register). It has not been done for this package.

The acceptance run: on 30 October 2026 the product was brought up locally (fresh database migrated from
empty, Redis, API, worker and beat, the built frontend), synthetic extracts from
`tests/fixtures/realistic_sap_data.py` were uploaded and analysed, and the product was walked as every
role: 18 of 21 browser steps and 66 of 66 API checks passed. The report (`frontend/docs/acceptance-2026-10.md`)
and the live-stack spec (`frontend/e2e/acceptance.spec.ts`, skipped unless `ACCEPTANCE_BASE_URL` is set) are
in commit `d49301fd` on the backend remediation branch and are not yet merged into this branch. No live
end-to-end spec runs in CI.

## Part 2: technical deep dive (10 minutes)

Run from the repository root with `PYTHONPATH=$PWD` and `MERIDIAN_TEST_DB_URL` pointing at an empty
Postgres 16 the tests may migrate.

### A. Tenant isolation is enforced by the database (4 minutes)

```bash
# 1. Every model with tenant_id has an RLS migration (static, no database needed)
pytest -q tests/test_rls_conformance.py

# 2. A non-superuser, non-BYPASSRLS role cannot see or write another tenant's rows
pytest -q tests/test_rls_integration.py

# 3. Count it live on a migrated database
python3 scripts/diligence_counts.py --rls && python3 -c "import json; r=json.load(open('docs/diligence/generated/counts.json'))['rls']; print({k: r[k] for k in ('alembic_head','tables_with_tenant_id','tenant_tables_rls_enabled','tenant_tables_rls_forced')})"
# expected: head 116, 153 tenant tables, 153 enabled, 152 forced

# 4. Every mutating route has a permission check
pytest -q tests/test_rbac_matrix.py
```

Show `api/deps.py:get_db` (`SET LOCAL app.tenant_id`) and `workers/db.py:tenant_session`.

### B. Scores are deterministic (3 minutes)

```bash
# the formula, the caps (85 for one critical, 70 for two or more) and "nothing measured is not 100"
pytest -q tests/services/test_scoring.py tests/services/test_scoring_passrate.py

# 400,000 rows through the engine: exact injected-defect counts inside a 60 s budget
pytest -m perf -s tests/checks/test_perf_400k.py
```

Show `api/services/scoring.py` (`DEFAULT_WEIGHTS`, `_cap`) and one YAML rule in
`checks/rules/ecc/material_master.yaml` next to its check class in `checks/types/`. Point out that the
same inputs give the same score with `LLM_PROVIDER=none`.

### C. No raw data reaches the model (3 minutes)

```bash
# the agent state carries aggregates only, and no prompt refers to raw rows
pytest -q tests/agents/test_state.py tests/agents/test_prompts.py

# the whole six-node graph runs with the model replaced by mocks, and keeps going if a node fails
pytest -q tests/agents/test_orchestrator.py

# the helpers degrade to deterministic behaviour with no provider
pytest -q tests/test_ai_survivorship_noop.py tests/test_llm_provider_safe_invoke.py
```

Show `agents/state.py` (the `findings_summary` fields) and `agents/config_impact.py` (no model call).
Then be precise, as security.md section 9 is: two optional helpers (upload column matching, value
matching) send redacted sample values when a cloud model is configured; with the bundled model or none,
nothing leaves the deployment.
