# Systems

A system is one SAP or cloud source Meridian reads from: ECC, S/4HANA on premise or Cloud, Extended Warehouse Management, SuccessFactors, Concur, Ariba or BTP. Meridian reads from SAP and never writes to it. The system canvas is where SAP Basis connects a system, tests it, extracts with a scope, schedules extractions, loads the configuration and reviews custom objects. Open a system from its heading on the landscape or the map (`/s/{id}`); connect a new one from the command line ("Connect a system") or at `/s/new`.

## Connect a system

"Meridian reads from SAP and never writes to it. Enter the connection, test it, and connect. Then extract the objects you want checked."

1. Name the system, choose the **System type** and the **Environment** (Production, Quality, Development).
2. Fill in the connection. For ECC and S/4HANA on premise: **Host**, **Client** (3 digits), **Instance number** (2 digits) and an optional **User** ("Leave empty to use the deployment's default RFC user"), then the password under **Sign-in secrets**. Cloud systems ask for their base URL and OAuth details instead.
3. **Test connection**. A passing test reads like "RFC connection succeeded (client 100, 41 ms)".
4. **Connect system**. "You can connect now and test later. Nothing is read from SAP until you extract."

## The system canvas

The header gives the health ("Connected"), the type and protocol ("ECC, RFC"), the last extraction and its records, and the last connection test. **Test, load or extract** opens the system inspector; **Connection settings** opens the connection editor. Five views:

- **Overview**: "What the latest run scored", object by object, and **Recent jobs** from the job registry.
- **Extractions**: the stored extractions of this system and whether each was analysed.
- **Configuration**: the configuration Meridian read from the system's customising tables, by area (enterprise structure, financial accounting, controlling, materials management and so on), each with "Loaded, 3 of 3 objects" and what it found, such as "4 company codes, 11 plants". **Load again**, **Discover now**, the **Drift log** and **Compare with target** (the target system chosen in the connection settings, or the SAP standard baseline). A table that could not be read says why, for example "T500P: No authorisation to read this table. The user needs read access to it."
- **Schedules**: "Each schedule extracts the object again and re-runs its checks, so trends and alerts see every run. Times are UTC." Add a schedule with an object, a rhythm (daily, weekly, monthly, hourly or a custom cron) and a mode: **Full extraction** or **Changes only**. "Changes only reads the records SAP changed since the last download, with a full download at least once a week." Pause or delete a schedule from its row.
- **Custom objects**: "Custom (Z) objects found across every connected system in this workspace, from the latest analysis." Facts (custom objects, active anomalies, ghost and dormant, mapped to standard), **Detect now**, and the registry, anomalies, ghost, dormant, drift, rules and mapping views. Open a Z object to map it to its standard equivalent or add a Z rule.

## Extract with a scope

In the system inspector, **Extract** asks for the objects and the scope: "Choose objects to set the scope: company codes, plants, organisations and a date window." With no filter the scope reads "Scope: everything, no organisational filter." The same extraction form under Administration, Runs and jobs adds company codes, plants, a document date window and **Analyse straight after extracting**, which scores the new extraction when it lands.

**Dry run** shows "What an extraction of 3 objects would read, without reading it": the rows per table last time and an estimated duration, in the form "rows in tables, about a duration (this system's recent speed, rows a second)". Where the system has no recent extraction the speed reads "an assumed speed". From there **Extract changes only** starts a delta extraction that reads the change documents since the last download, where the system supports it; otherwise the reason is shown.

**Run analysis on ECC production** scores a stored extraction against the rules as they stand now. "Earlier scores are kept as they were."

## The numbers and where they come from

- **Records** is what the last extraction stored, across every object.
- **Configuration** counts areas loaded out of those the connector knows, for example "11 of 12 areas".
- The dry run counts rows from the last extraction of each table; a table never extracted is not counted and says so.

## What you can do, by role

- **SAP Basis** (manage systems, trigger sync): connect, test, rotate credentials, extract, dry run, delta, schedule, load configuration, remove a system.
- **Analyst and programme lead** (analyse, trigger sync where granted): run analysis, extract.
- **Rule maintainers** (manage rules): edit a custom object's registry entry, add a Z rule.
- **Everyone else**: read.

## Keyboard

- `⌘K`, then "connect", opens Connect a system.
- In every table, `j` and `k` move and `Enter` opens.
- `Esc` closes the inspector.

## When something is wrong

- **"Sign-in refused"** or **HTTP 401**: the user or secret is wrong or expired. Open **Connection settings**, type the new values ("Stored secrets are never shown. Type new values to replace them; an empty field keeps the stored one.") and test again.
- **"No authorisation to read this table. The user needs read access to it."** Grant the RFC user read access to that table in SAP (S_TABU_DIS or S_TABU_NAM), then **Load again**.
- **"The table does not exist in this release. Nothing to fix."** Expected on some releases.
- **"This system is extracted but no rule has run on it. Run an analysis."** Use Run analysis.
- **"Testing, loading and extracting need the trigger sync permission on this system."** Ask your administrator for a grant on that system.
- **A schedule did not run**: due runs start within 5 minutes of their time; check Runs, Jobs for a failed extraction.
