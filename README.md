# Meridian — SAP Data Quality & Master Data Management Platform

Meridian is a customer-deployed SAP Data Quality and Master Data Management platform. It analyses data quality across **45 modules** with **8,380 validation rules**, each proved against fixtures, connects to **7 SAP system types** (ECC, S/4HANA Cloud, SuccessFactors, Concur, Ariba, eWMS, BTP), and provides a full MDM governance layer — all running entirely inside the customer's own environment.

SAP data, findings, and reports **never leave the customer boundary**.

## Key Features

### Data Quality Engine
- **8,380 validation rules** — 5,623 hand-authored plus 2,757 derived from the SAP DDIC, the SuccessFactors canonical schemas, and the ordering/sign invariants declared in the Ariba and Concur dictionaries (see [`scripts/generate_ddic_rules.py`](scripts/generate_ddic_rules.py)); derived rules ship disabled until a tenant enables them
- **Record-level DQS scoring** — DAMA DMBOK composite with 6 dimensions (completeness, accuracy, consistency, timeliness, uniqueness, validity)
- **Grain-correct check engine** — every rule evaluated at its SAP record grain (DDIC keys + join graph), exact counts, full failing-record keys
- **LangGraph AI agents** — 6-node pipeline: analyst, config matching, config impact, remediation, readiness, report
- **PDF executive reports** — branded DQS heatmap, findings, remediation, MDM health

### Multi-System SAP Connectivity
- **7 SAP system types** — ECC (RFC), S/4HANA Cloud (OData V4), SuccessFactors (OData V2), Concur (REST v4), Ariba (REST), eWMS, BTP
- **Module-aware extraction** — automatic table/entity selection per module per system type
- **SPRO configuration reader** — reads customising tables from live SAP or falls back to baseline config
- **Connectivity dashboard** — system registration, health monitoring (30-min heartbeat), config sync
- **Pluggable SAP connector** — abstraction layer via `sap/base.py` (SAPConnector + CloudSAPConnector)

### Config Impact Model
- **52 feature impact rules** — maps DQ findings to blocked/degraded SAP features
- **Cross-system dependencies** — e.g., SF onboarding blocked → Concur employee sync fails
- **Opportunity cost analysis** — quantifies business impact of data quality issues
- **Deterministic** — no LLM calls, pure rule lookup and aggregation

### L1-L5 Business Process Writer
- **Procure to Pay** and **Order to Cash** process hierarchies (extensible)
- **Field-level DQ overlay** — each SAP field annotated with check pass rate and status (green/amber/red)
- **Config dependency tracking** — links process steps to SPRO configuration tables
- **Transaction readiness scoring** — worst-case aggregation from field to process level

### Master Data Management
- **Golden records** — AI-assisted survivorship (deterministic first, LLM fallback)
- **Match & merge engine** — field-level weighted scoring with AI semantic matching
- **Business glossary** — SAP field catalog with AI-enriched definitions
- **Stewardship workbench** — Kanban queue with AI triage, SLA tracking
- **Data contracts** — schema, quality, freshness, and volume compliance

### Data Governance
- **Cleaning engine** — 5-category detection across all 29 modules
- **Exception management** — rule-based detection, 4-tier SLA, impact estimation
- **Analytics** — predictive DQS forecasting, prescriptive actions, cost avoidance ROI
- **NLP query interface** — natural language search across findings and MDM data

### Config Intelligence Engine
- **Config Discovery** — reverse-engineers SAP configuration from transactional data (no SPRO, no RFC)
- **Process Detection** — 7 business process signatures with completeness scoring
- **Alignment Validation** — 8 check categories with Configuration Health Score (CHS)
- **Drift tracking** — detect config changes between analysis runs

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Zone 1 — Cloudflare (no SAP data)                      │
│  ┌──────────────┐ ┌─────────┐ ┌──────────────────┐      │
│  │ Meridian HQ  │ │ Licence │ │ Stripe Billing   │      │
│  │ Admin Portal │ │ Worker  │ │ (ZAR)            │      │
│  └──────────────┘ └─────────┘ └──────────────────┘      │
└─────────────────────────────────────────────────────────┘
              │ licence ping only (no data)
              ▼
┌─────────────────────────────────────────────────────────┐
│  Zone 2 — Customer Environment (all SAP data)           │
│  ┌─────────┐ ┌────────┐ ┌──────┐ ┌──────┐ ┌──────┐     │
│  │ FastAPI │ │ Celery │ │ PG16 │ │Redis │ │Garage│     │
│  │ + Lang  │ │ Workers│ │ +RLS │ │     │ │      │     │
│  │ Graph   │ │        │ │      │ │     │ │      │     │
│  └─────────┘ └────────┘ └──────┘ └──────┘ └──────┘     │
│  ┌──────────────┐ ┌────────────────────────────┐        │
│  │ Next.js 15   │ │ Ollama (local LLM, Tier 2) │        │
│  │ map, canvas, │ │ qwen3.5:9b        │        │
│  │ inspector    │ │                   │        │
│  └──────────────┘ └────────────────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

## Prerequisites

- Docker >= 24.0, Docker Compose >= 2.20
- (Optional) NVIDIA GPU + drivers for local Ollama

## Quickstart

```bash
git clone https://github.com/VantaX-Org/Meridian.git && cd Meridian
cp .env.example .env
# edit .env — set LLM_PROVIDER, DB_PASSWORD, LICENCE_KEY
sudo bash scripts/meridian-deploy.sh
```

Access: Dashboard at `http://localhost:3000`, API at `http://localhost:8000`

## SAP Module Coverage

| Category | Modules | Rules |
|---|---|---|
| **ECC / S/4HANA** (19) | Business Partner, Material Master, GL Accounts, AP, AR, Asset Accounting, MM Purchasing, Plant Maintenance, Production Planning, SD Customer, SD Sales Orders, Controlling, HCM, Project System, Quality Management, Banking & Tax, Interface Health, S/4HANA Readiness, S/4HANA Master Data | 5,740 |
| **SuccessFactors** (9) | Employee Central, Compensation, Benefits, Payroll, Performance Goals, Succession Planning, Recruiting & Onboarding, Learning Management, Time & Attendance | 1,555 |
| **Warehouse** (9) | eWMS Stock, eWMS Transfer Orders, Batch Management, MDG, GRC Compliance, Fleet Management, Transport Management, WM Interface, Cross-System Integration | 577 |
| **Ariba** (4) | Supplier, Procurement, Contracts, Spend | 142 |
| **Concur** (3) | Users, Expense, Travel | 99 |

Rule counts include both hand-authored packs and the derived rules in each module's `<module>.generated.yaml` sidecar. Derived rules ship with `enabled: false` and are seeded off.

**Total: 45 modules, 8,380 validation rules, 52 config impact rules**

Every rule is proved against fixtures (fails at least one record, passes at least one) and
every field it reads is resolved in the SAP dictionary, both enforced by
`tests/checks/`. For how these numbers compare with what other vendors publish, and which
claims are defensible, see [docs/market-positioning.md](docs/market-positioning.md).

## Technology Stack

| Component | Technology |
|---|---|
| API | FastAPI (Python 3.12) + LangGraph |
| Check engine | Pandas (default) or Polars (optional, 10-100x faster) |
| Background jobs | Celery + Redis (12 scheduled tasks, all with timeouts) |
| Database | PostgreSQL 16 + Alembic (33 migrations) + RLS |
| Object storage | Garage (S3-compatible, AGPL, shipped unmodified) |
| Local LLM | Ollama (qwen3.5:9b, request_timeout=120) |
| Frontend | Next.js, TypeScript: one map, one canvas and one inspector (frontend/README.md); English, German, Japanese |
| SAP connectors | RFC, OData V2/V4, REST — 5 connector implementations |
| Auth | Clerk or local JWT (air-gapped) |
| Licence | Cloudflare Workers + D1 |
| Container | Docker Compose / Kubernetes Helm |

## Development

```bash
# Dev mode (no GPU required)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
# Set LLM_PROVIDER=ollama_cloud + OLLAMA_API_KEY in .env

# Run tests
python -m pytest tests/ -v

# Database migrations
docker compose exec api alembic upgrade head

# Update deployment
./scripts/update.sh
```

## Deployment Options

- **Docker Compose** — standard single-server deployment
- **Kubernetes Helm** — enterprise deployments (`helm/`)
- **Air-gapped** — offline JWT licence, local auth, pre-loaded Docker images, zero outbound calls

Administrator training (install, licence, users, connecting SAP, operations, troubleshooting), as a course with
exercises: [docs/admin-training/meridian-administrator-training.pdf](docs/admin-training/meridian-administrator-training.pdf)
(source: `meridian-administrator-training.md` beside it, printed with `npm run training:pdf` in `frontend/`).

## Security

- No SAP data leaves the customer boundary
- PostgreSQL Row Level Security for tenant isolation
- AES-256-GCM encrypted SAP credentials
- RBAC: admin, steward, analyst, viewer
- LLM audit logging, formula injection prevention, ABAP injection prevention
- Upload hardening, NLP filter sanitisation, rate limiting
- Production images: compiled `.pyc`, no source code, GzipMiddleware

## Licence

Commercial software. Licence keys issued via [Meridian HQ](https://meridian-hq.vantax.co.za).
