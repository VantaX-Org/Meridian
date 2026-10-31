# Journey: Basis operations

SAP Basis keeps the plumbing healthy: connections, extraction paths, failed jobs, authorisation errors and schedules.
Meridian reads with a read-only role and writes back only where an administrator turned on live write-back, through a
separate SAP user.

- **Roles**: SAP Basis (manage systems, trigger sync); the administrator for platform health; the programme lead for
  which objects to extract.
- **Trigger**: the start of the day; a **Failed jobs to triage** count above 0; an authorisation error; a schedule
  that did not run; a request to extract a new object.
- **Done**: every system reads **Connected**, **Failed jobs to triage** reads 0 open, no new authorisation error, and
  every object of the programme has a schedule.
- **Target**: 10 minutes a day; 3 clicks from the start screen to the fix of one incident (measured: see the
  [friction audit](friction-audit.md#measured-clicks-against-targets)).

## 1. Read the Basis home

| # | Address | Control | Result |
|---|---|---|---|
| 1.1 | `/` | Sign in | The Basis home above the coverage matrix: **Your next work**, **Connections**, **Last extraction**, **Failed jobs to triage**, **Authorisation errors**, **Schedules** |

Read in this order: Connections ("Refused the credentials"), Failed jobs to triage ("1 open"), Authorisation
errors, then the task list. The next-step button names the system that needs you first, for example **Extract
SuccessFactors** ([F20](friction-audit.md#findings)).

## 2. A refused credential (HTTP 401)

| # | Address | Control | Result |
|---|---|---|---|
| 2.1 | `/?open=job:{id}` | The job under **Failed jobs to triage** ("Extraction of Employee central") | The job inspector: stages, tables, "OData refused credentials (HTTP 401). Check the client id and secret in the system settings." |
| 2.2 | `/s/{id}` | **Open SuccessFactors** | The system canvas |
| 2.3 | `/s/{id}?open=connection:{id}` | **Connection settings** | The connection editor; "Stored secrets are never shown." |
| 2.4 | same | Type the new **Client ID** and **Client secret** (or **Rotate credentials**); **Test connection** | "Connected 47 ms. OData connection succeeded." |
| 2.5 | same | **Save changes** | "SuccessFactors is saved." |
| 2.6 | `/?open=job:{id}` | **Retry** on the failed job, or **Extract** in the system inspector | The job line shows progress |

Steps 2.1 to 2.3 take three clicks to reach the credentials ([F21](friction-audit.md#findings)).

**Decision**: credentials (rotate in SAP or the cloud tenant, leaves Meridian) or connection data (host, client,
token URL). Rotating the secret in the cloud tenant is outside Meridian.

## 3. A missing authorisation

| # | Address | Control | Result |
|---|---|---|---|
| 3.1 | `/` | A row under **Authorisation errors** | The job or connection test that was refused |
| 3.2 | SAP, SU53 and PFCG (leaves Meridian) | Read the failed check; add the table to the role from `docs/sap/authorisation-role-template.md` (S_TABU_NAM, or S_TABU_DIS) | The role grants read on the table |
| 3.3 | `/s/{id}?tab=configuration` or the system inspector | **Load again**, or **Extract** | The table reads |

**Decision**: grant the table, or change the reader. If the team refuses `RFC_READ_TABLE`, set **Table reader** to
`/BODS/RFC_READ_TABLE2`, `BBP_RFC_READ_TABLE` or **Find the first available**, or the **Extraction path** to **ODP,
table reader for the rest** (after confirming the licence allows it, SAP Note 3255746) or **OData through the SAP
Gateway** on S/4HANA on premise.

## 4. Extraction paths

| # | Address | Control | Result |
|---|---|---|---|
| 4.1 | `/` | **Connections**: the **Extraction path** column; **Last extraction**: **Read through** ("5 with the table reader") | Which path read which table |
| 4.2 | `/?open=job:{id}` | The **Read through** link | Per table: "ODP, 0MATERIAL_ATTR" or "Table reader" |

## 5. Schedules

| # | Address | Control | Result |
|---|---|---|---|
| 5.1 | `/` | Read **Schedules**: system, object, when, next run, mode | The rows are not links ([F23](friction-audit.md#findings)) |
| 5.2 | `/?open=system:{id}` | The system in **Connections** | The system inspector |
| 5.3 | `/s/{id}?tab=schedules` | **Schedule** | The Schedules view: "Times are UTC." |
| 5.4 | same | Add a schedule: object, rhythm (daily, weekly, monthly, hourly, custom cron), mode **Full extraction** or **Changes only**; pause or delete from the row | "Changes only reads the records SAP changed since the last download, with a full download at least once a week." |

**Wait**: due runs start within 5 minutes of their time. A schedule that did not start: Runs, **Jobs**
(`/runs?view=jobs`), and Administration, **Platform and updates**, **Health checks** for the background workers.

## 6. A new object to extract

| # | Address | Control | Result |
|---|---|---|---|
| 6.1 | `/?open=system:{id}` | **Extract**; tick the objects; **Dry run** | Rows per table, "about a duration (this system's recent speed, rows a second)" |
| 6.2 | same | **Extract 2 objects** (with **Analyse straight after extracting**) or **Extract changes only** | The job line |

## Hand-offs at a glance

| From | To | What | How they hear today |
|---|---|---|---|
| Worker | Basis | A job failed | The Basis home count; the status strip at the foot of every page; no inbox notice or email |
| Basis | SAP security team | A missing authorisation | Outside Meridian (SU53 output, a ticket) |
| Basis | Programme lead | The system is back | Nothing in the product; the lead sees the new run |
| Programme lead | Basis | Extract a new object | Outside Meridian, or a comment with `@` on the object |
