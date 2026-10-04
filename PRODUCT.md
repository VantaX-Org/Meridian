<!-- impeccable:product-schema 1 -->
# Product

## Platform
web

## Users
- **Data stewards (primary).** Master-data owners who work findings, triage the queue, fix records and approve golden records. They spend long sessions in the product, usually on an office desktop next to SAP GUI, and read hundreds of SAP identifiers a day (material numbers, vendor keys, plant codes).
- **Consultants and data leads (secondary).** They run assessments, read the verdict and present the executive report to a sponsor. Their surfaces are the overview, the executive report and the process readiness views.
- **Administrators.** Configure systems, rules, scoring, users and the licence. Infrequent, task-focused visits.

_Confirmed: stewards come first; consultants present from the same surfaces._

## Product Purpose
Meridian measures and improves SAP master-data quality inside the customer's own environment. It reads SAP tables and customising, evaluates deterministic checks at each record's true grain, scores six DAMA dimensions into a data quality score (DQS), and routes every failing record to someone who can fix it.

## Positioning
An SAP-native data quality assessment that compares three things side by side: what the customer's configuration says, what SAP standard expects, and what an S/4HANA target will require. Every number traces to a check, a field and a list of record keys. Nothing leaves the customer boundary.

## Operating Context
- Office daylight, large desktop monitors, long working sessions; laptops for consultants in meeting rooms and on projectors.
- Dense tabular work: filtering, sorting, opening a record, copying a key into SAP GUI.
- Mobile is a glance surface only (is the run finished, what is critical).

## Capabilities and Constraints
- Next.js App Router frontend; data comes from the platform API only.
- Reads from SAP only. The product never writes to the customer's SAP.
- Runs on customer infrastructure; no third-party analytics or remote assets at runtime beyond the bundled fonts.
- Multi-system: ECC, S/4HANA, SuccessFactors and other SAP sources.

## Brand Commitments
- Every figure is traceable to its check, field and records.
- Plain language over vendor jargon; SAP terms are used exactly as SAP uses them.
- No customer or server names appear in product copy, screenshots or commits.

## Evidence on Hand
- 34 dashboard routes grouped into five workspaces (Command Centre, Data, Workbench, Process, Admin).
- An incumbent dark "Aurora" system (graphite navy with electric blue) and a legacy light layer, both treated as evidence rather than direction.
- Competitor benchmark (Syniti, SAP MDG, Stibo, Informatica, Ataccama, Collibra, Monte Carlo, Reltio, Anomalo). Reviewers call the category dated and dense; speed, keyboard support and evidence-backed findings are the open ground.

## Benchmark Bar
What the best tools do, and where Meridian stands. "Built" means in the frontend foundation; "Next" names the archetype batch and the backend it needs; "Stub" means no backend yet and the UI must say so.

| Bar | Seen in | Meridian |
|---|---|---|
| Each alert carries severity, blast radius, evidence and a recommended fix | Monte Carlo | Built: findings drawer shows records affected, why it matters, the SAP consequence and sample failing records |
| Cost of a defect, not just a count | Monte Carlo, Anomalo | Next (Register): `cost_at_risk`, `impact_score`, `sort=impact` from the cost-impact API |
| Learned anomalies beside rules | Anomalo, Monte Carlo | Next (Register): `finding_type=anomaly`, expected range against observed value |
| Good rows and bad rows side by side | Anomalo | Built in part: sample failing records; passing samples are a stub until the API returns them |
| AI-drafted rules reviewed before they apply | Ataccama | Next (Settings): rule authoring generate, dry run, drafts; lifecycle draft to retired with four eyes |
| Recommend, never auto-apply; every change auditable | Reltio | Next (Queue): remediation batches draft, approved, exported; Meridian never writes to SAP |
| Command palette, j/k, bulk select, inbox semantics | Linear-class tools | Built: command palette, keyboard row activation, bulk false positive with a required reason |

Rules taken from reviewer complaints:
- Every action one keystroke or one click from the list (against buried admin steps).
- Each error names the SAP object, the field and the next action (against cryptic errors).
- Digests by default, immediate only for critical (against noisy alerts; alert channels are a Settings batch input).
- Every chart opens a filtered work queue (against observe-only charts).
- No AI sentence without its rule, count and sample (against unexplained AI output).
- A false positive always carries a reason (the API now refuses one without a note).

## Product Principles
1. Records over decoration: show the failing records, not a picture of them.
2. Colour means a defect state, never ornament.
3. One click from any number to the rows behind it.
4. The steward's keyboard path is first class.
5. Quiet by default, loud only where something is critical.

## Accessibility
WCAG 2.2 AA. Full keyboard operation, visible focus, reduced motion respected, tabular figures for every number, and identifiers set so 0/O and 1/l/I never collide.
