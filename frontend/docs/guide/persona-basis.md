# Walkthrough: SAP Basis

You keep the plumbing healthy: connections, extractions, schedules, configuration loads and the jobs that run them. Meridian reads from SAP and never writes to it. Your start screen is the **Landscape** with the system that needs you first as the next step, for example "Extract SuccessFactors", and **Your next work** as a list of system tasks.

## Your first five steps

1. **Landscape**: read the task list: "Extract ECC production again", "Run analysis on S/4HANA sandbox", "Extract SuccessFactors".
2. **System**: open the system and **Test connection**. A passing test reads "RFC connection succeeded (client 100, 41 ms)".
3. **Dry run**: in the system inspector choose the objects, run **Dry run** and read the rows and duration; then **Extract**, or **Extract changes only** where available.
4. **Schedules**: add a schedule with a rhythm and the mode **Changes only** for routine runs.
5. **Runs**: watch the job line and open a failed job for its stages and **Retry**.

## Your jobs and where they are done

- **Test a connection, health**: System inspector, **Test connection**.
- **Extract objects**: System inspector, **Extract**.
- **Extraction dry run: row counts per table and a duration estimate**: System inspector, **Dry run**.
- **Delta extraction (changes only)**: System inspector, **Extract changes only**; schedules in **Changes only** mode.
- **Schedules, retry, cancel**: the system's Schedules view; Administration, Runs and jobs.
- **Field mappings**: Administration, Field mappings.
- **Load configuration and compare with the target**: the system's Configuration view.
- **Custom objects**: the system's Custom objects view.
- **Watch a system**: possible through the API only; the System inspector has no Watch button yet.

## The numbers you watch

- **Records** per extraction and per table, from the job registry.
- **Areas loaded**, for example "11 of 12", and per area what could not be read and why.
- **Health checks** under Administration, Jobs and system update.

## When something is wrong

- **HTTP 401 or "Sign-in refused"**: rotate the credentials in Connection settings and test again.
- **"No authorisation to read this table. The user needs read access to it."** Grant the RFC user read access, then **Load again**.
- **A scheduled extraction did not start**: due runs start within 5 minutes; check Runs, Jobs and the background workers health check.
- **Contact**: your administrator for permissions on a system; the programme lead for which objects to extract.
