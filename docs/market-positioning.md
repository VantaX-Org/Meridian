# Market positioning: what we can and cannot claim

Written from cited research (Oct 2026). Every number here is checkable; the "do not
claim" section exists because several plausible-sounding claims do not survive
scrutiny.

## What is actually ours, and verifiable in the repository

| claim | evidence |
|---|---|
| **8,380 validation rules** | `checks/rules/**/*.yaml`, counted now (5,623 hand-authored + 2,757 DDIC-derived); machine-checked against the tree by `tests/checks/test_claim_hygiene.py` — these numbers cannot go stale silently |
| 5,623 hand-authored + 2,757 DDIC-derived | `checks/rules/<cat>/<module>.yaml` + `<module>.generated.yaml` |
| **45 modules** | the packs on disk |
| **21 check classes** | `checks/runner.py::REGISTRY` |
| **6 DQS dimensions** (DAMA DMBOK) | `api/services/scoring.py::DEFAULT_WEIGHTS` |
| every rule **proved** to fail ≥1 and pass ≥1 record | `tests/checks/test_rule_proofs.py` — 10,109 cases |
| every rule field **resolves** in the SAP dictionary | `tests/checks/test_rule_integrity.py` — 1,955 cases |
| rules reconciled against a curated dictionary | `checks/rule_reconciler.py` — 0 drift across its curated 31-table dictionary; it does **not** yet cover the 587-table bundle the engine runs on (repointing is the open item, not a claim) |
| runs **entirely inside the customer boundary** | no egress in the data path; self-hosted compose |

The proof harness is the genuinely unusual asset. It is not a rule *count* — it is
evidence that each rule discriminates, which is the thing a count cannot tell you.

## The competitive picture

**Only three vendors publish a rule count at all:**

| vendor | product | published count |
|---|---|---|
| [CDQ](https://www.cdq.com/platform/data-quality-rules) | CDQ Suite | "over 2,600 ready-to-use data quality rules" |
| [DQOps](https://github.com/dqops/dqo) | DQOps (open source) | "around 150 predefined checks" |
| SAP | MDG Data Quality Management | none — a rule-authoring/mining framework, not a numbered library |

SAP (Migration Cockpit), Syniti, Natuvion, SNP, cbs, Precisely, Informatica, Ataccama,
Collibra, Datagaps, IBsolution and JiVS all ship prebuilt content and **publish no rule
count**. So a head-to-head rule count has almost no one to compare against — and where it
does (CDQ, 2,600), the units are not the same thing.

**No analyst source names a market leader for SAP data quality or migration.** The
placements that exist are for *general* augmented data quality:
[Informatica](https://www.informatica.com/data-quality-magic-quadrant.html),
[Ataccama](https://www.ataccama.com/news/ataccama-named-a-leader-in-2026-gartner-magic-quadrant-for-augmented-data-quality-solutions-for-the-fifth-consecutive-time)
and [IBM](https://www.ibm.com/es-es/new/announcements/ibm-named-a-leader-in-the-2026-gartner-magic-quadrant-for-augmented-data-quality-solutions)
are 2026 Gartner MQ leaders; Ataccama also leads Forrester's first Data Quality Wave
(Q1 2026). [ISG's 2026 Data Integrity guide](https://research.isg-one.com/hubfs/crm-properties-file-values/ISG_Buyers_Guide_Data_Integrity_2026_Executive_Summary.pdf?hsLang=en)
ranks Salesforce, IBM and **SAP** top three overall, calls SAP a Leader for MDM, and
rates Syniti "Innovative" — not a leader.

### Where a rule library can credibly differentiate

1. **Depth proved, rule by rule.** Every competitor publishes a count or nothing. We can
   publish the proof: per-rule fixtures showing one failing and one passing record. That
   is a real, checkable difference and it is already in this repository.
2. **SAP-semantic content.** Field, check-table, domain and authorisation-aware rules
   derived from the customer's *own* DDIC — Precisely and Syniti compete on exactly this
   axis ("packaging SAP knowledge, not writing faster rules").
3. **Migration scenario specificity.** Selective transition, carve-out, greenfield and
   brownfield differ in which rules matter; a library that says which rules apply to which
   scenario is more useful than a bigger flat list.
4. **Local/regulatory reference data.** CDQ's 70 reference sources are a genuine moat and
   the hardest thing here to match. Do not pretend otherwise.

## Claims to avoid

| do not say | why |
|---|---|
| "analysts name us the market leader for SAP data quality" | no analyst ranks SAP DQ/migration vendors; the MQs are for general ADQ |
| "Syniti is a Gartner MQ leader" | verifiable placement is **Visionary** (2022 DQ MQ); ISG 2026 says "Innovative" |
| "SAP ships N prebuilt data-quality rules" | SAP publishes no count; MDG DQM is authoring/mining |
| comparing rule counts head-to-head | DQOps "checks" (~150), CDQ "rules" (2,600), Informatica "rule specifications" — different units |
| "Informatica has an SAP-specific rule bundle" | its published bundles are country/region/industry only |
| presenting CDQ's defect benchmark as independent research | it is a vendor benchmark (50% of BP records with critical violations, 14% duplicates, 18% outdated within a year) |
| "no benchmark exists for rules needed per migration" | correct, and worth saying plainly rather than implying one |

## The honest one-line positioning

> A customer-deployed SAP data-quality engine whose **8,380 rules are each proved against
> fixtures and reconciled against the customer's own data dictionary** — with no data
> leaving the customer's environment.

The differentiator is the evidence, not the volume. Volume is the easy claim and the
least defensible one.
