# Project charter

## Purpose

The project delivers Meridian, an SAP data-quality platform, to the customer deployment. Meridian extracts master data from the connected SAP systems, checks it against rule packs, scores it, proposes and applies cleansing with approval, keeps monitoring it after cleansing, and exports it in the format of the target system's migration workbooks.

## Objectives

1. Extract master data from the customer's SAP ECC, S/4HANA and SuccessFactors systems without changing the source systems.
2. Check each licensed object against a deep rule pack. The repository README quotes 9,349 rules and 11,113 proof cases across all packs.
3. Give each run a data-quality score that a business user can trace back to rules and records.
4. Let users fix data through proposals, approvals and write-back, with an audit trail.
5. Keep monitoring the data after cleansing, and show the monitors in the user interface.
6. Produce migration output in the format of the target system's own workbooks.
7. Hand the platform to a support team with guides, training, videos and runbooks.

## Scope

### In scope

- Extraction, rules, scoring, cleansing, post-clean monitoring, migration workbooks, approvals, reporting and Aletheia insights for the licensed modules.
- Deployment with `docker/docker-compose.customer.yml` and updates with `scripts/update.sh`.
- The user guide, the 31 guided tour videos, the administrator training and the project and release documents.
- Hand-over to support. See [docs/sustain/README.md](../sustain/README.md).

### Out of scope

- Modules that the customer has not licensed. The code holds rule packs for other objects, but the licence limits use to the three modules below.
- Changes to the customer's SAP systems other than approved write-back.
- Hosting and operation of the server itself. The customer administrator owns the host.
- Loading data into the target system. Meridian prepares the workbook. The customer's load tool does the load.

## Licensed modules

| Module | Rule packs in the repository |
|---|---|
| Material master | `checks/rules/ecc/material_master.yaml` and `material_master.generated.yaml` |
| Customer master | `checks/rules/ecc/sd_customer_master*.yaml` |
| SuccessFactors | `checks/rules/successfactors/*.yaml` |

Narrowing the server and client licence to these three modules waits for the customer's go-ahead. See the [RAID log](raid-log.md).

## Stakeholders by role

| Role | Interest |
|---|---|
| Project sponsor | Business case, scope and final sign-off |
| Product owner | Priorities, acceptance of features, engine version choice |
| Project manager | Plan, RAID log, decision log |
| Engineering lead | Design, code quality, technical risks |
| Test lead | Test strategy and the go-live acceptance run |
| Release manager | Release build, version, cutover |
| Customer administrator | Server, `docker/.env`, backups, sudo actions |
| SAP Basis | SAP users, RFC access, transports |
| SAP functional team | Rule review, reconciliation, migration workbooks |
| Data owners and stewards | Fix approval and post-clean monitoring |
| Support team | Operation after hand-over |
| Licensor of the Aletheia engine | Grant of the mark, name and embedded engine |

Named people for each role: To confirm (Project manager).

## Success criteria

1. The signed-in go-live acceptance run in [docs/journeys/go-live-acceptance-test.md](../journeys/go-live-acceptance-test.md) passes sections 1 to 3 and is signed off. A fail in those sections stops the release.
2. A real workbook from the new system passes the load tool's own validation (section 4 of the acceptance test).
3. The release installs with `scripts/update.sh`, reports the expected version, reaches alembic head 149, returns status ok on `/health` and has no tracebacks in the API log.
4. The support team accepts the hand-over pack in [docs/sustain/README.md](../sustain/README.md).
5. The open items in the [RAID log](raid-log.md) have an owner and a date.

Target dates for these criteria: To confirm (Project manager).
