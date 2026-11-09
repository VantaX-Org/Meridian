# Knowledge transfer plan

This plan moves knowledge of Meridian from the delivery team to the support team. It uses the training material already in the repository and adds shadow and reverse-shadow periods, a checklist and a sign-off. It is complete when exit criterion 1 in [README.md](README.md) is met.

Durations, dates and attendees are proposed, to agree (owner: customer service owner with the vendor delivery lead). Do not record personal names in this file. Keep the attendee list in the customer's service management tool.

## Audiences

| Audience | Needs to be able to | Main material |
|---|---|---|
| L1 service desk | Triage, capture the error reference, answer "how do I" questions, route | User guide, help videos, [support-model.md](support-model.md), [known-issues.md](known-issues.md) |
| Meridian administrator (L2) | Run, monitor, update, back up, restore and administer the deployment | Administrator training (all modules), this pack |
| Customer infrastructure or hosting team | Host, Docker, disk, backups, off-host copies, monitoring, certificates | Administrator training Modules 1 and 9, [backup-and-dr.md](backup-and-dr.md), [monitoring-and-alerting.md](monitoring-and-alerting.md) |
| Basis team | SAP connections, RFC user and role, failed extractions, authorisation errors | Administrator training Modules 4 and 11, Basis journey, role template |
| Customer security team | Sign-in, SSO, SCIM, secrets, vulnerability handling, data-subject requests | [access-and-security-operations.md](access-and-security-operations.md), security documents |
| Customer service owner | Approvals, severities, targets, sign-off | [support-model.md](support-model.md), [change-and-release-management.md](change-and-release-management.md) |

## Training material

Link to these documents; do not copy them.

### Administrator training

[docs/admin-training/meridian-administrator-training.md](../admin-training/meridian-administrator-training.md) (also as `meridian-administrator-training.pdf`). Each module has learning objectives, steps, checks and an exercise.

| Module | Topic | Audiences |
|---|---|---|
| 1 | Install and first start | Meridian administrator, infrastructure team |
| 2 | Licence | Meridian administrator |
| 3 | Users and access | Meridian administrator, security team |
| 4 | Connecting SAP | Meridian administrator, Basis team |
| 5 | Extraction, runs and schedules | Meridian administrator, Basis team |
| 6 | Scoring and money | Meridian administrator, L1 service desk |
| 7 | Fixing data and write-back | Meridian administrator, L1 service desk |
| 8 | Notifications and integrations | Meridian administrator |
| 9 | Operations | Meridian administrator, infrastructure team |
| 10 | Troubleshooting | Meridian administrator, L1 service desk |
| 11 | Prove the numbers | Basis team, Meridian administrator |

### User guide and help videos

- [frontend/docs/guide/](../../frontend/docs/guide/): one chapter per area of the product, including `administration.md`, `monitoring.md`, `systems.md`, `runs.md`, `schedules.md`, the role guides `persona-*.md` and `glossary.md`. The printable guide for all roles is `meridian-guide.pdf`.
- [docs/help-videos.md](../help-videos.md): how the help recordings are made. The help panel in the product plays one recording per guide chapter. The recordings show demo data only (debt row DR-1), so practise on the customer deployment as well.

### Journeys

[docs/journeys/](../journeys/README.md) describes end-to-end work by role. The ones most useful for support:

- [basis-operations.md](../journeys/basis-operations.md): connections, extraction paths, failed jobs, authorisation errors, schedules
- [first-live-week.md](../journeys/first-live-week.md): from an empty host to a first proved run
- [go-live-acceptance-test.md](../journeys/go-live-acceptance-test.md): the checklist a signed-in tester runs after each release
- [by-role.md](../journeys/by-role.md) and [by-object.md](../journeys/by-object.md): what each role and object involves
- [find-fix-approve-send.md](../journeys/find-fix-approve-send.md), [monthly-governance.md](../journeys/monthly-governance.md), [migration-wave.md](../journeys/migration-wave.md), [new-master-data-request.md](../journeys/new-master-data-request.md), [audit.md](../journeys/audit.md): business journeys L1 will be asked about

### Operations documents

[docs/meridian-update-guide.md](../meridian-update-guide.md), [docs/ops/backup-restore.md](../ops/backup-restore.md), [docs/ops/monitoring.md](../ops/monitoring.md), [docs/ops/pilot-upgrade-runbook.md](../ops/pilot-upgrade-runbook.md), [docs/customer-deployment.md](../customer-deployment.md), and this pack.

## Phases

| Phase | Proposed length (to agree) | Who does the work | Who watches | Goal |
|---|---|---|---|---|
| 1. Training sessions | 1 to 2 weeks | Vendor engineering and the delivery team present | Support team | The support team knows the material |
| 2. Shadow | 2 weeks | Delivery team carries out the tasks | Support team watches and takes notes | The support team sees real tasks on the customer deployment |
| 3. Reverse shadow | 2 weeks | Support team carries out the tasks | Delivery team watches and corrects | The support team proves it can do the tasks alone |
| 4. Sign-off | After phase 3 | Customer service owner | All roles in the README sign-off table | Hand-over accepted |

The project's hyper-care period (cutover plan, section 6) may overlap phases 2 and 3. Its length is To confirm (owner: project sponsor) in [docs/project/cutover-and-go-live-plan.md](../project/cutover-and-go-live-plan.md).

If a checklist task is not met in reverse shadow, repeat it in a further reverse-shadow week. Do not sign off with an unmet task unless the customer service owner accepts it as open, with an owner role.

## Proposed training sessions

| Session | Content | Audiences | Material |
|---|---|---|---|
| 1 | Architecture and components | All | [service-overview.md](service-overview.md) |
| 2 | Support model, severities, escalation, known issues | All | [support-model.md](support-model.md), [known-issues.md](known-issues.md) |
| 3 | Install, licence, users and access | Administrator, infrastructure, security | Modules 1 to 3, [access-and-security-operations.md](access-and-security-operations.md) |
| 4 | SAP connections, extraction, runs, schedules, proving the numbers | Administrator, Basis | Modules 4, 5 and 11, Basis journey |
| 5 | Scores, fixes, write-back, notifications | Administrator, L1 | Modules 6 to 8, user guide |
| 6 | Operations: health, logs, updates, rollback | Administrator, infrastructure | Module 9, runbooks 1 to 3 and 12, [change-and-release-management.md](change-and-release-management.md) |
| 7 | Backup, restore, drill, DR | Administrator, infrastructure | [backup-and-dr.md](backup-and-dr.md), runbook 4 |
| 8 | Monitoring and alerts | Administrator, infrastructure | [monitoring-and-alerting.md](monitoring-and-alerting.md) |
| 9 | Troubleshooting walk-through | Administrator, L1 | Module 10, runbooks 10 and 11 |

Each session ends with the exercise from the matching training module, done on a non-production deployment where one exists. Whether a non-production deployment is available for practice: To confirm (owner: customer infrastructure or hosting team).

## Checklist

Record each task as done in shadow (S) and done in reverse shadow (R), with the date. The task is complete when R is recorded.

### Runbooks

| # | Task | S | R |
|---|---|---|---|
| 1 | [Health check](runbooks.md#1-health-check) | | |
| 2 | [Start, stop and restart](runbooks.md#2-start-stop-and-restart) | | |
| 3 | [Update with update.sh and roll back](runbooks.md#3-update-with-updatesh-and-roll-back) | | |
| 4 | [Back up and restore](runbooks.md#4-back-up-and-restore) | | |
| 5 | [Rotate credentials](runbooks.md#5-rotate-credentials) | | |
| 6 | [Check or renew the Meridian licence](runbooks.md#6-check-or-renew-the-meridian-licence) | | |
| 7 | [Check or renew the Aletheia licence](runbooks.md#7-check-or-renew-the-aletheia-licence) | | |
| 8 | [Add or disable a user](runbooks.md#8-add-or-disable-a-user) | | |
| 9 | [Reconnect SAP](runbooks.md#9-reconnect-sap) | | |
| 10 | [Re-run a failed extraction or analysis](runbooks.md#10-re-run-a-failed-extraction-or-analysis) | | |
| 11 | [Clear disk and manage retention](runbooks.md#11-clear-disk-and-manage-retention) | | |
| 12 | [Read logs](runbooks.md#12-read-logs) | | |

### Operations

| Task | S | R |
|---|---|---|
| Check Operations, Jobs for active extractions, syncs and analyses before a change (the freeze rule) | | |
| Read the release notes for a release and list its migrations and configuration changes | | |
| Carry out one update with `scripts/update.sh`, on non-production or under supervision | | |
| Carry out one rollback with `scripts/update.sh --rollback`, and explain when the pre-update dump is needed | | |
| Run the verification steps from the release notes after an update | | |
| Run `scripts/restore.sh --drill` on a recent backup and record the result and duration | | |
| Confirm the scheduled backup ran and a copy left the host | | |
| Explain the disaster recovery steps from [backup-and-dr.md](backup-and-dr.md) | | |
| Read the alert rules and say the first response to each | | |
| Download a diagnostics bundle and check its content before sending | | |
| Find a server error in the api log from its error reference | | |
| Read Administration, Licence and Administration, Aletheia engine and explain each status | | |

### Access and SAP

| Task | S | R |
|---|---|---|
| Invite a user, scope a grant and disable a user | | |
| Find `auth.login_failed` and `auth.lockout` rows in the audit log for a locked account | | |
| Rotate a SCIM token or create and revoke an API key, if used | | |
| Run a SAP connection test and route an authorisation error to the Basis team | | |
| Re-run a failed extraction after the cause is fixed | | |

### Service

| Task | S | R |
|---|---|---|
| Triage three sample incidents to a severity and route them (L1) | | |
| Answer three sample "how do I" questions from the user guide (L1) | | |
| Recognise three items from [known-issues.md](known-issues.md) as known (L1) | | |
| Raise one escalation to vendor engineering with all items from the escalation list in [support-model.md](support-model.md) | | |
| Watch or take part in a signed-in run of [go-live-acceptance-test.md](../journeys/go-live-acceptance-test.md), and record the result | | |

## Hand-over of open items

Before sign-off, the delivery team walks the support team through:

- every row in [known-issues.md](known-issues.md), with the agreed handling;
- every "To confirm" item in this pack, with its owner role and current answer;
- the RAID log and decision log in [docs/project/](../project/README.md).

## Sign-off

Sign-off uses the table in [README.md](README.md). The customer service owner signs last, after the checklist above is complete and the other exit criteria are met.
