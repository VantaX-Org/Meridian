# Meridian transition-to-sustain pack

## Purpose

This pack hands Meridian over from the delivery team to the support team and business as usual. It is written for a support team that has never seen Meridian. After working through it, that team can run, monitor, fix, update, back up and restore the customer deployment, and knows when to escalate.

The pack does not repeat the existing product and operations documents. It links to them and adds the support-side material they do not cover: who does what, how incidents move between support levels, and what is still open.

Where the repository does not state a fact, the pack says "To confirm" and names the role that owns the answer. Targets such as response times are marked "proposed, to agree" because the repository defines none.

## Scope

The pack covers every component of the customer deployment:

- api, worker, beat and frontend (the application)
- nginx (the front door)
- db (PostgreSQL) and redis
- storage (Garage object storage, which replaced MinIO)
- ollama (the optional local language model overlay)
- the aletheia sidecar (the Aletheia engine)
- the updater sidecar
- licensing (the Meridian licence and the Aletheia licence)

## How to use the pack

Read the documents in this order:

| Order | Document | Use it to |
|---|---|---|
| 1 | [service-overview.md](service-overview.md) | Learn what each component does and how they connect |
| 2 | [support-model.md](support-model.md) | Learn who handles what, severity levels and escalation |
| 3 | [runbooks.md](runbooks.md) | Carry out routine and recovery tasks step by step |
| 4 | [monitoring-and-alerting.md](monitoring-and-alerting.md) | Know what to watch and what each alert means |
| 5 | [known-issues.md](known-issues.md) | Recognise open defects, limits and debt before raising them as new incidents |
| 6 | [change-and-release-management.md](change-and-release-management.md) | Plan and apply updates safely |
| 7 | [access-and-security-operations.md](access-and-security-operations.md) | Manage users, credentials, licences and vulnerability alerts |
| 8 | [backup-and-dr.md](backup-and-dr.md) | Back up, restore and recover from loss of the host |
| 9 | [knowledge-transfer-plan.md](knowledge-transfer-plan.md) | Plan training, shadowing and the hand-over sign-off |
| 10 | [data-subject-coverage.md](data-subject-coverage.md) | See which stores a data-subject request covers and what to handle by hand |

During an incident, go straight to [runbooks.md](runbooks.md) and [support-model.md](support-model.md).

## Main source documents

These existing documents remain the detailed reference. The pack links to them throughout.

- [docs/customer-deployment.md](../customer-deployment.md): install and configuration of the customer deployment
- [docs/meridian-update-guide.md](../meridian-update-guide.md): updates and rollback
- [docs/troubleshooting.md](../troubleshooting.md): symptom-based troubleshooting (some commands in it are out of date; see [known-issues.md](known-issues.md))
- [docs/ops/monitoring.md](../ops/monitoring.md): Prometheus, Alertmanager and Grafana
- [docs/ops/backup-restore.md](../ops/backup-restore.md): backup and restore scripts
- [docs/diligence/operations.md](../diligence/operations.md): operational posture summary
- [docs/diligence/roadmap-and-debt.md](../diligence/roadmap-and-debt.md): open debt register
- [docs/admin-training/](../admin-training/): Meridian administrator training
- [docs/journeys/](../journeys/): end-to-end user journeys, including the go-live acceptance test

## Exit criteria

The hand-over is complete when every item below is true and the sign-off table is signed.

1. The support team has completed the knowledge-transfer checklist in [knowledge-transfer-plan.md](knowledge-transfer-plan.md), including the shadow and reverse-shadow periods.
2. The support model in [support-model.md](support-model.md) is agreed: the L1, L2 and L3 split, the RACI, severity levels, targets, support hours and escalation contacts. Every "proposed, to agree" value is either agreed or replaced.
3. Monitoring is enabled on the customer deployment and alerts reach an agreed receiver (see [monitoring-and-alerting.md](monitoring-and-alerting.md)).
4. A scheduled backup is installed, copies leave the host, and one restore drill has passed with its duration recorded (see [backup-and-dr.md](backup-and-dr.md)).
5. The support team has carried out one update with `scripts/update.sh` and one rollback, on a non-production deployment or under supervision (see [change-and-release-management.md](change-and-release-management.md)).
6. A signed-in tester has run [docs/journeys/go-live-acceptance-test.md](../journeys/go-live-acceptance-test.md) on the customer deployment and the result is recorded.
7. Every item in [known-issues.md](known-issues.md) has an owner role and an agreed handling: accepted, workaround documented, or scheduled for a fix.
8. Every "To confirm" item in this pack is either answered or accepted as open with an owner role.

## Sign-off

| Role | Responsibility at sign-off | Name | Date | Signature |
|---|---|---|---|---|
| Customer service owner | Accepts the service into business as usual | | | |
| Meridian administrator (customer) | Confirms day-to-day administration can be run | | | |
| Customer infrastructure or hosting team | Confirms host, backup and monitoring operation | | | |
| Basis team | Confirms SAP connection and authorisation support | | | |
| L1 service desk lead | Confirms triage and routing are understood | | | |
| L2 support lead | Confirms runbooks can be executed | | | |
| Vendor engineering (L3) | Confirms escalation path and open items are handed over | | | |
| Vendor delivery lead | Confirms delivery is complete against the exit criteria | | | |
