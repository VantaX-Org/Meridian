# Demo script

A 30-minute product demo by role and a 10-minute technical deep dive. Everything runs on the demo tenant
of fixture mode (`?fixture=1`): the frontend answers every read from `frontend/lib/api/v2/fixtures`, so no
backend, SAP system or licence is needed and every number below is the same on every run. The numbers are
the ones the end-to-end specs assert (`frontend/e2e/*.spec.ts`), so if a spec passes the demo shows them.

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
| 4 | `/work?fixture=1&persona=steward&filter=open&batch=B-236` | a batch already sent: "Sent to SAP, 180 records". |

Message: four-eyes approval before anything is written back to SAP.

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
Preferences and reload the landscape: every word is translated (4,074 keys, 0 gaps).

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
