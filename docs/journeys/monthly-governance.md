# Journey: monthly governance

Once a month the programme lead prepares the steering committee: how the scores moved, which owners and stewards are
behind on their work, and the executive digest that goes out on its own every month after.

- **Roles**: programme lead; data owners (their overdue approvals); stewards (their overdue rows); the administrator,
  because only someone with manage settings can set up a digest.
- **Trigger**: month end, a week before the steering committee.
- **Done**: the lead knows the score movement since last month and its causes, every overdue owner or steward has been
  told, the board pack is scheduled for the committee, and an executive digest sends itself each month.
- **Target**: 20 minutes and 10 clicks (measured: see the
  [friction audit](friction-audit.md#measured-clicks-against-targets)).

## 1. Score trend

| # | Address | Control | Result |
|---|---|---|---|
| 1.1 | `/runs` | **Runs** in the map | The run timeline and the table; the baseline labelled |
| 1.2 | `/run/{id}` | The latest run's date | The run |
| 1.3 | same | **Compare with**: the run of a month ago; **Compare** | `/run/{a}/vs/{b}`: "12 of 15 objects scored higher and 3 lower. 14 rules started failing and 37 stopped." By object: measured, change, shown, New, Fixed, Worse, Better |
| 1.4 | `/o/{system}/{object}/runs` | An object, **Runs** tab | That object's trend run by run |

The run timeline in the top bar does the same: pick a run, **Compare with…**. For a document, Reports, **Create a
report**, **Trend report (PDF)** ([F31](friction-audit.md#findings)).

## 2. Owners' and stewards' overdue work

| # | Address | Control | Result |
|---|---|---|---|
| 2.1 | `/people` | **People** in the map | "4 of 6 people hold open work: 270 records, 34 overdue. 2 batches wait for your approval." Per person: open work, approvals waiting, **Overdue**, SLA met, breaches |
| 2.2 | `/people?open=person:{id}` | The person | Their objects, open work by object, the batches waiting for their approval |
| 2.3 | `/work?filter=open&assigned={id}` | **Open their work** | Their rows (all open, not only the overdue) ([F30](friction-audit.md#findings)) |
| 2.4 | same | **Assign…** to move rows, or People, **Balance work**, **Propose a plan**, apply with undo | Work spread |
| 2.5 | `/work?open=triage` | **Triage and SLA**, **Escalation chain** | Who is told after an SLA breach |

**Decision**: chase, rebalance or escalate. There is no "remind" action: the lead tells the person outside the
product or with a comment mention on a record or batch.

## 3. The steering committee pack

| # | Address | Control | Result |
|---|---|---|---|
| 3.1 | `/reports` | Account menu, **Reports** | Reports and schedules |
| 3.2 | `/reports?open=schedule:new` | **Schedule a report**: **Board pack (PDF)**, **Which run** "The latest finished run", cadence monthly, recipients; **Save the schedule** | The schedule with its next run |
| 3.3 | same | **Run it now** | Built on the worker and delivered; the next scheduled run is unchanged |

## 4. The executive digest

| # | Who | Address | Control | Result |
|---|---|---|---|---|
| 4.1 | Lead | `/admin/digests` | Not in the lead's Administration index; typed directly it reads "Managing digests needs the manage settings permission. Ask an administrator to grant it." ([F29](friction-audit.md#findings)) | Dead end |
| 4.2 | Administrator | `/admin/digests` | **Add a digest**: for the role Programme lead / CIO or a wave, cadence, channel (email, alert channel, webhook) | "Monday leadership digest, Role: Programme lead / CIO, Mondays at 07:00 UTC" |

**Hand-off lead to administrator**: outside Meridian.

## Hand-offs at a glance

| From | To | What | How they hear today |
|---|---|---|---|
| Lead | Overdue steward or owner | Catch up | SLA at risk and SLA breached notices go to them automatically; nothing from the lead in the product |
| Lead | Administrator | Set up a digest | Outside Meridian |
| Schedule | Steering committee | Board pack | Email or channel delivery |
