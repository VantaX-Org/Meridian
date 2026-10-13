# Meridian — Patentability and Commercial Viability Assessment

**Date:** 2026-10-13
**Purpose:** Pre-filing assessment for a patent application via GlobalIPCo (South African provisional, with a view to PCT).
**Basis:** Read-only review of the `main` branch at commit `0b1dc69` (426 commits since 2026-10-04), the architecture and product docs, and a first-pass prior-art search (web and patent abstracts; no professional search yet).
**Status:** Technical opinion only. This is not legal advice; a registered patent attorney must confirm the conclusions before filing.

---

## 1. Verdict

**Patentable: yes, for three to four specific mechanisms. Not for "the platform".**

Meridian as a whole (an SAP data-quality platform with scoring, MDM, process mining and AI narrative) is not patentable: most of it is conventional and the "abstract idea / business method" exclusions in every major jurisdiction would catch a broad claim. What *is* plausibly patentable is a small set of concrete technical mechanisms that (a) no prior art found so far describes, (b) produce a measurable technical effect (fewer false findings, correct scoring denominator, deterministic cost attribution), and (c) are specific enough to be claimed.

**Commercially viable: yes, with the value coming from PCT/EP/US rather than the South African grant itself.** A South African patent is not examined for novelty and is only tested if enforced; its main uses are priority date, investor and partner signalling, and a cheap base for PCT. The commercial case rests on the SAP master-data and S/4HANA-migration market (master-data-management market estimated at roughly USD 22–24 bn in 2026 across several analysts), where the incumbents (Syniti, Informatica, SAP MDG, Precisely, Celonis/Signavio) validate against static rules or compare configuration between systems, not against the live customizing the way Meridian does.

**Recommendation:** file one South African provisional specification with a broad-but-specific disclosure covering inventions A–D below, then decide on PCT within 12 months once a professional prior-art search has been done on inventions A and B. Fix the four defects in section 5 before the complete specification is drafted so the description matches working code.

---

## 2. Candidate inventions, ranked

Ranking is by (novelty found in the code review) × (absence of prior art in the first-pass search) × (claimability).

### A. Configuration-derived field-status rules with suppression of generic rules — **strongest**

*Where:* `sap/field_status_config.py`, `checks/field_status_rules.py`, `checks/types/field_status_check.py`, `checks/runner.py::_frame_inputs`.

*What it does.* Reads the source SAP system's own field-selection customizing (T077K/T077D status strings; T130F/T130A/T134/T137 for material master) and resolves which field-selection definition governs each status segment from the system's own metadata tables (TMODO/TMODU), by table ownership and position-length fit, refusing to generate when the binding is ambiguous. It then (i) generates required/suppressed validation rules scoped per account group or material-type×industry pair, decoding the `+ - . *` status characters with SAP's priority order, and (ii) runs the inverse: every other rule on a field the configuration hides for a given group gets that group's records removed from its population (`hidden_by_field_status`), so a field that cannot be maintained in the SAP UI is never reported as a defect.

*Why it matters technically.* Conventional tools (and Meridian before this) treat "mandatory" as a static boolean. The data dictionary and the rule library disagreed silently. This mechanism replaces guesswork with the customer's own configuration and removes a whole class of false positives.

*Prior art found.* None. Syniti's "field groups" and SAP Information Steward do not derive rules from field-status customizing (first-pass search). SAP's own US 8,135,659 compares configuration between two systems to find process variants; it does not use configuration to drive data validation. EP 2615574 (null-exclusion from the denominator) is the nearest scoring analogue and is weaker and generic.

*Claim shape.* Method: obtaining field-selection configuration records; resolving the controlling definition from metadata by ownership and length constraint; generating group-scoped validation rules; and excluding from the evaluated population of any other rule the records whose group suppresses the field. Dependent claims: the refusal-when-ambiguous step; the material-master priority merge; the statistical fallback with provenance (`LIVE_SPRO > INFERRED > DICTIONARY`).

### B. Document-value cost attribution of master-data defects — **strong**

*Where:* `api/services/proven_cost.py`.

*What it does.* Computes money at risk using only actual document values from the extract (GR/IR variances, blocked sales orders, duplicate payments, late purchase orders), and only counts a document when it carries both a transactional symptom and a master-data root cause (e.g. a GR/IR quantity variance only counts when the PO unit differs from the base unit and the MARM conversion is missing). Findings are attached to documents by key-subset matching (all subsets of the document's master key, ≤4 fields, looked up against an index of failing record keys), so a defect is only attributed when its whole key is contained in the document's key.

*Prior art found.* Cost-of-poor-quality estimates are everywhere but are rate-based (Monte Carlo, Anomalo, Meridian's own earlier planner). No prior art found for deterministic attribution of ledger values to specific master-data defects by key containment.

*Claim shape.* Method: extracting transactional documents and master records; identifying a symptom per document from document fields; identifying a master-data cause from the master record referenced by the document; attributing a monetary amount from the document only when both are present; indexing failing record keys and matching documents to findings by key-subset containment.

### C. Configuration-gated applicability with a tri-state fail-safe denominator — **strong, pairs with A**

*Where:* `api/services/config_applicability.py`, `checks/config_applicability.yaml`, `checks/runner.py::_unmaintained`, `api/services/scoring.py`.

*What it does.* A rule's applicability is judged from live configuration objects with three states: `applies` (object read, condition met), `does_not_apply` (object read, condition not met), `applies_by_default` (object not read or failed) and `not_available` (system without a config API). Only positive evidence switches a rule off. The score denominator is "applicable rules" rolled up onto the L1/L2 process hierarchy. Separately, a non-critical presence check that fails ≥99.9% of ≥50 rows is reclassified as one "field unmaintained" observation rather than N defects, and folded into not-applicable rather than the defect count or the coverage denominator.

*Prior art found.* EP 2615574 revises scores by excluding null records from the denominator; it has no configuration evidence, no tri-state, no process roll-up and no safeguards. Nothing else close.

*Claim shape.* Method: for each rule, reading a configuration object, classifying applicability into the four states, computing the score over applicable rules only, and reclassifying near-total presence failures into a single systemic observation subject to severity and population-size safeguards.

### D. Reference-anchored process discovery with a combined mining + data-quality BPMN export — **moderate**

*Where:* `api/services/process_discovery/` (`generate.py::_Index.place`, `mining.py`), `api/services/bpmn_export.py`, `api/services/process_writer.py`.

*What it does.* Mines events from SAP tables and change documents, then places each mined activity onto a fixed SAP L1–L5 reference hierarchy by a deterministic policy (known L5 → new L5 under declared L4 → synthetic "discovered" branch), lifts variant statistics to every level, and exports one BPMN where each task carries both process-mining metrics and the data-quality status of the master-data fields that task uses. The conformance metric treats same-order activities as alternatives.

*Prior art found.* The mining itself (DFG, variants, happy path) is conventional and Celonis holds a patent family on event-log generation from ERP data (currently being litigated against SAP). The novelty is narrow: the placement policy, the multi-level roll-up, and the DQ overlay on the same hierarchy. Treat as dependent claims or a second application; do not lead with it.

### E. Secondary material (include in the description, do not claim independently)

- **Grain resolution over a declared relationship graph that forbids fan-out** and **cascading, counted, self-exempting population exclusions** (`checks/frames.py`, `checks/population.py`). Technical, useful as dependent claims under C.
- **Tolerance-gated critical cap and coverage-aware composite** (`api/services/scoring.py`). Weighted scoring is conventional; the tolerance gate and "not measured" state are small differentiators.
- **Counterfactual DQS projection through the production scoring engine** (`analytics_engine.py::project_dqs`) and **fix simulation with side-effect detection** (`fix_simulation.py`). Good dependent claims under C.
- **Set-intersection root cause** (`checks/root_cause.py`): bad data vs bad configuration by intersecting flagged values with configured values. Clean idea, but today the "configured" set is itself inferred from transactional data, so the evidence is circular (see section 5).
- **Wrong-field detection typed by DDIC data element** (`checks/value_placement.py`). US 10,614,056 and the "misfielded values" literature are close; low standalone value.

### F. Not patentable / do not claim

Config Intelligence Layer 1–3 as it stands (distinct-value inventories, fixed-code process steps, 20% funnel drop, severity-weighted health score, rand multipliers), Z-object baselining (EMA anomaly detection), the rule-coverage matrix, the precision/recall benchmark, the DQS weighting formula, the frontend, the licence control plane and the LLM narrative layer. These are conventional or are abstract business logic.

---

## 3. Eligibility by jurisdiction

| Jurisdiction | Test | Outlook for A–C |
|---|---|---|
| **South Africa** | s25(2)(e) excludes programs "as such" (s25(3)); no examination, no case law | Will be granted on formalities. Validity only tested on enforcement. Draft as a computer-implemented *method operating on an ERP system's configuration and data*, not as software. |
| **EPO** | Technical character + technical effect over prior art (G-II 3.3) | A and C have a defensible technical effect: fewer erroneous validation results and a correct evaluation denominator, derived from machine-read system configuration. Business-method framing ("cost", "readiness") must be avoided in independent claims; B should be framed as data linkage, not as a financial calculation. |
| **USPTO** | Alice/Mayo; Dec-2025 MPEP alignment with *Ex parte Desjardins* favours claims that recite a concrete improvement in how the system operates | A and C are the best candidates. Recite the improvement in the claim itself (population exclusion, denominator), not only in the specification. |

Risk rating: A and C moderate eligibility risk, B moderate-to-high (money is a red flag; claim the attribution mechanism), D low standalone value.

---

## 4. Commercial viability

**For:**
- The S/4HANA migration wave and SAP's 2027/2030 ECC maintenance deadlines put master-data readiness on every SAP customer's critical path; the MDM market is estimated at USD 22–24 bn in 2026 with mid-teens growth.
- Incumbents validate against static rules or compare configuration across landscapes. Configuration-derived validation (A) and a configuration-gated score (C) are the product's actual differentiators and are what a buyer would be told is "patent pending".
- A pending application with a PCT route is tangible for investors, SAP partner negotiations (PartnerEdge, Store listing) and enterprise procurement, which asks about IP.
- Defensive value: Celonis v SAP shows the process-mining neighbourhood is litigious; owning claims on the data-quality side of the hierarchy gives something to cross-license.

**Against:**
- A South African grant alone is a weak signal because it is unexamined.
- Full PCT → EP + US prosecution for one family is typically a mid five-figure USD commitment over 3–5 years; two families roughly double it.
- Enforcement against Syniti/Informatica/SAP is not realistic for a company of this size; the value is deterrence and licensing, not litigation.
- Patents disclose. Publishing A tells competitors exactly how to read TMODO/TMODU. Trade secret is the alternative for A if the company prefers secrecy; it cannot be both.

**Net:** viable as a priority-securing provisional now, with the PCT decision taken at month 10–11 against pilot traction and funding.

---

## 5. Defects to fix before the complete specification

The specification must describe a working embodiment. These gaps were found in the code review:

1. **T004F (FI/GL field-status variant) is not read.** The docstrings in `sap/field_status.py` and `sap/field_status_inference.py` still say the field-status tables are not read at all; `field_status_config.py` reads the vendor/customer/material ones. Either implement T004F or scope the GL claims out.
2. **Number-range health check never fires:** `alignment_validator._check_number_range_health` matches `"% consumed"` but discovery writes `"% util"`. Fix or drop from the description.
3. **Root-cause evidence is circular and stale:** `root_cause.py` uses a config inventory inferred from transactional data (any used value counts as configured) and the inventory from the *previous* run (queued after checks). To claim bad-data-vs-bad-config, point it at `config_snapshots` (live customizing) and run it after the config sync.
4. **Inferred field-status decoders are deliberately empty** (`_FIELD_SELECTION_DECODERS`), so the "smart" cascade only ever uses the live decoder or the dictionary. Either wire it or describe the cascade as implemented.

None of these block a provisional; all of them should be closed before PCT.

---

## 6. Questions that decide the filing (answer before drafting)

1. **Disclosure history.** Has any of A–D been shown outside the company without an NDA (Komatsu pilot, demos, conference, website, LinkedIn, the public repo)? Europe and South Africa require absolute novelty; the US has a one-year grace period. The exact earliest date matters.
2. **Inventors.** Who conceived each mechanism (people, not the company)? Patents require named human inventors; code written with AI assistance is fine but the inventive contribution must be attributable to a person.
3. **Applicant.** Which legal entity files (VantaX? a subsidiary?) and do all inventors have signed IP assignments?
4. **Jurisdictions and budget.** SA provisional only, or SA provisional + PCT at 12 months? Target countries for national phase (EP, US, DE, UK, AU, IN?).
5. **Secrecy vs patent for A.** Is the company willing to publish the TMODO/TMODU resolution method?
6. **GlobalIPCo scope.** Are they drafting the specification or only filing? If only filing, a patent attorney must draft the claims; what is below is a drafting brief, not a filing-ready specification.

---

## 7. Proposed application package (to be produced on approval)

1. **Invention disclosure document** per invention A–D: problem, prior approaches, mechanism, drawings, advantages, variants, with file and function references for the attorney.
2. **Provisional specification draft:** title, field, background, summary, detailed description with embodiments for A, B, C (D as a further embodiment), at least 6 figures (system architecture, field-status resolution flow, population exclusion, applicability state machine, cost attribution key-subset matching, process placement).
3. **Draft claim set:** 3 independent method claims (A, B, C), mirrored system and computer-readable-medium claims, ~20 dependents.
4. **Prior-art list** with the references found so far and the gaps a professional search must close (SAP SE, Syniti, Informatica, Celonis families; CPC G06F 16/215, G06F 16/23, G06Q 10/06).
5. **GlobalIPCo form details:** applicant, inventors, title, abstract (≤150 words), classification suggestion, priority claim (none), and the confidentiality note for pilot customers.
6. **Housekeeping:** the four code fixes in section 5, with tests, so the specification matches `main`.

---

## Sources consulted

- [SAP US 8,135,659 — configuration comparison to identify process variation](https://patents.justia.com/patent/20100082518)
- [EP 2615574 A1 — Data quality analysis (scorecards, null exclusion)](https://patents.google.com/patent/EP2615574A1/en)
- [US 9,558,230 — Data quality assessment](https://patents.google.com/patent/US9558230)
- [US 11,327,935 — Intelligent data quality (Accenture, S/4HANA migration profiling)](https://patents.google.com/patent/US11327935)
- [US 10,614,056 — Automated detection of incorrect data](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10614056)
- [Celonis patent claims against SAP](https://www.processexcellencenetwork.com/process-mining/news/celonis-files-2-patent-claims-against-sap)
- [USPTO §101 reset for 2026 (Desjardins alignment)](https://www.venable.com/insights/publications/2025/12/the-101-reset-for-2026)
- [EPO computer-implemented inventions, 2026 review](https://www.iam-media.com/review/the-patent-prosecution-review/2026/article/specialist-chapter-overcoming-patentability-challenges-computer-implemented-inventions-the-epo)
- [Software patenting in South Africa (s25(2)(e) and s25(3))](https://www.lexology.com/library/detail.aspx?g=8e087748-c50d-49e9-b89e-24316d36933f)
- [South African patent system (provisional, non-examining)](https://en.wikipedia.org/wiki/South_African_patent_system)
- [Master Data Management market 2026 (Research and Markets)](https://www.researchandmarkets.com/reports/5790847/master-data-management-market-report)
- [Master Data Management market 2026 (Mordor Intelligence)](https://www.mordorintelligence.com/industry-reports/master-data-management-market)
