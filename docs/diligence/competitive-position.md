# Competitive position

A capability comparison against Informatica, Collibra, Ataccama, SAP MDG, Monte Carlo and Soda. The
Meridian column is built only from what this repository does, with the route, screen or file that does
it. The competitor columns come from the product research behind the Meridian 2 design (vendor
documentation, review sites and community posts collected in October 2026; that research states its own
caveat: search snippets rather than product walkthroughs, small review samples, some items inferred from
vendor material). Where the research did not cover a capability the cell says "not covered", which means
unknown, not absent. A buyer should verify every competitor cell in a demo.

## 1. Comparison

| Capability | Meridian (evidence in this repository) | Informatica IDMC | Collibra DQ and Observability | Ataccama ONE | SAP MDG | Monte Carlo | Soda |
|---|---|---|---|---|---|---|---|
| Deployment | customer-hosted Docker Compose or Helm; SAP data stays on the customer host; air-gapped mode (`docker/docker-compose.customer.yml`, `helm/meridian`, `docs/air-gapped-deployment.md`) | cloud service (IDMC) | not covered | not covered | inside S/4HANA (cloud edition on BTP reported as being discontinued) | cloud service | cloud service with an agent |
| Unit of analysis | SAP business object per system: 47 modules across ECC, S/4HANA, SuccessFactors, Concur, Ariba, BTP, eWMS (`checks/rules/`, landscape `/`) | data assets and profiles | data assets, catalogue-centric (inferred in research) | data assets | one master-data object per change request | tables, domains, data products | datasets |
| Shipped rule content | 8,380 SAP rules in YAML (5,623 enabled hand-written, 2,757 DDIC-derived shipped off), 21 check classes (`checks/rules/`, `checks/types/`) | rules built per customer with AI suggestions (CLAIRE) | not covered | not covered | validations inside change requests | ML monitors on tables | checks per dataset, no-code or code |
| SAP connectivity | RFC (PyRFC), OData V2 and V4, REST for Concur and Ariba, BTP XSUAA (`sap/`, `api/services/connectivity_manager.py`) | not covered | not covered | not covered | native | not covered (warehouse-oriented) | not covered (warehouse-oriented) |
| Score | deterministic DAMA score, six weighted dimensions, record-level pass rates, critical cap at 85 and 70, raw and capped shown with the capping rules (`api/services/scoring.py`, `GET /api/v1/objects/{module}/receipt`, ruler on `/o/{system}/{module}`) | scorecards | not covered | not covered | not covered | table health | not covered |
| Explaining a change | run against run by rule and object, "why the score moved" (`GET /api/v1/versions/compare`, `/run/{id}/vs/{b}`; `GET /api/v1/explain/{metric}`) | not covered | not covered | not covered | not covered | incidents with lineage | incidents per dataset |
| Business consequence | 53 deterministic rules map failing checks to blocked or degraded SAP features (`agents/config_impact.py`, `GET /api/v1/config-impact/{version_id}`); value at risk from a tenant cost model (`checks/cost_model.yaml`, `GET /api/v1/simulate/fix/top`) | not covered | not covered | not covered | not covered | downstream report lineage | not covered |
| Fix work | one ledger per record and failing field with current, suggested and new value, fill-down, accept-all, four-eyes approval, fix sheet export and import (`/work`, `GET /api/v1/work/records`, `POST /api/v1/work/decide`, `GET /api/v1/work/export`, `POST /api/v1/work/import`) | not covered | not covered | not covered | change requests with validation, approval, activation | incidents, no record fix | incidents, no record fix |
| Write-back to SAP | approved batches and golden records written back with approval (`POST /api/v1/writeback`, `GET /api/v1/writeback/approvals`, `POST /api/v1/master-records/{id}/writeback/requests`) | not covered | not covered | not covered | native (activation) | no | no |
| Golden records, match and merge | match rules, scores, survivorship, golden records (`/api/v1/match-rules`, `/api/v1/master-records`, `/o/{system}/{module}/golden`) | MDM 360 | not covered | MDM reported | native | no | no |
| Business glossary | terms linked to rules and fields (`/api/v1/glossary`, `/o/{system}/{module}/glossary`) | governance catalogue | glossary and catalogue | not covered | not covered | no | no |
| Lineage | SAP object lineage model and impact by run (`GET /api/v1/lineage/graph`, `/lineage/impact/{version_id}`, `/o/{system}/{module}/lineage`) | reported | needs a second product (research) | reported | not covered | table and field lineage | not covered |
| Data contracts | contracts with versions, breaches and freshness enforcement (`/api/v1/contracts`, `workers.scheduler.contract_freshness`) | not covered | not covered | not covered | not covered | not covered | contracts with stakeholder approval |
| Configuration intelligence | live SAP configuration reverse-engineered from transactions, drift alerts (`api/services/config_intelligence/`, `GET /api/v1/config/drift/alerts`) | no | no | no | not covered | no | no |
| Process readiness | L1 to L5 process documents with field-level DQ status, process discovery from SAP events (`GET /api/v1/business-process/{version_id}/{module}`, `/api/v1/process-discovery`, `/o/{system}/{module}/processes`) | no | no | no | not covered | no | no |
| Migration readiness | waves, readiness certificates with sign-off (`/api/v1/migration/waves/{id}/certificate`) | not covered | not covered | not covered | not covered | no | no |
| Compliance packs | GDPR, SOX and GxP field classes evidenced by named rules (`/api/v1/policy-packs`, `sap/policy_packs.yaml`) | privacy use cases reported | not covered | not covered | not covered | not covered | not covered |
| Natural language | rules-first parser into ledger filters, model only for leftovers (`GET /api/v1/command/nl`, `api/services/nl_query.py`) | CLAIRE GPT across services | not covered | not covered | natural-language change requests (vendor claim) | not covered | SodaGPT for check authoring |
| Role-shaped first screen | persona per role: lead, steward, owner, Basis, process analyst (`lib/v2/hooks.ts:useV2Session`, `/`) | not covered | not covered | not covered | inbox of work items | one dashboard plus incidents | dataset dashboard |
| Alert routing | email, Slack, Teams, webhooks with retries; digests (`/api/v1/webhooks`, alert channels in `api/routes/notifications.py`, `/api/v1/digests`) | not covered | not covered | not covered | not covered | reported | Slack, Teams, webhooks |
| Identity | OIDC, SCIM 2.0, API keys, 14 roles with system and module scopes (security.md) | not covered | not covered | not covered | SAP roles | not covered | not covered |
| Model dependence | every number deterministic; the product runs with no model (`LLM_PROVIDER=none`) | AI agents across the platform (CLAIRE Agents) | not covered | not covered | AI features marketed | ML anomaly detection | AI assistant |

## 2. Where Meridian is narrower

- **Not a general data platform.** No warehouse or lakehouse connectors (Snowflake, Databricks, BigQuery);
  the connector layer is SAP-only plus file upload. Monte Carlo, Soda and Informatica cover those estates.
- **Not an anomaly detector first.** Checks are declared rules; the statistical layer (`checks/anomaly.py`,
  `checks/outliers.py`, `/api/v1/mining/anomalies`) is secondary. Observability tools lead with learned
  monitors.
- **Not the system of record for master data.** SAP MDG owns create and change of master data inside SAP
  with its own workflow; Meridian proposes, approves and writes back fixes, and keeps golden records, but
  does not replace MDG's governance of creation.
- **Catalogue breadth.** Collibra and Informatica sell an enterprise catalogue across all systems;
  Meridian's glossary and lineage are scoped to SAP objects.
- **Scale ceiling not yet proven at the largest SAP estates** (roadmap-and-debt.md, D-24).

## 3. What the research found no competitor doing (from the research's own section 4)

The research lists five gaps it found unaddressed: a role-shaped next step, ranking by business
consequence, a navigable module by system structure, fix-in-context with an SAP-literate record view, and
deterministic scores that explain their own change. Each is implemented here: personas
(`useV2Session`), config impact and value at risk, the landscape matrix and object pages, the work ledger
with the record inspector (`?open=record:...`), and the ruler with run comparison. The research marks this
as absence of evidence from limited searching; it is a hypothesis to test in competitive demos, not a
finding.
