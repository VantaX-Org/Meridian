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
| Rules | Rule versioning, dry run and rule mining from data | Ahead | Mined rules are reviewed against the SAP dictionary before approval: lift over the base rate (or the stated reason it cannot be derived), the DDIC anchor of each field, mined values the check table does not know, and a redundant flag when a check table such as T024D (keyed WERKS, DISPO) already enforces the rule. MDG rule mining and Ataccama suggestions give a confidence score with no dictionary check. |
| Rules | Adaptive rules that learn normal behaviour | Ahead | Every learned-monitor break explains itself: a robust z-score against prior runs, the field's DDIC domain and check table, and which codes appeared or vanished and whether they exist in the live check table. Collibra's adaptive rules give a score with no SAP context. |
| Scoring | Six-dimension weighted score with critical caps | Ahead | Record-level pass rates and caps are stricter than the scorecards in Information Steward. |
| Scoring | Per-dimension Target, Warning and Critical thresholds | Gap | Ataccama and Information Steward let each dimension carry its own bands per object; Meridian has one tenant weighting and fixed bands. |
| Scoring | Trust score with semantic types | Gap | Talend recognises column meaning (email, IBAN, phone) and scores trust per dataset. Meridian knows SAP domains but not generic semantic types for non-SAP sources. |
| Cost | Cost of poor quality per finding | Ahead | Config impact maps findings to blocked SAP features and opportunity cost; no compared product ties findings to SAP features. |
| Governance | Change requests with workflow and SLA | Ahead | Meridian forecasts when each open approval will be decided and how likely it is to breach its SLA, from real dwell times of the same object, kind and step, and shows the sample size behind every estimate. MDG workflows show SLA breaches only after they happen. |
| Governance | Process analytics for change requests | Closed | MDG ships process analytics for change request cycle time and step dwell. Built on this branch (see below). |
| Governance | Data contracts | Ahead | Not offered in the SAP-focused tools; Collibra offers them for warehouses only. |
| Governance | Business glossary and lineage | Ahead | Field-level SAP lineage per object: each extracted table and field with its DDIC text, data element, domain and length, its check table and the object that owns it (or configuration, with the delivery class), and the rules that read it. Fields the dictionary does not know are flagged, never guessed. Collibra and Informatica lineage stops at the table or column with no SAP foreign keys. |
| Governance | Reference data management | Ahead | Reference data shows how codes are actually used: orphan values in records with counts and fields, codes never used, and the share of records covered, all from field profiles and stated as lower bounds when value lists are truncated. Ataccama reference data manages the lists but does not measure their use in SAP records. |
| Governance | Business-user data collection screens | Gap | Syniti and MDG let business users fill missing values in guided forms that write back to a staging record. Meridian has the stewardship queue but no structured collection form per object. |
| MDM | Match review and golden records | Ahead | Survivorship rules can be previewed before they are saved: the same merge function is run over every stored cluster, each golden value that would change is listed, and each new value is checked against the DDIC length, fixed values and check table. Information Steward and Informatica MDM apply survivorship without a dictionary check of the winning value. |
| MDM | Address, email and phone verification | Gap | Informatica, Precisely and Information Steward verify addresses against postal reference data. Meridian checks format only. Needs a customer-hosted reference data source so data never leaves the site. |
| Cleansing | Cleansing queue with auto-fix and monitoring after the clean | Ahead | Every proposed value is checked against the SAP dictionary before it is applied: DDIC type, length, conversion exit, fixed values and check table (live configuration, else the SAP standard baseline), with a did-you-mean code. The queue states how many fixes are safe, how many SAP would reject and how many could not be checked. Datactics and Syniti apply fixes without that proof. |
| Migration | Waves, gates and go/no-go | Ahead | Each wave gate shows its actual value against the threshold, with the critical rules that fail it named by field and dictionary text. A deterministic least-squares forecast gives the date blocking findings reach zero, or says the wave is not converging. Syniti shows gate status without a forecast. |
| Migration | Load simulation | Ahead | Meridian simulates the target load per object from the S/4HANA dictionary: every record that would fail is grouped into a Migration-Cockpit-style message (for example MARA-MTART against check table T134, MAKT-MAKTX over CHAR 40) with sample keys. The check-table values to transport are listed with record counts, and marked provisional when measured against the SAP baseline rather than the live target. Migration Cockpit simulates only once data sits in staging on the target. |
| Migration | Load sequencing derived from the dictionary | Closed | Migration Cockpit and Syniti ship a predefined object order. Meridian now derives it from the check tables of the fields each object's rules read, names the evidence for every dependency and blocks objects behind a no-go prerequisite. Built on this branch (see below). |
| Migration | Post-load reconciliation | Ahead | Each post-load difference gets a cause from the target field's DDIC entry (conversion exit, case, mapping, truncation, number or date format, or a real difference). Only real differences count in the verdict, and users can filter to them. Syniti reconciliation reports every difference alike. |
| Migration | Source and target comparison | In progress | Covered on a sibling branch. |
| Monitoring | DDIC drift and schema change | Ahead | Collibra detects schema change in warehouses; Meridian detects it in the SAP dictionary itself, including Z objects. |
| Monitoring | DQ firewall on inbound records | Ahead | Each firewall failure carries SAP dictionary proof: DDIC type, length, conversion exit, fixed values and check table, with did-you-mean codes. Ataccama and Informatica real-time validation return rule failures with no SAP dictionary context. |
| Monitoring | Alerts to Slack and Teams | Gap | Collibra, Ataccama and Informatica post DQ alerts to chat. Meridian sends email and in-app notifications only. |
| Discovery | As-is process mining from SAP data | Ahead | Process detection from transactional data to L5 is not offered by the DQ vendors; it is closer to a process-mining product. |
| Discovery | Z-object intelligence | Ahead | No compared product classifies custom SAP objects and their data quality. |
| Delivery | Customer-hosted, data never leaves | Ahead | Most compared products are cloud first; Meridian runs entirely on the customer's own estate. |
| Delivery | Templates, export centre, admin and roles | In progress | Covered on sibling branches. |

## Gaps closed on this branch

**Load plan from the dictionary.** `GET /api/v1/migration/load-plan` returns the order in which the licensed migration objects must load. An object depends on another when a field its rules read has a check table the other object owns. Each dependency names the field, its DDIC text and the check table. A dependency is required when SAP refuses the record without the field, and a reference otherwise. Cycles are broken on reference dependencies, which load as a delta afterwards. Check tables no object owns are listed as prerequisites, split into configuration and outside master data by delivery class. The latest analysed migration run gives each object a go, no-go or not-run state, and every object that needs a no-go object through a required field is shown as blocked. The screen is at `/migration/load-plan`.

**Change request process analytics.** `GET /api/v1/governance/process-analytics` reports, for a window of 30 to 365 days and optionally one object, the median and 90th percentile cycle and approval times, the rejection, failure and cancellation rates, SLA breaches by step, the bottleneck step, the open backlog by age and the weekly flow. Every figure is counted from the tenant's change requests and workflow tasks, and percentiles are nearest-rank so each figure is a real request or task. The screen is at `/requests/analytics`.

## Moved from Parity to Ahead on this branch

Eleven features that matched the market now go past it. Each one adds SAP dictionary evidence or a forecast that the compared products do not show. All of the logic is deterministic and no SAP data is sent to a language model.

- **Rule mining review.** `GET /api/v1/learned-rules/review` gives each mined rule its lift, DDIC anchor, unknown values and a redundant flag. It is shown in the Dictionary review panel on the Rules tab.
- **Adaptive monitors.** `GET /api/v1/aletheia/monitors/{break_id}/evidence` explains each break with a robust z-score (median and MAD, threshold 3.5) and the field's dictionary context. It is shown as "Why this is a break" on Learned monitors.
- **Approval forecast.** `GET /api/v1/governance/approval-forecast` gives each open task a nearest-rank ETA and a breach probability, with its sample size. It is shown on Process analytics and in a Forecast column on Requests.
- **Field lineage.** `GET /api/v1/lineage/fields` lists each field of an object with its dictionary entry, check table, owning object and the rules that read it. It is shown on the object's Lineage tab.
- **Reference data usage.** `GET /api/v1/reference-data/lists/{list_id}/usage` reports orphan values, unused codes and coverage. It is shown in the Usage panel on Reference data.
- **Survivorship preview.** `POST /api/v1/survivorship-rules/preview` reruns the merge over stored clusters and checks each changed golden value against the dictionary. It is shown in the survivorship inspector.
- **Cleansing safety.** `GET /api/v1/cleaning/queue/safety` checks every proposed value with the shared dictionary check in `api/services/ddic_value_check.py`. It is shown in the Safety panel on the cleansing queue.
- **Wave gate evidence and forecast.** Each gate check returns its actual value, threshold and failing rules, and the cockpit returns a least-squares forecast of blocking findings. It is shown as Gate evidence in the wave cockpit.
- **Load simulation.** `GET /api/v1/migration/runs/{run_id}/load-simulation` groups would-fail records into dictionary messages and lists the configuration to transport. It is shown on the migration run detail.
- **Reconciliation causes.** Post-load records carry a cause and their DDIC entry, and `real_only` filters to real differences. It is shown in the post-load panel.
- **Firewall dictionary proof.** Each firewall failure carries the result of the shared dictionary check. It is shown in the SAP dictionary column on the entry gate.

## Ranked build list for the remaining gaps

1. **Per-dimension Target, Warning and Critical thresholds.** Let each object carry its own bands per dimension and colour every score against them. Small change to scoring and the ruler, large effect on how stewards read the product, and it is the first thing buyers coming from Ataccama or Information Steward look for.
2. **Business-user data collection screens.** A guided form per object that asks business owners for the missing values a rule found, writes them to a staged record, and sends the result through the existing change request workflow. Closes the last step between finding and fixing for non-specialists.
3. **Address, email and phone verification.** Verification against reference data that the customer hosts, so no record leaves the site. Start with email syntax and domain checks and phone numbering plans, which need no licensed data, then add postal reference files the customer loads.
4. **Slack and Teams alerts.** Post monitor breaches, SLA breaches and gate decisions to a chat channel through an outbound webhook the customer configures. Only aggregated figures are posted, never record data.
5. **Trust score with semantic types.** Recognise generic column meaning for non-SAP sources and give each dataset a trust score beside the DQS, so uploaded files and warehouse tables are scored as well as SAP tables.
