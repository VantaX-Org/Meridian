# Competitive gap analysis

This note compares Meridian with the products a buyer puts beside it when they choose an SAP data quality, master data or migration platform. It records where Meridian is ahead, where it matches the market and where it still falls short, and it ranks the gaps we should close next. It is based on the public product material of each vendor (product pages, documentation and release notes) read in November 2026, set against the Meridian code base on the same date. Where a vendor's claim could not be checked from public material, the row says so rather than guessing.

## Who we compared against

- **Syniti Knowledge Platform** (Migrate and Data Quality): the incumbent for large SAP migrations. Strong on construction workbenches, value mapping, pre-load validation and post-load reconciliation.
- **SAP Information Steward**: SAP's own profiling, validation rule and scorecard tool, with cleansing packages and match review for Data Services.
- **SAP Master Data Governance (MDG)**: SAP's governance layer: change requests, workflow, consolidation, mass processing, data quality rules and process analytics for change requests.
- **SAP S/4HANA Migration Cockpit**: SAP's load tool: migration objects, staging tables, simulation, value conversion and a predefined object sequence.
- **Informatica IDMC (Cloud Data Quality and MDM)**: broad profiling, address verification, matching and an MDM hub with SAP connectors.
- **Ataccama ONE**: data quality with anomaly detection, observability, reference data management and per-dimension thresholds.
- **Precisely Data360 and Automate Studio**: data quality plus SAP mass change through scripted transactions, and address and geocoding services.
- **Collibra Data Quality and Observability**: adaptive rules that learn behaviour, schema change and drift detection.
- **Datactics**: self-service rule studio, fuzzy matching and remediation queues.
- **Qlik Talend Data Quality**: a trust score per dataset and semantic types that recognise what a column holds.

## How to read the matrix

Each feature has one status. **Ahead** means Meridian does something the compared products do not do, or does it with evidence they do not show, such as naming the SAP field and check table behind every finding. **Parity** means Meridian does what the leading product does, at a comparable depth. **Gap** means at least one compared product does it and Meridian does not yet, or does it only in part. **Closed** marks a gap this branch closed.

## Feature matrix

| Area | Feature | Status | Notes |
|---|---|---|---|
| Rules | Deterministic DDIC-resolved rule packs across 29 modules | Ahead | Every rule names real SAP tables and fields resolved against the dictionary; no vendor ships a comparable SAP-native pack this size out of the box. |
| Rules | Rule versioning, dry run and rule mining from data | Parity | MDG rule mining and Ataccama rule suggestions do the same; Meridian keeps every suggestion deterministic. |
| Rules | Adaptive rules that learn normal behaviour | Parity | Collibra's adaptive rules are the reference; Meridian's anomaly and drift monitors cover the same ground with explainable thresholds. |
| Scoring | Six-dimension weighted score with critical caps | Ahead | Record-level pass rates and caps are stricter than the scorecards in Information Steward. |
| Scoring | Per-dimension Target, Warning and Critical thresholds | Gap | Ataccama and Information Steward let each dimension carry its own bands per object; Meridian has one tenant weighting and fixed bands. |
| Scoring | Trust score with semantic types | Gap | Talend recognises column meaning (email, IBAN, phone) and scores trust per dataset. Meridian knows SAP domains but not generic semantic types for non-SAP sources. |
| Cost | Cost of poor quality per finding | Ahead | Config impact maps findings to blocked SAP features and opportunity cost; no compared product ties findings to SAP features. |
| Governance | Change requests with workflow and SLA | Parity | Matches MDG change requests and multi-step approval. |
| Governance | Process analytics for change requests | Closed | MDG ships process analytics for change request cycle time and step dwell. Built on this branch (see below). |
| Governance | Data contracts | Ahead | Not offered in the SAP-focused tools; Collibra offers them for warehouses only. |
| Governance | Business glossary and lineage | Parity | Comparable to Collibra and Informatica for the SAP scope. |
| Governance | Reference data management | Parity | Comparable to Ataccama reference data. |
| Governance | Business-user data collection screens | Gap | Syniti and MDG let business users fill missing values in guided forms that write back to a staging record. Meridian has the stewardship queue but no structured collection form per object. |
| MDM | Match review and golden records | Parity | Matches Information Steward match review and Informatica MDM survivorship for SAP objects. |
| MDM | Address, email and phone verification | Gap | Informatica, Precisely and Information Steward verify addresses against postal reference data. Meridian checks format only. Needs a customer-hosted reference data source so data never leaves the site. |
| Cleansing | Cleansing queue with auto-fix and monitoring after the clean | Parity | Comparable to Datactics remediation and Syniti cleansing, with ongoing monitoring after every clean. |
| Migration | Waves, gates and go/no-go | Parity | Comparable to Syniti migration management. |
| Migration | Load simulation | Parity | Comparable to Migration Cockpit simulation. |
| Migration | Load sequencing derived from the dictionary | Closed | Migration Cockpit and Syniti ship a predefined object order. Meridian now derives it from the check tables of the fields each object's rules read, names the evidence for every dependency and blocks objects behind a no-go prerequisite. Built on this branch (see below). |
| Migration | Post-load reconciliation | Parity | Comparable to Syniti post-load reconciliation. |
| Migration | Source and target comparison | In progress | Covered on a sibling branch. |
| Monitoring | DDIC drift and schema change | Ahead | Collibra detects schema change in warehouses; Meridian detects it in the SAP dictionary itself, including Z objects. |
| Monitoring | DQ firewall on inbound records | Parity | Comparable to Ataccama and Informatica real-time validation. |
| Monitoring | Alerts to Slack and Teams | Gap | Collibra, Ataccama and Informatica post DQ alerts to chat. Meridian sends email and in-app notifications only. |
| Discovery | As-is process mining from SAP data | Ahead | Process detection from transactional data to L5 is not offered by the DQ vendors; it is closer to a process-mining product. |
| Discovery | Z-object intelligence | Ahead | No compared product classifies custom SAP objects and their data quality. |
| Delivery | Customer-hosted, data never leaves | Ahead | Most compared products are cloud first; Meridian runs entirely on the customer's own estate. |
| Delivery | Templates, export centre, admin and roles | In progress | Covered on sibling branches. |

## Gaps closed on this branch

**Load plan from the dictionary.** `GET /api/v1/migration/load-plan` returns the order in which the licensed migration objects must load. An object depends on another when a field its rules read has a check table the other object owns. Each dependency names the field, its DDIC text and the check table. A dependency is required when SAP refuses the record without the field, and a reference otherwise. Cycles are broken on reference dependencies, which load as a delta afterwards. Check tables no object owns are listed as prerequisites, split into configuration and outside master data by delivery class. The latest analysed migration run gives each object a go, no-go or not-run state, and every object that needs a no-go object through a required field is shown as blocked. The screen is at `/migration/load-plan`.

**Change request process analytics.** `GET /api/v1/governance/process-analytics` reports, for a window of 30 to 365 days and optionally one object, the median and 90th percentile cycle and approval times, the rejection, failure and cancellation rates, SLA breaches by step, the bottleneck step, the open backlog by age and the weekly flow. Every figure is counted from the tenant's change requests and workflow tasks, and percentiles are nearest-rank so each figure is a real request or task. The screen is at `/requests/analytics`.

## Ranked build list for the remaining gaps

1. **Per-dimension Target, Warning and Critical thresholds.** Let each object carry its own bands per dimension and colour every score against them. Small change to scoring and the ruler, large effect on how stewards read the product, and it is the first thing buyers coming from Ataccama or Information Steward look for.
2. **Business-user data collection screens.** A guided form per object that asks business owners for the missing values a rule found, writes them to a staged record, and sends the result through the existing change request workflow. Closes the last step between finding and fixing for non-specialists.
3. **Address, email and phone verification.** Verification against reference data that the customer hosts, so no record leaves the site. Start with email syntax and domain checks and phone numbering plans, which need no licensed data, then add postal reference files the customer loads.
4. **Slack and Teams alerts.** Post monitor breaches, SLA breaches and gate decisions to a chat channel through an outbound webhook the customer configures. Only aggregated figures are posted, never record data.
5. **Trust score with semantic types.** Recognise generic column meaning for non-SAP sources and give each dataset a trust score beside the DQS, so uploaded files and warehouse tables are scored as well as SAP tables.
