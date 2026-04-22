# Meridian Platform — Claude Code Instructions

You are building **Meridian**, a customer-deployed SAP Data Quality and Master Data Management platform. Read this file fully at the start of every session before touching any code.

---

## What you are building

Meridian analyses SAP data quality across **29 modules** and **254+ predefined validation checks** on data from **7 SAP system types** (ECC, S/4HANA Cloud, SuccessFactors, Concur, Ariba, eWMS, BTP). It ships as a customer-hosted Docker Compose stack — SAP data, findings, and reports never leave the customer's own environment.

The product includes:
- **Data Quality Engine** — deterministic checks with DAMA DMBOK scoring (6 dimensions, record-level pass rates)
- **MDM Platform** — golden records, match & merge, business glossary, stewardship workbench, cleaning engine, exception management
- **Config Intelligence Engine** — reverse-engineers live SAP configuration from transactional data (3 layers: Discovery, Process Detection, Alignment Validation)
- **Config Impact Model** — maps DQ findings to downstream feature-level impact (blocked/degraded SAP features, opportunity cost)
- **L1-L5 Business Process Writer** — generates field-level process readiness documents enriched with DQ status
- **Multi-system Connectivity** — cloud SAP connectors (SF OData V2, Concur REST, Ariba REST, S/4HC OData V4), unified extraction, SPRO config reader with baseline fallback
- **Analytics & NLP** — predictive DQS forecasting, natural language query interface, data contracts
- **Cloudflare Control Plane (Meridian HQ)** — licencing, billing, admin (never touches SAP data)

---

## Architecture — know this before writing a line of code

```
┌─────────────────────────────────────────────────────────┐
│                   CLOUDFLARE (Your infra)                │
│                                                          │
│  ┌──────────────────────┐  ┌──────────────────────────┐  │
│  │   Meridian HQ        │  │   Licence Worker         │  │
│  │   (Admin Portal)     │  │   (API)                  │  │
│  │  • Tenant CRUD       │  │  POST /api/licence/      │  │
│  │  • Module toggles    │  │       validate           │  │
│  │  • Rules engine      │  │  Cloudflare D1 database  │  │
│  │  • Stripe billing    │  │                          │  │
│  └──────────────────────┘  └─────────┬────────────────┘  │
└──────────────────────────────────────┼───────────────────┘
                                       │ Licence validation only
┌──────────────────────────────────────┼───────────────────┐
│              CUSTOMER ENVIRONMENT     │                   │
│                                      ▼                   │
│  ┌──────────────────────────────────────────────────┐    │
│  │   Customer Meridian Deployment                    │    │
│  │  ┌─────────┐ ┌─────────┐ ┌────────┐ ┌────────┐  │    │
│  │  │ Next.js │ │ FastAPI │ │Postgres│ │ Celery │  │    │
│  │  │Frontend │ │ Backend │ │  + RLS │ │Workers │  │    │
│  │  └─────────┘ └─────────┘ └────────┘ └────────┘  │    │
│  │  ┌─────────┐ ┌─────────┐                         │    │
│  │  │ Ollama  │ │ MinIO   │  (Tier 2 only)           │    │
│  │  └─────────┘ └─────────┘                         │    │
│  │  All SAP data stays HERE — never leaves           │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

---

## Project structure

```
meridian/
├── CLAUDE.md                        ← this file
├── docker-compose.yml / .dev.yml    ← production + dev overrides
├── docker/                          ← production Dockerfiles (IP-protected)
├── .github/workflows/               ← CI/CD (build, test, release, deploy)
│
├── api/                             ← FastAPI application
│   ├── main.py                      ← 36 registered routers + GzipMiddleware
│   ├── middleware/
│   │   ├── tenant.py                ← JWT → tenant_id → Postgres RLS
│   │   ├── licence.py               ← module entitlement enforcement
│   │   └── cache.py                 ← Redis response caching decorator
│   ├── routes/                      ← all API endpoints (36 route modules)
│   │   ├── connectivity.py          ← module-aware extraction, config sync, health
│   │   ├── spro_config.py           ← SPRO configuration reader
│   │   ├── config_impact.py         ← feature-level impact analysis
│   │   ├── business_process.py      ← L1-L5 process readiness
│   │   ├── events.py                ← SSE for real-time job status
│   │   └── ...                      ← upload, findings, reports, analytics, etc.
│   └── services/
│       ├── connectivity_manager.py  ← unified connection, extraction, health check
│       ├── spro_reader.py           ← SPRO/FO config with live/baseline fallback
│       ├── process_writer.py        ← L1-L5 business process enrichment
│       ├── config_intelligence/     ← 3-layer Config Intelligence Engine
│       └── ...                      ← scoring, cleaning, NLP, export, etc.
│
├── agents/                          ← LangGraph agents
│   ├── orchestrator.py              ← 6-node graph: analyst → config_matching → config_impact → remediation → readiness → report
│   ├── config_impact.py             ← deterministic feature impact (52 rules)
│   └── state.py                     ← AgentState TypedDict
│
├── checks/                          ← deterministic check engine + YAML rules
│   ├── runner.py                    ← pandas (default) or Polars engine toggle
│   ├── polars_engine.py             ← high-performance Polars check engine (optional)
│   └── types/                       ← null, regex, domain, cross_field, freshness checks
│
├── sap/                             ← multi-system SAP connector layer
│   ├── base.py                      ← SAPConnector + CloudSAPConnector abstractions
│   ├── rfc.py                       ← ECC/S4 on-prem via PyRFC
│   ├── successfactors.py            ← SuccessFactors OData V2
│   ├── concur.py                    ← Concur REST v4
│   ├── ariba.py                     ← Ariba REST
│   ├── s4hana_cloud.py              ← S/4HANA Cloud OData V4
│   ├── data_dictionary.py           ← field metadata for 33 SAP tables
│   ├── baseline_config.py           ← baseline SPRO config (5 system types)
│   ├── extraction_registry.py       ← module-to-table mapping for all systems
│   ├── spro_tables.py               ← SPRO/FO registry (18 modules, all connectors)
│   └── process_definitions.py       ← L1-L5 process hierarchy (PTP, OTC)
│
├── workers/                         ← Celery tasks (all have soft_time_limit + time_limit)
│   ├── db.py                        ← shared DB engine (single connection pool)
│   ├── tasks/
│   │   ├── run_checks.py            ← batch inserts, column pruning
│   │   ├── run_agents.py            ← asyncio.run(), 600s timeout
│   │   ├── run_extraction.py        ← module-aware multi-system extraction
│   │   ├── run_config_sync.py       ← SPRO/FO config sync
│   │   ├── run_health_check.py      ← connection health + check_all_systems
│   │   └── ...                      ← cleaning, sync, PDF, notifications, etc.
│   └── scheduler.py                 ← 12 beat tasks inc. health check every 30min
│
├── db/                              ← SQLAlchemy schema + Alembic migrations (033)
│   ├── schema.py                    ← all models inc. ConfigImpactResult, ConfigSnapshot, SystemModuleMap
│   ├── migrations/versions/         ← 033 migrations
│   └── seeds/config_impact_rules.yaml ← 52 feature impact rules
│
├── llm/provider.py                  ← swappable LLM with request_timeout=120
│
├── frontend/                        ← Next.js 15 dashboard
│   ├── app/(dashboard)/             ← 30 page routes inc. connectivity, config-impact, business-process
│   ├── lib/api/                     ← 19 typed API client modules inc. connectivity.ts
│   └── components/                  ← shadcn/ui + system-card, module-grid, config-viewer, etc.
│
├── cloudflare/                      ← Meridian HQ + licence worker
├── scripts/                         ← deploy, update, backup, package, export
├── helm/                            ← Kubernetes Helm chart
└── tests/                           ← 30 test files (28 spec tests passing)
```

---

## Core principles

1. **Deterministic before probabilistic.** Every number comes from a Python check function, not an LLM. The LLM receives only aggregated findings.
2. **The LLM never sees raw SAP data.** Agents receive structured finding summaries only.
3. **Tenant isolation is non-negotiable.** Every query includes `tenant_id`. Postgres RLS enforced. Always `SET app.tenant_id` before sessions.
4. **Check logic lives in YAML + Python.** New rules go into YAML files and check classes — not prompts.
5. **AI is always the fallback, never the primary.** Deterministic rules run first.
6. **IP protection.** Production images compile `.pyc`, strip source. Next.js standalone. Multi-stage Docker builds.

---

## SAP connector layer

All SAP connectivity goes through `sap/`. Never import connector libraries directly.

```python
# On-premise (ECC, S/4HANA, eWMS) — RFC
from sap import get_connector
from sap.base import SAPConnectionParams
with get_connector() as conn:
    conn.connect(params)
    df = conn.read_table("BUT000", ["PARTNER", "BU_TYPE"])

# Cloud (SF, Concur, Ariba, S/4HC) — OData/REST
from sap.base import CloudConnectionParams
from sap.successfactors import SuccessFactorsConnector
conn = SuccessFactorsConnector()
conn.connect(CloudConnectionParams(base_url=..., company_id=..., auth_type="oauth2_client_credentials", ...))
df = conn.read_entity_set("EmpEmployment", select=["userId", "startDate"])
```

| System | Connector | Protocol | Auth |
|--------|-----------|----------|------|
| ECC/S4 On-Prem | `sap/rfc.py` | RFC | User/Password |
| S/4HANA Cloud | `sap/s4hana_cloud.py` | OData V4 | OAuth 2.0 |
| SuccessFactors | `sap/successfactors.py` | OData V2 | Basic/OAuth 2.0 |
| Concur | `sap/concur.py` | REST v4 | OAuth 2.0 |
| Ariba | `sap/ariba.py` | REST | OAuth 2.0 + API Key |

Backends: `SAP_CONNECTOR=rfc|ctypes|odata|mock|successfactors|concur|ariba|s4hana_cloud`

---

## DQS scoring formula

```
DQS = (Completeness × 0.25) + (Accuracy × 0.25) + (Consistency × 0.20)
    + (Timeliness × 0.10) + (Uniqueness × 0.10) + (Validity × 0.10)
```

- Dimension scores use **record-level pass_rate averaging** (not binary pass/fail)
- One Critical failure caps DQS at 85; two+ caps at 70
- Weights configurable per tenant

---

## LangGraph agent flow

```
analyst → config_matching → config_impact → remediation → readiness → report_agent
```

The `config_impact` node is deterministic (no LLM) — maps check_ids to blocked/degraded features using 52 rules from `db/seeds/config_impact_rules.yaml`.

---

## Database schema — key tables

```sql
-- Core
tenants, analysis_versions, findings, reports, users

-- MDM
master_records, match_scores, glossary_terms, stewardship_queue

-- Config Intelligence
config_inventory, config_processes, config_process_steps,
config_alignment_findings, config_health_scores, config_drift_log

-- Connectivity (migrations 030-033)
sap_systems (extended: system_type, base_url, auth_type, health_status, ...)
system_credentials, sync_profiles (extended: modules[], sync_type, extraction_mode)
sync_runs, system_module_map, config_snapshots, record_hashes

-- Config Impact
config_impact_results (version_id, feature, status, blocking_findings, opportunity_cost)

-- RBAC + Audit
users, llm_audit_log, licence_cache, rules, field_mappings
```

RLS policy on every data table — always set `app.tenant_id` before queries.

---

## LLM tiers

| Tier | Provider | Config |
|------|---------|--------|
| Tier 1 | Cloud API | `LLM_PROVIDER=anthropic` or `azure_openai` |
| Tier 1.5 | Ollama Cloud | `LLM_PROVIDER=ollama_cloud` + `OLLAMA_API_KEY` |
| Tier 2 | Bundled Ollama | `LLM_PROVIDER=ollama` (request_timeout=120) |
| Tier 3 | BYOLLM | `LLM_PROVIDER=custom` + endpoint URL |

---

## Frontend design system — Aurora (dark-first)

Aurora is the authoritative design system. Source of truth: `PLAN_AURORA.md`
at repo root and the Aurora Experience Spec (Parts I–V). Tokens live in
`frontend/lib/aurora/` and CSS variables in `frontend/app/styles/aurora.css`.

- **Theme**: dark-first. `:root` / `[data-theme="dark"]` render canvas
  `#0A0E1A` with raised `#111726` cards. `[data-theme="light"]` is a working
  alternative — never the default. On dark canvas, elevation is expressed by
  brightening the surface; on light canvas it uses shadow. Never mix.
- **Accent**: `#0057D2` (SAP Fiori Horizon blue, one shade deeper than the
  legacy `#0070F2`). `--aurora-accent-500`. Used for primary actions,
  selected state, focus ring, and the verdict halo.
- **Status**: success `#0B7341`, warning `#C78420`, danger `#BB0000`, info
  `#0057D2`. Used exclusively for status — never for decoration or branding.
- **Viz palette**: twelve-colour ordinal categorical tuned for dark canvas;
  sequential blue + amber ramps; diverging red/green for trend deltas.
  `--aurora-viz-1..12`.
- **Gradient budget**: one gradient in the entire product — the verdict halo
  (`--aurora-verdict-halo`) rendered at 15% opacity behind the Command Centre
  verdict sentence. Any other gradient anywhere is a bug.
- **Typography**: six sizes, not seven. Display face is Söhne when licensed,
  Inter 600 otherwise; UI face is Inter; mono is JetBrains Mono. Tokens:
  `text-micro` (11/14 +0.08em), `text-small` (13/18 +0.02em), `text-body`
  (14/20), `text-lead` (17/24), `display-sm` (24/30 -0.01em), `display-lg`
  (40/44 -0.02em). Numeric values carry `.aurora-number` for tabular,
  lining, stylistic-set-02 font-features.
- **Spacing**: 4px base grid. `--aurora-space-1..24` = 4/8/12/16/20/24/32/48/64/96 px.
- **Density**: three user-selectable tiers — `compact` (28 px rows, 12 px
  card padding, 13 px table type), `default` (36/16/14), `comfortable`
  (44/24/14). Applied via `[data-density="…"]`. Affects padding only — IA
  is invariant.
- **Motion**: four durations (`instant` 80 ms, `fast` 160 ms, `medium`
  240 ms, `slow` 360 ms), three easings (`standard`/`enter`/`exit`), two
  springs (`drawer`, `kanban`). `prefers-reduced-motion` disables verdict
  entrance, process-graph materialisation, drawer spring, kanban drops —
  never focus rings or state toggles.
- **Elevation**: five levels (0 base / 1 cards / 2 popovers / 3 command
  palette + modal / 4 verdict card with accent glow). Read via
  `var(--aurora-elev-{N}-bg)` and `var(--aurora-elev-{N}-shadow)`.
- **Iconography**: Lucide base plus twelve hand-drawn SAP icons (Business
  Partner, Material Master, Finance Ledger, Sales Distribution, HR,
  GL Account, Company Code, Plant, Storage Location, Sales Area, Purchasing
  Org, Workflow Node) in `frontend/lib/aurora/icons/` at 24×24, 1.5 px
  stroke, `currentColor`.
- **Imports**: components pull tokens via `import { … } from "@/lib/aurora"`
  — never reach into individual token modules. Application pages read CSS
  via the `--aurora-*` variables.
- **Token reference**: `/_design-playground/aurora` renders every token for
  visual regression. Removed at the WS8 cutover in favour of Storybook (WS2).

### Frontend design system — Legacy (pre-Aurora)

The previous **Fiori Horizon (hybrid glass)** system lives alongside Aurora
through the WS1–WS7 transition and is retired at the WS8 cutover. Tokens
(`.vx-card`, `.vx-glass`, `--mn-*`, `--glass-*`) remain in
`frontend/app/globals.css` so legacy `/app/(dashboard)/*` surfaces keep
rendering; **new Aurora code does not consume them**. The Fiori primary
`#0070F2` is kept as `--primary` for the legacy shell only; Aurora uses
`--aurora-accent-500` (`#0057D2`).

---

## SAP module coverage — 29 modules

| Category | Modules | Rules |
|----------|---------|-------|
| ECC (11) | business_partner, material_master, fi_gl, accounts_payable, accounts_receivable, asset_accounting, mm_purchasing, plant_maintenance, production_planning, sd_customer_master, sd_sales_orders | ~80 |
| SuccessFactors (9) | employee_central, compensation, benefits, payroll_integration, performance_goals, succession_planning, recruiting_onboarding, learning_management, time_attendance | ~50 |
| Warehouse (9) | ewms_stock, ewms_transfer_orders, batch_management, mdg_master_data, grc_compliance, fleet_management, transport_management, wm_interface, cross_system_integration | ~55 |

---

## Coding standards

- Python 3.12. Type hints on every function. Pydantic models for API request/response bodies.
- FastAPI DI for db sessions, tenant context, auth.
- Celery tasks must be idempotent (ON CONFLICT). All tasks have `soft_time_limit` + `time_limit`.
- All workers use shared `workers.db.get_sync_engine()` (no per-file engine creation).
- Check classes inherit from `checks/base.py:BaseCheck`, return `CheckResult` with `pass_rate`.
- Regex/domain checks exclude nulls — null detection is sole responsibility of `null_check`.
- `cross_field_check` uses `df.eval()`, not `df.query()`.
- Frontend: Next.js 15 App Router, TypeScript strict, Tailwind v4, shadcn/ui. No `any` types.
- API calls through typed wrappers in `frontend/lib/api/`.

### Security standards
- No stack traces to callers. Uploads: magic byte validation, formula injection sanitisation (skips SAP-mapped columns). NLP filter sanitisation. Rate limiting via Redis.

---

## Development setup

```bash
git clone https://github.com/VantaX-Org/Meridian.git && cd Meridian
cp .env.example .env
# edit .env — set LLM_PROVIDER=ollama_cloud for dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
docker compose exec api alembic upgrade head
```

---

## If you are uncertain

Stop. State the uncertainty. Ask before proceeding. Do not guess at schema names, module IDs, or SAP field names. Do not invent check logic. Do not pass raw data to the LLM. When in doubt: put it in a deterministic Python function, not a prompt.
