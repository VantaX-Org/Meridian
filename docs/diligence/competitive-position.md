# Competitive position

A capability comparison against the vendors SAP customers actually shortlist for SAP data quality,
master data and migration (SAP Information Steward, SAP MDG, Syniti, Precisely with Winshuttle, SNP),
and against the general data quality, governance and observability platforms (Informatica, Collibra,
Ataccama, Monte Carlo, Soda).

How to read it:

- **The Meridian column is built only from this repository.** Each cell names the route, screen or file
  that does it, checked with `grep` at the commit this package describes. Where a capability is partial
  or in progress the cell says so and points to the debt register ([roadmap-and-debt.md](roadmap-and-debt.md)).
- **The competitor columns are desk research, not product trials.** They come from vendor documentation,
  public product pages and community material known to the authors in October 2026. No competitor product
  was installed or demonstrated for this document. A cell marked **not verified** means we believe it but
  could not confirm it from a source we would cite; a cell marked **unknown** means we do not know. Neither
  means "absent". A buyer should confirm every competitor cell in a demo or with the vendor.
- Product names change often in this market (Precisely renamed the Winshuttle products; SNP has
  rebranded its platform). Names below are the ones most buyers will recognise.

## 1. What Meridian does, with the evidence

| Capability | Meridian (evidence in this repository) |
|---|---|
| Deployment | customer-hosted Docker Compose or Helm; SAP data stays on the customer host; air-gapped mode (`docker/docker-compose.customer.yml`, `helm/meridian`, `docs/air-gapped-deployment.md`). One deployment serves one customer; the tenant is fixed today (DR-4 in the register) |
| Unit of analysis | SAP business object per system: 47 rule modules across ECC, S/4HANA, SuccessFactors, Concur, Ariba, BTP, eWMS (`checks/rules/`, the landscape at `/`, the object canvas at `/o/{system}/{module}`) |
| Shipped rule content | 8,380 SAP rules in YAML (5,623 hand-written and enabled, 2,757 derived from the SAP Data Dictionary and shipped disabled), 21 check classes (`checks/rules/`, `checks/types/`); each rule proved to fail one synthetic record and pass another (`tests/checks/test_rule_proofs.py`). The proofs show each rule discriminates; they do not prove SAP semantic correctness on a customer's data |
| SAP extraction | on-premise ECC, S/4HANA and eWMS over RFC with `RFC_READ_TABLE` (`sap/rfc.py`); OData V2 and V4 for SuccessFactors, S/4HANA Cloud and BTP; REST for Concur and Ariba (`sap/`, `api/services/connectivity_manager.py`). No ODP, SLT or CDS-view path for on-premise yet (PC-1 in the register) |
| Score | deterministic DAMA score, six weighted dimensions, record-level pass rates, critical cap at 85 and 70, raw and capped shown with the rules that capped it (`api/services/scoring.py`, `GET /api/v1/objects/{module}/receipt`, the ruler and receipt on `/o/{system}/{module}`) |
| Explaining a change | run against run by rule and object (`GET /api/v1/versions/compare`, the run canvas at `/run/{id}`; `GET /api/v1/explain/{metric}`) |
| Business consequence | 53 deterministic rules map failing checks to blocked or degraded SAP features (`agents/config_impact.py`, `db/seeds/config_impact_rules.yaml`, `GET /api/v1/config-impact/{version_id}`); value at risk from a cost model whose shipped values are starting assumptions, not benchmarks (`checks/cost_model.yaml`, `GET /api/v1/simulate/fix/top`) |
| Fix work | one ledger per record and failing field with current, suggested and new value, fill-down, accept, four-eyes approval, fix sheet export and import (`/work`, `GET /api/v1/work/records`, `POST /api/v1/work/decide`, `GET /api/v1/work/export`, `POST /api/v1/work/import`) |
| Write-back to SAP | file export always (`POST /api/v1/remediation/batches/{batch_id}/export`, `GET /api/v1/work/export`); live BAPI write-back for material master, customer, business partner and vendor (simulate then commit, per-record RETURN messages; a vendor only where it is a business partner, through the business partner BAPIs); other objects, vendor company code and purchasing data, and vendors on releases without CVI export only. Status: in the code behind `MERIDIAN_LIVE_WRITEBACK_ENABLED` (off by default) and tested against a fake RFC connector only; not yet run against a live SAP system (DR-2). S/4HANA Cloud and BTP business partner fields can be patched over OData (`api/services/golden_writeback.py`). Every write path needs an approved batch |
| Golden records, match and merge | match rules, scores, survivorship, golden records (`/api/v1/match-rules`, `/api/v1/master-records`, `/o/{system}/{module}/golden`) |
| Business glossary | terms linked to rules and fields (`/api/v1/glossary`, `/o/{system}/{module}/glossary`) |
| Lineage | SAP object lineage model and impact by run (`GET /api/v1/lineage/graph`, `/o/{system}/{module}/lineage`) |
| Data contracts | contracts with versions, breaches and freshness enforcement (`/api/v1/contracts`, `workers/scheduler.py` contract freshness entry) |
| Configuration intelligence | SAP configuration inferred from transactional data, drift alerts (`api/services/config_intelligence/`, `GET /api/v1/config/drift/alerts`) |
| Process readiness | L1 to L5 process documents with field-level status (`GET /api/v1/business-process/{version_id}/{module}`, `/o/{system}/{module}/processes`) |
| Migration readiness | waves and readiness certificates with sign-off (`/api/v1/migration/waves/{id}/certificate`, `/o/{system}/{module}/readiness`). Meridian measures readiness; it does not move data into the target system |
| Compliance packs | GDPR, SOX and GxP field classes evidenced by named rules (`/api/v1/policy-packs`, `sap/policy_packs.yaml`) |
| Natural language | rules-first parser into ledger filters, a model only for leftover words (`GET /api/v1/command/nl`, `api/services/nl_query.py`) |
| Role-shaped first screen | persona per role: lead, steward, owner, Basis, process analyst (`frontend/lib/v2/hooks.ts:useV2Session`, `/`). The Basis view is the landscape with a different next step, not a system-health home (PC-11) |
| Alert routing | email, Slack, Teams, webhooks with retries; digests (`/api/v1/webhooks`, `api/routes/notifications.py`, `/api/v1/digests`) |
| Identity | OIDC, SCIM 2.0, API keys, 14 roles with system and module scopes ([security.md](security.md)) |
| Model dependence | every number deterministic; the product runs with no model (`LLM_PROVIDER=none`) |

## 2. The SAP-specialist vendors

| Capability | SAP Information Steward | SAP MDG | Syniti | Precisely (Winshuttle, Data360, Data Integrity Suite) | SNP (CrystalBridge, Glue) |
|---|---|---|---|---|---|
| What it is, in one line | profiling, validation rules, scorecards and metadata on top of SAP Data Services | SAP's governance application for creating and changing master data | SAP data migration and data quality, resold by SAP as SAP Advanced Data Migration and Management by Syniti | Excel-to-SAP automation (Winshuttle) plus general data quality and integrity products | SAP transformation (S/4HANA conversion, selective data transition, carve-outs) and SAP data replication |
| Deployment | on-premise, with SAP Data Services and the BI platform | inside S/4HANA or as a hub; a cloud edition on BTP exists (its roadmap not verified) | cloud platform; on-premise options for older products (not verified for new sales) | desktop and server for Winshuttle; SaaS with agents for the Data Integrity Suite (not verified) | largely installed in the SAP landscape (not verified) |
| SAP extraction | through Data Services connections to SAP applications (tables and extractors) | native | deep, through its migration tooling | reads and writes SAP through transactions and BAPIs | native to its transformation tooling; Glue replicates SAP tables to cloud data platforms |
| Shipped SAP rule content | rules authored per customer; a packaged SAP rule library not verified | validations and derivations (BRF+) per change request; rule-based data quality evaluation reported in recent releases (not verified) | prebuilt SAP object content reported (not verified for size) | unknown | unknown |
| Score | data quality scorecards by dimension with trends | data quality scores reported (not verified) | dashboards and reports (not verified for a dimension score) | unknown for Winshuttle; dashboards in Data360 (not verified) | unknown |
| Fix work and write-back | failed rows viewable; correction through Data Services jobs or a governance tool (not verified) | native: change requests, workflow, approval, activation | loads corrected and migrated data into SAP at scale (core product) | mass create and change in SAP from spreadsheets with validation runs (core product) | writes as part of the transformation (core product) |
| Match and merge | match review workflow | consolidation with match and best record | matching product reported | matching heritage from Trillium (not verified as part of the SAP offer) | unknown |
| Glossary and lineage | Metapedia glossary; metadata lineage | not covered | unknown | catalogue in the Data Integrity Suite (not verified) | unknown |
| Migration readiness | profiling before migration | consolidation before migration (not verified) | core product | load tooling, not a readiness measure (not verified) | core product |

## 3. The general data quality, governance and observability platforms

| Capability | Informatica IDMC | Collibra DQ and Observability | Ataccama ONE | Monte Carlo | Soda |
|---|---|---|---|---|---|
| Deployment | cloud service, with secure agents in the customer network | cloud, with self-hosted options (not verified) | cloud or self-hosted (not verified) | cloud service | cloud service with an agent, or open-source core |
| Unit of analysis | data assets and profiles | data assets, catalogue-centric | data assets and catalogue | tables, domains, data products | datasets |
| SAP extraction | vendor documents SAP connectors (table reader, BAPI and RFC, IDoc, ODP); not tested by us | unknown | SAP connectors reported (not verified) | not covered (warehouse-oriented) | not covered (warehouse-oriented) |
| Rule content | rules built per customer with AI suggestions | rules built per customer, learned checks | rules built per customer, AI suggestions | learned monitors on tables | checks per dataset, no-code or code |
| Score | scorecards | data quality scores per dataset | data quality scores | table health | not covered |
| Explaining a change | unknown | unknown | unknown | incidents with lineage | incidents per dataset |
| Fix work | stewardship and exception tasks in MDM and data quality (not verified for SAP records) | issue workflow (not verified) | stewardship and issue tracking (not verified) | incidents, no record fix | incidents, no record fix |
| Write-back to SAP | possible through its SAP connectors (not verified as a packaged flow) | no | unknown | no | no |
| Golden records | MDM products | no | MDM reported | no | no |
| Glossary and lineage | governance catalogue, lineage | glossary, catalogue, lineage | glossary and lineage | table and field lineage | not covered |
| Data contracts | unknown | unknown | unknown | unknown | contracts with stakeholder approval |
| Alert routing | unknown | unknown | unknown | Slack, Teams, email, incident tools | Slack, Teams, webhooks |
| Model dependence | AI across the platform (CLAIRE) | ML-learned checks | AI features marketed | ML anomaly detection | AI assistant for checks |

## 4. Where Meridian is different, and how confident we are

These are the differences we believe hold. Each is tied to code above. None has been tested in a
side-by-side demo, so each is a hypothesis for the buyer's competitive calls, not a finding.

1. **An SAP-object rule library that ships.** 8,380 rules keyed to SAP tables and fields, each with a
   passing and a failing proof. The general platforms ship engines and build rules per customer. Syniti
   and SAP MDG ship SAP content of their own whose size we could not verify, so "largest SAP rule library"
   is **not** a claim we make.
2. **A score that explains itself.** The receipt shows dimension weights, rules measured, records checked,
   coverage, the measured score, the cap and the rules that caused it (`/o/{system}/{module}`).
   Information Steward also has dimension scorecards; what we have not seen elsewhere is the cap and the
   per-rule reconciliation on one screen. Unverified for MDG and Syniti.
3. **Business consequence in SAP terms.** Failing rules mapped to blocked or degraded SAP features (53
   rules). The money figure that sits beside it comes from assumptions the tenant must set (PC-3).
4. **One product from measurement to approved fix**, customer-hosted, with no dependency on a model.
   The fix leaves as a file by default; live BAPI write-back is in the code behind a switch and not yet
   run against a live SAP system (DR-2).

Claims we have removed from earlier drafts because we cannot support them:

- "No competitor does X." The earlier version of this document listed five gaps "the research found no
  competitor doing". That research did not cover the SAP-specialist vendors, so the statement was
  untested. It is withdrawn.
- "Write-back to SAP" as a proven differentiator. For on-premise SAP it is in the code behind a switch and
  has not been run against a live SAP system (DR-2).

## 5. What the competitors do better

Written for the buyer's benefit; every item here is a reason a customer could choose someone else.

- **Production track record at SAP scale.** SAP Information Steward, SAP MDG, Syniti, Winshuttle and SNP
  have years of production use at large SAP estates, with reference customers, partner ecosystems and
  support organisations. Meridian has pilots and an internal acceptance run on synthetic data; this package
  contains no production reference, and nothing in it has been shown running against a live SAP system
  (DR-1).
- **Supported extraction.** SAP's own tools and the migration vendors read SAP through supported
  interfaces (Data Services, ODP extractors, transformation tooling installed in SAP). Meridian reads
  on-premise SAP through `RFC_READ_TABLE`, which SAP does not release for customer use and which many
  Basis teams refuse in production (PC-1).
- **Writing to SAP.** Loading corrected and migrated data into SAP at volume is the core business of
  Syniti, Winshuttle and SNP, and SAP MDG owns the create and change process itself. Meridian exports a
  load file today; its BAPI write-back covers material, customer, business partner and (where it is a
  business partner) vendor, and is not proven against a live system or at volume.
- **Migration execution.** Syniti and SNP move the data, convert systems and carve out companies.
  Meridian measures readiness and certifies waves; it does not migrate.
- **Governance of creation.** SAP MDG stops bad master data at the point of entry with workflow inside
  SAP. Meridian finds and fixes bad data after the fact.
- **Breadth beyond SAP.** Informatica, Collibra and Ataccama cover the whole enterprise estate with a
  catalogue, lineage and MDM across systems; Monte Carlo and Soda cover warehouses and lakehouses
  (Snowflake, Databricks, BigQuery). Meridian is SAP plus file upload only.
- **Learned monitoring.** Observability tools lead with learned anomaly monitors. Meridian's checks are
  declared rules; its statistical layer (`checks/anomaly.py`, `checks/outliers.py`,
  `/api/v1/mining/anomalies`) is secondary.
- **Enterprise assurance.** The established vendors offer certifications (for example SOC 2 or ISO 27001
  for their cloud services; buyer to confirm per vendor), multi-tenant operation, SAP partnership or resale
  (SAP resells Syniti's migration product), and 24x7 support. Meridian holds no certification
  (`docs/PRODUCTION_READINESS.md`), is single-tenant in code today (DR-4), and depends on one principal
  engineer ([provenance.md](provenance.md)).
- **Scale evidence.** Meridian's largest measured analysis hit a 6 hour limit at 2.78 million issues before
  a rework that has not been re-measured (D-24).
