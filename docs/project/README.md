# Project documents

This folder holds the project document set for the Meridian SAP data-quality platform at the customer deployment. Each document states facts taken from this repository and its git history. Where a fact is not in the repository, the document says "To confirm" and names the role that owns the answer.

Release notes are in [docs/releases/](../releases/README.md). The hand-over to the support team is in [docs/sustain/README.md](../sustain/README.md).

## Documents

| Document | Purpose |
|---|---|
| [project-charter.md](project-charter.md) | Purpose, objectives, scope, licensed modules, stakeholders and success criteria |
| [requirements-traceability.md](requirements-traceability.md) | Each capability, where it is built and how it is tested |
| [solution-design-summary.md](solution-design-summary.md) | Short design summary with links to the full architecture and security documents |
| [test-strategy-and-report.md](test-strategy-and-report.md) | Test layers, counts and current test state |
| [cutover-and-go-live-plan.md](cutover-and-go-live-plan.md) | Pre-checks, freeze, deployment, verification, rollback and hyper-care |
| [raid-log.md](raid-log.md) | Risks, assumptions, issues and dependencies |
| [decision-log.md](decision-log.md) | Decisions found in the repository and git history |
| [project-closure-report.md](project-closure-report.md) | Delivery against objectives, open items, lessons learned and sign-off |

## Document status

All documents were written on 9 November 2026 against branch `chore/go-live-and-no-dependabot` (PR #639). The last release tag at that time was v0.0.632.

| Document | Status | Approver role |
|---|---|---|
| project-charter.md | Draft for review | Project sponsor |
| requirements-traceability.md | Draft for review | Product owner |
| solution-design-summary.md | Draft for review | Engineering lead |
| test-strategy-and-report.md | Draft. The signed-in go-live acceptance run is still to be done. | Test lead |
| cutover-and-go-live-plan.md | Draft for review | Release manager |
| raid-log.md | Live document | Project manager |
| decision-log.md | Live document | Project manager |
| project-closure-report.md | Draft. Sign-off is open. | Project sponsor |

## How to keep these documents current

- Update the RAID log and the decision log when an item changes. Give the date and the commit or PR that is the evidence.
- Update the traceability table when a capability gains or loses a module or a test file.
- Do not add customer names, server names, addresses, personal names or secrets. Use roles and "the customer deployment".
