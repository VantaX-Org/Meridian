# Product brief

Who Meridian is for, what it is for, and the principles its screens follow. Folded in from the root
`PRODUCT.md` (an input to the design work before the cut-over to Meridian 2); the parts that described the
retired interface have been dropped. The design system itself is `frontend/DESIGN.md`.

## Users

- **Data stewards (primary).** Master-data owners who work the failing records, fix them and approve
  golden records. Long sessions on an office desktop next to SAP GUI, reading hundreds of SAP identifiers a
  day (material numbers, vendor keys, plant codes).
- **Programme leads, consultants and data leads.** They run assessments, read the verdict and present it
  to a sponsor: the landscape, the object receipt, run comparison, readiness and reports.
- **Data owners.** They approve fix batches (four eyes) and own exceptions.
- **SAP Basis and administrators.** They connect systems, schedule extractions, manage users, rules,
  scoring and the licence. Infrequent, task-focused visits.

## Purpose

Meridian measures and improves SAP data quality inside the customer's own environment. It reads SAP
tables and configuration, evaluates deterministic checks at each record's true grain, scores six DAMA
dimensions into a data quality score, and routes every failing record to someone who can fix it. Fixes
leave the product as load files; live write-back to SAP is limited and in progress (see
[diligence/architecture.md](diligence/architecture.md), section 2, and DR-2 in
[diligence/roadmap-and-debt.md](diligence/roadmap-and-debt.md)).

## Operating context

- Office daylight, large desktop monitors, long working sessions; laptops and projectors for consultants.
- Dense tabular work: filtering, sorting, opening a record, copying a key into SAP GUI.
- A phone is a glance surface: is the run finished, what is critical.

## Commitments

- Every figure traces to its rule, field and records.
- Plain language over vendor jargon; SAP terms used exactly as SAP uses them.
- No customer or server names in product copy, screenshots or commits.
- Nothing leaves the customer boundary except the licence check (key and machine fingerprint).

## Principles

1. Records over decoration: show the failing records, not a picture of them.
2. Colour means a defect state, never ornament.
3. One click from any number to the rows behind it.
4. The steward's keyboard path is first class.
5. Quiet by default, loud only where something is critical.
6. A false positive always carries a reason; no AI sentence without its rule, count and sample.

## Accessibility

WCAG 2.1 AA is the audited level ([accessibility/audit-2026-10.md](accessibility/audit-2026-10.md)), with
full keyboard operation, visible focus, reduced motion respected, tabular figures for every number, and
identifiers set so 0 and O, 1, l and I never collide.
