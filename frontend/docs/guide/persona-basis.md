# Walkthrough: SAP Basis

You keep the plumbing healthy: connections, extractions, schedules, configuration loads and the jobs that run them. Meridian reads from SAP with a read-only role; it writes back only where an administrator has turned on live write-back for material master, customer and business partner, through a separate SAP user. Your start screen is the **Landscape** with your own home above the coverage matrix: **Connections** (each system, its connection state and what the last test said), **Last extraction** (per system, with records and whether it was analysed), **Failed jobs to triage** (a job that failed and was not followed by a success of the same kind), **Authorisation errors** (refused credentials and missing authorisations among the connection tests and the jobs) and **Schedules** (system, object, when, next run and mode). The next step names the system that needs you first, for example "Extract SuccessFactors", and **Your next work** lists the system tasks.

## Your first five steps

1. **The Basis home**: read Connections, Failed jobs to triage and Authorisation errors first, then the task list: "Extract ECC production again", "Run analysis on S/4HANA sandbox", "Extract SuccessFactors".
2. **System**: open the system and **Test connection**. A passing test reads "RFC connection succeeded (client 100, 41 ms)".
3. **Dry run**: in the system inspector choose the objects, run **Dry run** and read the rows and duration; then **Extract**, or **Extract changes only** where available.
4. **Schedules**: add a schedule with a rhythm and the mode **Changes only** for routine runs.
5. **Runs**: watch the job line and open a failed job for its stages and **Retry**.

## Your jobs and where they are done

- **Test a connection, health**: System inspector, **Test connection**.
- **Extract objects**: System inspector, **Extract**.
- **Extraction dry run: row counts per table and a duration estimate**: System inspector, **Dry run**.
- **Delta extraction (changes only)**: System inspector, **Extract changes only**; schedules in **Changes only** mode.
- **Schedules, retry, cancel**: the system's Schedules view; Administration, Start and schedule.
- **Field mappings**: Administration, Field mappings.
- **The read-only SAP role and the table reader**: `docs/sap/authorisation-role-template.md` lists the S_RFC function modules and the S_TABU_NAM tables; `MERIDIAN_RFC_READ_FUNCTION` in `.env` chooses `RFC_READ_TABLE` (default), `/BODS/RFC_READ_TABLE2`, `BBP_RFC_READ_TABLE` or `auto`.
- **Load configuration and compare with the target**: the system's Configuration view.
- **Custom objects**: the system's Custom objects view.
- **Watch a system**: possible through the API only; the System inspector has no Watch button yet.

## The numbers you watch

- **Records** per extraction and per table, from the job registry; the Basis home's Last extraction shows the latest per system.
- **Failed jobs to triage** and **Authorisation errors** count what still needs you.
- **Areas loaded**, for example "11 of 12", and per area what could not be read and why.
- **Health checks** under Administration, Platform and updates.

## When something is wrong

- **HTTP 401 or "Sign-in refused"**: rotate the credentials in Connection settings and test again.
- **"No authorisation to read this table. The user needs read access to it."** Grant the RFC user read access from the role template, then **Load again**. SU53 shows the failed check.
- **The table reader is refused**: set `MERIDIAN_RFC_READ_FUNCTION` to the reader your role grants, or `auto`.
- **A scheduled extraction did not start**: due runs start within 5 minutes; check Runs, Jobs and the background workers health check.
- **Contact**: your administrator for permissions on a system; the programme lead for which objects to extract.
