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
| Scoring | Trust score with semantic types | Ahead | Talend recognises column meaning and scores trust per dataset. Meridian now profiles every upload and external database load with deterministic detectors (IBAN with its mod 97 check, EU VAT, email, web address, date, phone, postal code, country, amount, person name), gives each column a confidence and a conformance share, scores trust from DQS, conformance, freshness and completeness with the weights shown, lets the user confirm or override a type with an audit entry, and turns confirmed types into suggested rules. Only shares are kept, never a value. Built on this branch (see below). |
| Cost | Cost of poor quality per finding | Ahead | Config impact maps findings to blocked SAP features and opportunity cost; no compared product ties findings to SAP features. |
| Governance | Change requests with workflow and SLA | Parity | Matches MDG change requests and multi-step approval. |
| Governance | Process analytics for change requests | Closed | MDG ships process analytics for change request cycle time and step dwell. Built on this branch (see below). |
| Governance | Data contracts | Ahead | Not offered in the SAP-focused tools; Collibra offers them for warehouses only. |
| Governance | Business glossary and lineage | Parity | Comparable to Collibra and Informatica for the SAP scope. |
| Governance | Reference data management | Parity | Comparable to Ataccama reference data. |
| Governance | Business-user data collection screens | Gap | Syniti and MDG let business users fill missing values in guided forms that write back to a staging record. Meridian has the stewardship queue but no structured collection form per object. |
| MDM | Match review and golden records | Parity | Matches Information Steward match review and Informatica MDM survivorship for SAP objects. |
| MDM | Address, email and phone verification | Closed | Informatica, Precisely and Information Steward verify addresses against postal reference data. Meridian now checks email syntax, disposable domains and, when switched on, the domain's mail server through the site's own resolver; phone numbers against the numbering plan of their country; postal codes against the format of their country; and city and region against a postal reference file the customer uploads. Every failing record carries its own reason and fixes go to the cleansing queue. Postal reference coverage depends on the file the customer loads. Built on this branch (see below). |
| Cleansing | Cleansing queue with auto-fix and monitoring after the clean | Parity | Comparable to Datactics remediation and Syniti cleansing, with ongoing monitoring after every clean. |
| Migration | Waves, gates and go/no-go | Parity | Comparable to Syniti migration management. |
| Migration | Load simulation | Parity | Comparable to Migration Cockpit simulation. |
| Migration | Load sequencing derived from the dictionary | Closed | Migration Cockpit and Syniti ship a predefined object order. Meridian now derives it from the check tables of the fields each object's rules read, names the evidence for every dependency and blocks objects behind a no-go prerequisite. Built on this branch (see below). |
| Migration | Post-load reconciliation | Parity | Comparable to Syniti post-load reconciliation. |
| Migration | Source and target comparison | In progress | Covered on a sibling branch. |
| Monitoring | DDIC drift and schema change | Ahead | Collibra detects schema change in warehouses; Meridian detects it in the SAP dictionary itself, including Z objects. |
| Monitoring | DQ firewall on inbound records | Parity | Comparable to Ataccama and Informatica real-time validation. |
| Monitoring | Alerts to Slack and Teams | Closed | Collibra, Ataccama and Informatica post DQ alerts to chat. Meridian now posts score drops, threshold breaches, failed runs, SLA breaches and firewall rejections to Slack and Teams. Webhook URLs live only in the worker's environment, messages carry counts and a link back only, pass the payload safety check and are held back in sandbox mode. Built on this branch (see below). |
| Discovery | As-is process mining from SAP data | Ahead | Process detection from transactional data to L5 is not offered by the DQ vendors; it is closer to a process-mining product. |
| Discovery | Z-object intelligence | Ahead | No compared product classifies custom SAP objects and their data quality. |
| Delivery | Customer-hosted, data never leaves | Ahead | Most compared products are cloud first; Meridian runs entirely on the customer's own estate. |
| Delivery | Templates, export centre, admin and roles | In progress | Covered on sibling branches. |

## Gaps closed on this branch

**Load plan from the dictionary.** `GET /api/v1/migration/load-plan` returns the order in which the licensed migration objects must load. An object depends on another when a field its rules read has a check table the other object owns. Each dependency names the field, its DDIC text and the check table. A dependency is required when SAP refuses the record without the field, and a reference otherwise. Cycles are broken on reference dependencies, which load as a delta afterwards. Check tables no object owns are listed as prerequisites, split into configuration and outside master data by delivery class. The latest analysed migration run gives each object a go, no-go or not-run state, and every object that needs a no-go object through a required field is shown as blocked. The screen is at `/migration/load-plan`.

**Change request process analytics.** `GET /api/v1/governance/process-analytics` reports, for a window of 30 to 365 days and optionally one object, the median and 90th percentile cycle and approval times, the rejection, failure and cancellation rates, SLA breaches by step, the bottleneck step, the open backlog by age and the weekly flow. Every figure is counted from the tenant's change requests and workflow tasks, and percentiles are nearest-rank so each figure is a real request or task. The screen is at `/requests/analytics`.

**Slack and Teams alerts.** `api/services/chat_alerts.py` formats each event as a Slack or Teams message with counts and a link back into Meridian, and `workers/tasks/chat_alerts.py` delivers it with soft and hard time limits and backoff retry. The URLs come only from `MERIDIAN_SLACK_WEBHOOK_URL` and `MERIDIAN_TEAMS_WEBHOOK_URL`. The admin Webhooks screen shows whether each channel is configured and which events go to chat, and sends a test. Tests: `tests/test_chat_alerts.py`.

**Email, phone and address verification.** `api/services/contact_verify.py` holds the checks, run as the rule packs BP900 to BP904 (business partner), SDCM900 to SDCM903 (customer master) and EC900 to EC903 (Employee Central, format checks only), plus the generated address rules against the uploaded postal reference. `GET /api/v1/contact-verification` (view) lists each rule's reasons, sampled records with their own reason and the fixes waiting in cleansing; `PUT /api/v1/contact-verification/settings` (manage_settings, audited) switches the mail server lookup. The screen is the Contact verification section of Admin. Tests: `tests/test_contact_verify.py`, `tests/test_contact_verification_route.py` and `design/v2/__tests__/ContactVerify.test.tsx`.

**Semantic types and trust score.** `api/services/semantic_types.py` profiles up to 20,000 rows of each upload and external database load. A type needs 80 percent of the filled values in its shape, or 60 percent when the header names it, and confidence falls for columns with fewer than 20 filled values. The trust score weighs DQS 40 percent, conformance 25, freshness 15 and completeness 20, and a missing part gives its weight to the others. `GET /api/v1/versions/{id}/semantic-types` (view) returns the columns, the score and the suggested rules; `PUT /api/v1/versions/{id}/semantic-types/{column}` (upload, audited, table `semantic_type_overrides` from migration 160) confirms or overrides a type. The section sits on the run page under the file's shape. Tests: `tests/test_semantic_types.py`, `tests/test_semantic_types_route.py` and `design/v2/__tests__/RunSemantics.test.tsx`.

## Ranked build list for the remaining gaps

1. **Per-dimension Target, Warning and Critical thresholds.** Let each object carry its own bands per dimension and colour every score against them. Small change to scoring and the ruler, large effect on how stewards read the product, and it is the first thing buyers coming from Ataccama or Information Steward look for.
2. **Business-user data collection screens.** A guided form per object that asks business owners for the missing values a rule found, writes them to a staged record, and sends the result through the existing change request workflow. Closes the last step between finding and fixing for non-specialists.
