# Technical debt register and what the architecture allows next

An honest list of what is unfinished, inconsistent or risky in the code at commit `5cf7161c`, read from the
code rather than from plans. Each item has a location, the expected behaviour, an effort (S: under a day,
M: days, L: weeks) and a risk if left (Low, Medium, High). Items marked **Handed over** were found during
this review in files owned by another team and logged here for them; items marked **Fixed here** were
inside the diligence package's own files.

Leftover markers: the code has exactly one `TODO` and no `FIXME`, `XXX` or `HACK` across `api`, `workers`,
`checks`, `agents`, `sap`, `llm`, `db/schema.py`, the frontend source and `cloudflare`
(`grep -rn "TODO\|FIXME\|XXX\|HACK"`); it is D-10.

## 1. Register

### Build, release and supply chain

| ID | Item | Where | Expected | Effort | Risk |
|---|---|---|---|---|---|
| D-01 | **The API image ships its Python source.** The strip step `find . -path "./db/migrations" -prune -o -name "*.py" -type f -delete` exits 1 without deleting (GNU find refuses `-prune` with `-delete`); `\|\| true` hides it. `db/` is also not compiled in the API image. The worker's builder-stage strip fails the same way; its final-stage strip works but keeps every `__init__.py` as source. **Handed over.** | `docker/Dockerfile.api.prod` lines 49 to 63 and 103; `docker/Dockerfile.worker.prod` lines 46 to 49 and 82 | compile `api llm sap workers db agents checks`, delete with `find . -name "*.py" -not -path "./db/migrations/*" -delete`, then `RUN ! find . -name "*.py" -not -path "./db/migrations/*" \| grep .` so the build fails if source remains | S | High (contradicts the IP-protection claim in `CLAUDE.md` and `docs/packaging-and-deployment-guide.md` line 366) |
| D-17 | Development-only npm advisories (1 critical, 5 high) from the `shadcn` CLI devDependency. **Handed over** to the frontend team. | `frontend/package.json` line 66 | remove `shadcn` from devDependencies (it is a scaffolding CLI) or upgrade it; `npm audit` clean | S | Low (not shipped) |
| D-18 | `cloudflare/portal` runtime `qs` moderate; development tooling advisories in all four Cloudflare packages (`wrangler`, `miniflare`, `vitest`). **Handed over.** | `cloudflare/*/package-lock.json` | `npm update qs` in the portal; upgrade `wrangler` and `vitest` | S | Low |
| D-21 | `redis:7-alpine` floats; Redis 7.4 and later are RSALv2/SSPLv1, not open source. **Handed over** to the compose owner. | `docker-compose.yml` line 31, `docker/docker-compose.customer.yml` line 147, Helm Redis StatefulSet | pin `redis:7.2-alpine` or move to `valkey/valkey:8-alpine` | S | Medium (licence changes under a floating tag) |
| D-30 | The frontend image is built on `node:20-alpine`; Node.js 20 reached end of life on 2026-04-30 and CI tests on Node 22. **Handed over.** | `docker/Dockerfile.frontend.prod` lines 7, 13, 24 | `node:22-alpine`, the version CI uses | S | Medium (no security fixes for the runtime) |
| D-32 | Floating image tags (`:latest` for Meridian images and `ollama/ollama:latest`) in the compose files. **Handed over.** | `docker-compose.yml`, `docker/docker-compose.customer.yml` | release-pinned tags written by `update.sh`, digest-pinned upstream images | M | Medium (reproducibility) |
| D-09 | `api/requirements.txt` is a stale, unused full pin set (117 lines; `anthropic==0.97.0` against `1.15.0` in the lock); no Dockerfile or workflow installs it, only `tests/test_fastapi_streaming_pin.py` reads it. **Handed over.** | `api/requirements.txt` | delete it and drop it from that test; `requirements.txt` + `requirements.lock` are the source | S | Low (confuses scanners and reviewers) |

### Security

| ID | Item | Where | Expected | Effort | Risk |
|---|---|---|---|---|---|
| D-11 | The HTTPS server block is never enabled. Its comment says `meridian-deploy.sh` strips the `##HTTPS## ` prefix; no script contains that string. SSL mode 2 or 3 creates certificates and nginx still serves HTTP only. **Handed over.** | `docker/nginx/meridian.conf` lines 112 to 192; `scripts/meridian-deploy.sh` lines 626 to 657 | after creating certificates, `sed -i 's/^##HTTPS## //' nginx/meridian.conf`, and redirect port 80 to 443 | S | High (default install without TLS) |
| D-12 | Session JWT in `localStorage` | `frontend/lib/api/auth.ts` (`TOKEN_KEY`, `localStorage.setItem`), `frontend/lib/api/client.ts` line 96, `frontend/context/auth-context.tsx` | move to the httponly cookie the API already sets, with a CSRF token for mutating requests | M | Medium |
| D-13 | No Content-Security-Policy anywhere (API, nginx, Next) | `api/main.py` `SecurityHeadersMiddleware`, `docker/nginx/meridian.conf`, `frontend/next.config.ts` | a CSP with `default-src 'self'`, nonces for Next's inline scripts | M | Medium |
| D-14 | Password sign-in success and failure, sign-out and password change are not written to `audit_log`; `AuditMiddleware` skips `/api/v1/auth/` and `api/routes/auth.py` has no `write_audit` call. **Handed over** to the API team. | `api/middleware/audit.py` line 67, `api/routes/auth.py` | `auth.login`, `auth.login_failed` (email, IP, no password), `auth.lockout`, `auth.password_change` rows | S | Medium (audit evidence) |
| D-15 | `/docs` and `/openapi.json` proxied without sign-in. **Handed over.** | `docker/nginx/meridian.conf` lines 83 to 95; `api/main.py:306` | `docs_url=None, openapi_url=None` outside development, or behind sign-in | S | Low |
| D-16 | `scripts/backup.sh` writes `.env` (master keys) in clear unless `--encrypt` | `scripts/backup.sh` | encrypt by default; `--plain-env` to opt out | S | Medium |
| D-07 | `system_update_log` has RLS enabled but not forced | migration that created it | `ALTER TABLE system_update_log FORCE ROW LEVEL SECURITY` in a new migration | S | Low |
| D-19 | AI helper redaction keys on SAP field names, so a non-SAP header is not redacted before mapping | `api/utils/pii_fields.py`, `api/services/ai_column_matcher.py` line 333 | redact by the mapped field, and a tenant switch "aggregates only to the model" | M | Medium with a cloud model |
| D-31 | Container DNS defaults to 8.8.8.8 and 8.8.4.4, so SAP host names are resolved by a public resolver unless the operator sets `MERIDIAN_DNS_1/2`. **Handed over.** | `docker/docker-compose.customer.yml` lines 93 to 95 | default to the host's resolver (omit `dns:`) | S | Low (metadata) |

### Product and API

| ID | Item | Where | Expected | Effort | Risk |
|---|---|---|---|---|---|
| D-02 | **Share links keep the `/v2` prefix.** Migration 104's check constraint `route LIKE '/v2%'` still holds, so the API stores `/v2/o/x` and converts at the edge (`stored_route`, `app_route`). | `db/migrations/versions/104_role_capabilities.py` line 163; `api/routes/share_links.py` lines 80 to 96 | a migration that drops `ck_share_links_route`, rewrites stored routes without the prefix, and a constraint on `route LIKE '/%'`; remove the two converters | S | Low |
| D-03 | **The fix-sheet export does not accept the newer filters.** `GET /api/v1/work/records` takes `batch_id`, `policy` and `sort`; `GET /api/v1/work/export` and `/work/export/per-object` take neither, so an export from a filtered ledger (a fix batch, a policy class) returns a different set of rows than the screen shows, against the rule "export = the same columns and rows the user sees". **Handed over** to the API and frontend teams. | `api/routes/work.py` lines 522 to 544 (records) vs 1478 to 1495 (export) and 1585 (per object) | the export takes the same filter set as `/records` (one shared dependency), and the frontend passes it | S | Medium (a steward sends the wrong rows to SAP owners) |
| D-08 | 68 enabled rules declare a dimension outside the six DAMA ones (66 `lifecycle`, 2 `freshness`); `score_module` iterates only the six, so they never affect a score. | `checks/rules/ecc/{material_master,plant_maintenance,production_planning,sd_sales_orders}.yaml`; `api/services/scoring.py` line 262 | map `freshness` to timeliness, decide whether `lifecycle` is timeliness or consistency, and add a rule-integrity test that rejects unknown dimensions | S | Medium (silent scoring gap) |
| D-10 | The Z movement type accounting rule returns nothing for most inputs: it needs MSEG and BSEG cross-reference data. | `api/services/z_object_intelligence/rule_builder.py` line 277 | implement with the extraction plan's MSEG/BSEG frames or remove the rule | M | Low |
| D-35 | **The background catalogue rebuild always fails.** `_rebuild_in_background` opens `Session(...)` but the module never imports `Session` (ruff F821); the `NameError` is caught by the function's own `except Exception` and logged, so a stale object catalogue is served and never refreshed in the background. `tests/test_catalogue_stale_serve.py` checks the source text, not the call. **Handed over** to the API team. | `api/routes/system_objects.py` line 153 | `from sqlalchemy.orm import Session`, and a test that runs the rebuild | S | Medium |
| D-25 | A licence worker outage blocks a connected deployment 2 to 8 hours after it starts (6 h cache, 2 h degraded window) | `api/middleware/licence.py` lines 37 to 42 | a signed offline grace token for connected installs, or a longer degraded window | M | Medium (vendor outage becomes customer outage) |
| D-27 | No data-subject access or erasure across extracts and findings | | a subject search by record key and personal fields, export and purge across `finding_records`, `work_records`, `record_issues` and extracts | L | Medium for EU customers |

### Frontend

| ID | Item | Where | Expected | Effort | Risk |
|---|---|---|---|---|---|
| D-04 | **Stale ESLint configuration.** The Aurora rule block targets `components/**` (the directory no longer exists), ignores `**/_design-playground/**` (gone), and enables tally, chart and badge rules written for the deleted Aurora screens; an override names `components/aurora/data/table.tsx` (gone). They pass vacuously. **Handed over** to the frontend team. | `frontend/eslint.config.mjs` lines 18 to 50 and 80 to 84; `frontend/eslint-rules/aurora-structure.mjs` | drop the dead globs and overrides, keep the rules that still match `design/v2` and `app/(v2)`, or rewrite them for the v2 components | S | Low (false assurance) |
| D-05 | **Next 16 middleware rename.** Next 16.4.1 deprecates `middleware.ts` in favour of `proxy.ts` (the build prints the warning and the codemod `npx @next/codemod@canary middleware-to-proxy .`). **Handed over.** | `frontend/middleware.ts` | run the codemod; the file becomes `proxy.ts` exporting `proxy` | S | Low now, breaks on a future major |
| D-06 | `e2e/v2-step10.spec.ts` (policy packs, digests, sandbox, record history) is not in the CI spec list, so it never runs in CI. **Handed over.** | `.github/workflows/aurora-e2e.yml` lines 80 to 96 | add it to `SPECS` | S | Medium (step 10 screens untested in CI) |
| D-28 | Two Vitest tests assert wall-clock budgets (the grid renders 100,000 rows in under 200 ms; the Appearance test's 20 s timeout) and failed under CPU contention in this review's full run, then passed alone | `frontend/design/v2/__tests__/Grid.test.tsx`, `Enterprise.test.tsx` | count rendered rows instead of timing, or mark as performance tests run alone | S | Low (flaky CI) |

### Operations and process

| ID | Item | Where | Expected | Effort | Risk |
|---|---|---|---|---|---|
| D-20 | **Stale figures in the project's own instructions.** `CLAUDE.md` says Next.js 15 (16.4.1), 45 routers (120 `include_router` calls), migration head 099 and 97 migrations (116, 114 files), 12 beat tasks (31), 800+ checks (8,380 rules), 52 impact rules (53), 30 test files and 28 spec tests (505 test files), a `frontend/components/` tree (gone). **Handed over** (CLAUDE.md is not a diligence file). | `CLAUDE.md` | regenerate the figures from `docs/diligence/generated/counts.json` | S | Low (misleads engineers and agents) |
| D-22 | Rollback restores images, not the schema; no test proves the previous images run on the newer schema | `scripts/update.sh` | a CI job that runs release N-1 images against head migrations, or down-migrations for the last release | M | Medium |
| D-23 | No container log rotation in the compose files | `docker/docker-compose.customer.yml` | `logging: {driver: json-file, options: {max-size: 50m, max-file: "5"}}` per service | S | Low (disk fills) |
| D-24 | `docs/analysis-throughput.md` (2026-10-15) records a 6 h wall in the issue lifecycle; the batching and bounding fixes of 2026-10-24 (`7ef114d2`, `3b5bca1a`) have no re-measurement on the 2.8 million-issue scope | `docs/analysis-throughput.md` | re-run the ECC 4-module analysis and record the time | S | Medium (largest customers) |
| D-26 | `GET /health` answers `status: ok` without probing Postgres, Redis or storage, and the update canary relies on it | `api/routes/health.py` lines 16 to 57 | a readiness probe that checks the three dependencies; keep `/health` as liveness | S | Medium (a broken update passes the canary) |
| D-29 | Python lint is not a CI gate: no workflow runs `ruff`. **Handed over** to the backend lint builder. | `.github/workflows/unit-tests.yml` | a `ruff check` step | S | Low |
| D-33 | `docs/security/DATA_FLOW.md` section 7 said `audit_log` is kept forever; the retention policy now purges it after `audit_days`. **Fixed here.** | `docs/security/DATA_FLOW.md` | | | |
| D-34 | `docs/accessibility/audit-2026-10.md` names the `/v2/*` paths of the interface before the cut-over to the root | `docs/accessibility/audit-2026-10.md` | a note that the paths moved; the audit itself stays as dated evidence | S | Low |

### Findings of the buyer's review (30 October 2026)

An independent buyer's critique tested this package against the code and found material omissions. They
are logged here with the critique's own IDs (DR: deal risk, PC: price cut) and a status. "Being fixed
(October 2026)" means work is under way in another branch and is not in the code this register describes.

| ID | Item | Where | Expected | Effort | Risk | Status |
|---|---|---|---|---|---|---|
| DR-2 | **Live write-back to on-premise SAP sends nothing.** `BAPI_MAP` names a BAPI per object but `BAPI_FIELDS` is empty, so every field is refused; live write-back is off by default; the golden-record path reports ECC, S/4HANA on-premise and EWM as unsupported. Earlier versions of competitive-position.md and demo-script.md presented write-back as shipped. Only the S/4HANA Cloud and BTP business partner OData PATCH works live. | `api/routes/writeback.py` lines 33 to 52 and 351; `api/services/golden_writeback.py` lines 8 to 10 | file export always; live BAPI write-back for material master (`BAPI_MATERIAL_SAVEDATA`), customer and business partner with a test run (simulate) before commit and the BAPI RETURN messages kept per record; other objects export only; integration tests against an SAP sandbox | L | High (headline capability) | Being fixed (October 2026): BAPI mappings for the three objects with simulate then commit. The documents now describe write-back exactly as above. Close when the mappings, the sandbox test and the switch are merged |
| DR-1 | **The demo and every end-to-end test run on frontend fixtures.** Fixture mode answers every read from static files with the API never called; the e2e specs stub the API to 404. No test checks the fixtures against the API, some fixture module ids are not engine ids, the rules library fixture is a handful of rules, and no buyer has seen the product compute numbers from SAP data. The earlier demo script did not say its figures were fixtures. | `docs/diligence/demo-script.md`; `frontend/e2e/*.spec.ts`; `frontend/lib/api/v2/fixtures/landscape.json` against `api/routes/landscape.py` | a seeded live demo tenant; a contract test that validates every fixture against the OpenAPI schema; at least one full-stack e2e path (upload or extract, check, score, ledger) in CI; a live demo on an ECC sandbox reconciled to SE16 counts | M | High (every screenshot is a claim until then) | Partly addressed. The demo script now says plainly which figures are fixtures and how to run a live demo from synthetic extracts. An acceptance run on a live local stack (18 of 21 browser steps, 66 of 66 API checks) and a live-stack spec exist in commit `d49301fd`, not yet merged here and not run in CI. Fixture contract test, CI full-stack e2e and the SAP sandbox demo: open |
| PC-1 | **On-premise extraction depends on `RFC_READ_TABLE`.** The function is not released by SAP for customer use, needs `S_RFC` on `SDTX` and table-read rights (`S_TABU_NAM` or broad `S_TABU_DIS`), returns rows in a 512-byte work area, and is refused by many Basis teams in production. The function name is fixed in the reader; there is no ODP, SLT or CDS-view path. The Basis persona's first screen is the landscape with a different next step, not connection health, extraction volumes or authorisation errors (PC-11). | `sap/rfc.py` lines 273 to 600; `docs/sap-connector.md` section 2 | a supported read path (an ODP/ODQ or CDS-based reader, or at least a configurable read function a Basis team can approve), a published authorisation role template, and a Basis home on the Runs data | L | High (the most common SAP-side veto) | Being fixed (October 2026): an alternative reader and `docs/sap/authorisation-role-template.md` are being added. Not in this branch; the authorisations needed today are in `docs/sap-connector.md` |
| DR-3 | **The licence is not enforceable.** Online response signatures are verified only when `LICENCE_SERVER_PUBLIC_KEY` is set (blank in `.env.example`; otherwise any response is accepted); offline HMAC files are signed with `LICENCE_SECRET`, which the customer holds; the API image shipped its source (D-01). A customer can grant itself every module. | `api/middleware/licence.py` lines 134 to 145 and 437 to 444; `.env.example` line 24 | asymmetric signatures (vendor private key, public key built in) for the online response and the offline file, enforcement on by default, fail closed | M | High (revenue protection) | Being fixed (October 2026). D-01 is fixed in commit `213d8faa`, not yet merged here |
| DR-4 | **The tenant is hard-coded.** `get_tenant` returns the development tenant in every mode, the auth middleware loads only that tenant's signing secret, and licensed modules are a fixed list. RLS is real but fences one tenant. architecture.md and security.md said the tenant came from the token. | `api/deps.py` lines 76 to 95; `api/middleware/local_auth.py` lines 25, 57 to 80, 211 | the tenant from a verified token claim, a per-tenant secret cache, entitlements from the licence, the development tenant only in development, a cross-tenant API test | M | High for any hosted or multi-business-unit plan | Being fixed (October 2026). Documents corrected |
| DR-5 | **Provenance and key person.** The clone is shallow; most commits are by Claude Code under one principal engineer, in about one month. | git metadata | full history in escrow, IP assignments, a representation on AI-generated code, a retention plan | S (legal) | High until contracted | Disclosed in [provenance.md](provenance.md); the contractual items are for the transaction |
| PC-3 | **Money at risk comes from default assumptions** (ZAR 500 per critical record, rand by default) and is shown beside measured figures. | `checks/cost_model.yaml` lines 13 to 21; the object canvas and `/work` | labelled as estimated from the tenant's cost model, hidden until the tenant has set it | S | Medium | Open |
| PC-4 | **Fixture mode ships in production,** is turned on by `?fixture=1`, persists for the tab and shows no demo marker. | `frontend/lib/api/v2/fixture.ts` | impossible in a production build, or a persistent "Demo data" bar | S | Medium | Fixed in this branch (commit `b6467dd2`): honoured only in builds made with `NEXT_PUBLIC_MERIDIAN_DEMO=1`, with a "Demo data" bar on every page |
| PC-8 | **Whole-suite Python coverage has never been measured**; the only figure is 16.8% on a subset. | `.github/workflows/unit-tests.yml`; quality.md section 3 | coverage on every CI shard, combined and published, with a floor | S to M | Medium | Being fixed (October 2026) |
| PC-10 | **No Python lint or type gate in CI.** | `.github/workflows/unit-tests.yml` | `ruff check` and a type checker as CI steps | S | Low | ruff errors cleared in commit `6fdf345f`; the CI gate is being added (October 2026); type checker open |
| PC-11 | **No Basis home.** The Basis persona gets the landscape with a different next step, not connections, job health, extraction volumes and authorisation errors. | `/?persona=basis` | a Runs-based first screen for Basis | M | Medium | Open |

### Status of earlier items after the critique

Fixed on the backend remediation line on 30 October 2026, each in its own commit, verified by reading the
commit; not yet merged into the branch this register describes, so the rows above still describe this
branch:

| Item | Commit | What changed |
|---|---|---|
| D-01 | `213d8faa` | both images compile all Python packages, delete every `.py` outside `db/migrations` and fail the build if any remains |
| D-06 | `47f53c3a` | `e2e/v2-step10.spec.ts` added to the CI spec list |
| D-08 | `3a363bea` | `lifecycle` and `freshness` rules scored under timeliness; a test rejects unknown dimensions |
| D-11 | `a79e9ea8` | the installer enables the HTTPS block and the port 80 redirect when it creates certificates; `update.sh` keeps it on |
| D-14 | `24a551c0` | sign-in, failed sign-in, lockout, sign-out and password change written to `audit_log` |
| D-15 | `28c18f7c` | API docs and OpenAPI schema served only in development or with `MERIDIAN_OPENAPI_PUBLIC=1` |
| D-26 | `c86aef3d` | `/health` probes Postgres and Redis and answers 503 when either is down; `/health/live` is the shallow check |
| D-35 | `6fdf345f`, `a28f5517` | the missing import added; the test runs the rebuild instead of reading its source |
| PO-4 | `f905081b` | no middle dot in API answers (the receipt formula uses a multiplication sign) |

Being fixed (October 2026), not verifiable here: Python coverage in CI (PC-8), the ruff gate (PC-10, D-29),
licence signing (DR-3), tenant resolution (DR-4), BAPI write-back (DR-2), the alternative SAP reader and
authorisation role template (PC-1).

## 2. What the architecture allows next

These follow from what is already built, not from a plan document.

- **More SAP sources without new plumbing.** A source is a connector (`sap/base.py`: `SAPConnector` or
  `CloudSAPConnector`), an extraction registry entry and YAML rules; the check engine, scoring, work
  ledger and UI are source-agnostic. SAP Datasphere, MDG staging tables or a non-SAP ERP are each a
  connector and a rule family.
- **Rules at catalogue scale.** 2,757 DDIC-derived rules already ship disabled; enabling them per tenant
  is a row in the rules table. `workers.tasks.fix_mining` proposes rules from stewards' repeated manual
  fixes (never auto-enabled). Growth is YAML and Python, reviewable and testable, not prompts.
- **Hosted or multi-business-unit operation.** The schema is multi-tenant with forced RLS on every tenant
  table, so a vendor-hosted offering or one deployment for several business units needs no schema change;
  the work is in tenant provisioning and per-tenant encryption keys for extracts.
- **Change data instead of full extracts.** `api/services/delta_extraction.py` and `record_hashes` exist;
  routine runs on deltas cut extraction time and storage.
- **Write-back as a product.** Approved fix batches leave as load files with four-eyes approval and an
  audit trail. Live BAPI write-back for material master, customer and business partner (simulate then
  commit) is being built (DR-2); each further object is a verified BAPI parameter mapping and a sandbox
  test, not new plumbing.
- **Model independence.** Every number is deterministic and every model call is optional and logged, so
  the model provider can change (or be removed) without changing results; the risk in an acquisition is
  low because the product does not depend on a model to be correct.
- **Constraints to plan for.** The issue lifecycle on very large scopes (D-24), the licence worker as a
  single point of failure for connected installs (D-25), and Postgres as the only store for findings
  (a columnar store would be the next step past tens of millions of failing records).
