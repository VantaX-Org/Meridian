# Systems

A system is one SAP or cloud source Meridian reads from: ECC, S/4HANA on premise or Cloud, Extended Warehouse Management, SuccessFactors, Concur, Ariba or BTP. Meridian reads from SAP with a read-only role; live write-back is off unless an administrator turns it on (see the Approvals chapter). The system canvas is where SAP Basis connects a system, tests it, extracts with a scope, schedules extractions, loads the configuration and reviews custom objects. Open a system from its heading on the landscape or the map (`/s/{id}`); connect a new one from the command line ("Connect a system") or at `/s/new`. Every system is listed at `/s`.

## The systems list

`/s` opens **Systems**, with the sentence "2 systems connected." and either "Every connection answers." or how many "cannot be reached or signed in to". **Connect a system** opens the setup. A drawing shows which systems feed Meridian (on the left) and which receive from it (on the right), each name coloured by its health. Under it, **Connection health** lists every system: name, release or type and environment, the health (**Connected**, **Degraded**, **Unreachable**, **Sign-in failed** or **Not tested**), "Last sync" with its time or "Never synced", and the reason when the connection or the last sync is not healthy. Select a row to open the system in the inspector. With nothing connected the page says "No system is connected yet." with a link to connect one.

## Connect a system

`/s/new` opens **Set up Meridian**: "Setup only reads from SAP. Nothing is written to SAP until an approved batch is sent." Six steps run down the left, each ticked when done; a later step opens once the one before it is done. On the right, **What the first run will do** counts the systems, objects, tables and policy packs applied so far.

1. **Connect SAP**: the connection form below. Saving it moves to the next step.
2. **Connect SuccessFactors**: optional. Choose SuccessFactors as the system type, or **Skip for now**.
3. **Choose objects**: the objects the SAP system offers, each with its number of tables. Tick at least one, then **Continue**.
4. **Choose policy packs**: GxP, SOX and GDPR with their authority. Ticking a pack applies it at once; untick to remove it.
5. **Schedule runs**: the rhythm and mode, as on the Schedules view (the default is every night at 02:00, changes only). **Save schedule** creates one schedule for each chosen object.
6. **Invite people**: an email and a role (data steward, data owner, analyst or viewer) per line, **Add another**, then **Finish setup**. Empty lines are skipped.

"Setup complete" follows: "The first run starts on the schedule you set. Open the system to start it now." **Open the system** opens its canvas.

The connection form in step 1:

1. Name the system, choose the **System type** and the **Environment** (Production, Quality, Development).
2. Fill in the connection. For ECC and S/4HANA on premise: **Host**, **Client** (3 digits), **Instance number** (2 digits) and an optional **User** ("Leave empty to use the deployment's default RFC user"), then the password under **Sign-in secrets**. Cloud systems ask for their base URL and OAuth details instead.
3. For ECC, S/4HANA on premise and Extended Warehouse Management choose the **Extraction path** and the **Table reader** (see "Extraction path" below). The defaults, **Table reader** and **Deployment default**, read as before.
4. **Test connection**. A passing test reads like "RFC connection succeeded (client 100, 41 ms)".
5. **Connect system**. "You can connect now and test later. Nothing is read from SAP until you extract."

## Extraction path

How an ABAP system's tables are read, chosen in the connection settings:

- **Table reader**: "Reads each table with the table reader below. Needs read access to the tables."
- **ODP, table reader for the rest**: "Reads mapped tables through ODP providers (RODPS_REPL). Fields a provider does not carry are reported per table; other tables use the table reader." The providers are classic extractors such as `0MATERIAL_ATTR` (MARA), `0MAT_PLANT_ATTR` (MARC), `0CUSTOMER_ATTR` (KNA1), `0VENDOR_ATTR` (LFA1) and `0GL_ACCOUNT_ATTR` (SKA1), and on S/4HANA released CDS views such as `I_Product` and `I_BusinessPartner`.
- **Automatic: table reader**: "Reads with the table reader. ODP is used only when you choose it, after confirming with SAP that your licence allows it (SAP Note 3255746)."
- **OData through the SAP Gateway** (S/4HANA on premise only): "Reads through the released APIs your Gateway exposes, such as API_PRODUCT_SRV and API_BUSINESS_PARTNER, with this system's user." Enter the **Gateway base URL**; the system's client is sent as `sap-client`.

A table read with a date window, a scope or by parent keys always uses the table reader, because ODP reads a provider in full. The **Table reader** setting chooses `RFC_READ_TABLE`, `/BODS/RFC_READ_TABLE2` or `BBP_RFC_READ_TABLE`, or **Find the first available**.

Which path read each table is on the extraction job's **Tables** list (**Read through**, for example "ODP, 0MATERIAL_ATTR" or "Table reader") and on the Basis home: **Connections** shows each system's extraction path and **Last extraction** how its tables were read, such as "ODP: MARA; 4 with the table reader".

## The system canvas

The header gives the health ("Connected"), the type and protocol ("ECC, RFC"), the last extraction and its records, and the last connection test. **Test, load or extract** opens the system inspector; **Connection settings** opens the connection editor.

The banner under it says "State of the system" and puts the one thing to know in its headline: "An extraction from ECC production is running, 40% done", "The latest extraction from ECC production failed", "ECC production is connected", "The connection to ECC production has not been tested yet", or "The connection to ECC production needs attention". The line under it says when it was last extracted ("The last extraction was on 16 Oct 2026, 05:09." or "It has never been extracted."). Three figures: **Objects extracted**, **Extractions kept** ("to compare against") and **Objects scored** ("by the latest run"). Aletheia is docked on the right, as on every screen.

Five views:

- **Overview**: **Records per object**, a horizontal bar per object: "What the latest extraction, on 16 Oct 2026, 05:09, read from each object." Then "What the latest run scored", object by object, and **Recent jobs** from the job registry.
- **Extractions**: the stored extractions of this system and whether each was analysed.
- **Configuration**: the configuration Meridian read from the system's customising tables, by area (enterprise structure, financial accounting, controlling, materials management and so on), each with "Loaded, 3 of 3 objects" and what it found, such as "4 company codes, 11 plants". **Load again**, **Discover now**, the **Drift log** and **Compare with target** (the target system chosen in the connection settings, or the SAP standard baseline). A table that could not be read says why, for example "T500P: No authorisation to read this table. The user needs read access to it."
- **Schedules**: "Each schedule extracts the object again and re-runs its checks, so trends and alerts see every run. Times are UTC." Add a schedule with an object, a rhythm (daily, weekly, monthly, hourly or a custom cron) and a mode: **Full extraction** or **Changes only**. "Changes only reads the records SAP changed since the last download, with a full download at least once a week." Pause or delete a schedule from its row.
- **Custom objects**: "Custom (Z) objects found across every connected system in this workspace, from the latest analysis." Facts (custom objects, active anomalies, ghost and dormant, mapped to standard), **Detect now**, and the registry, anomalies, ghost, dormant, drift, rules and mapping views. Open a Z object to map it to its standard equivalent or add a Z rule.

## Extract with a scope

In the system inspector, **Extract** asks for the objects and the scope: "Choose objects to set the scope: company codes, plants, organisations and a date window." With no filter the scope reads "Scope: everything, no organisational filter." The same extraction form under Administration, Start and schedule adds company codes, plants, a document date window and **Analyse straight after extracting**, which scores the new extraction when it lands.

**Dry run** shows "What an extraction of 3 objects would read, without reading it": the rows per table last time and an estimated duration, in the form "rows in tables, about a duration (this system's recent speed, rows a second)". Where the system has no recent extraction the speed reads "an assumed speed". From there **Extract changes only** starts a delta extraction that reads the change documents since the last download, where the system supports it; otherwise the reason is shown.

**Run analysis on ECC production** scores a stored extraction against the rules as they stand now. "Earlier scores are kept as they were."

## The numbers and where they come from

- **Systems connected** on `/s` counts every system; the systems that cannot be reached or signed in to are those whose health is Unreachable or Sign-in failed.
- **What the first run will do** counts what the setup has saved so far: tables are the tables of the chosen objects.
- **Records** is what the last extraction stored, across every object.
- **Configuration** counts areas loaded out of those the connector knows, for example "11 of 12 areas".
- The dry run counts rows from the last extraction of each table; a table never extracted is not counted and says so.

## What you can do, by role

- **SAP Basis** (manage systems, trigger sync): run the setup, connect, test, rotate credentials, extract, dry run, delta, schedule, load configuration, remove a system.
- **Analyst and programme lead** (analyse, trigger sync where granted): run analysis, extract.
- **Rule maintainers** (manage rules): edit a custom object's registry entry, add a Z rule.
- **Policy packs and invitations** in the setup need manage rules and manage users; without them the step shows the refusal under it.
- **Everyone else**: read the systems list and each system.

## Keyboard

- `⌘K`, then "connect", opens Connect a system.
- In every table, `j` and `k` move and `Enter` opens.
- `Esc` closes the inspector.

## When something is wrong

- **"Sign-in refused"** or **HTTP 401**: the user or secret is wrong or expired. Open **Connection settings**, type the new values ("Stored secrets are never shown. Type new values to replace them; an empty field keeps the stored one.") and test again.
- **"No authorisation to read this table. The user needs read access to it."** Grant the RFC user read access to that table in SAP (S_TABU_NAM, or S_TABU_DIS), then **Load again**. The read-only role template is `docs/sap/authorisation-role-template.md`.
- **The Basis team refuses `RFC_READ_TABLE`**: choose another **Table reader** (`/BODS/RFC_READ_TABLE2` or `BBP_RFC_READ_TABLE`), or an **Extraction path** that does not read tables directly: **ODP** or, on S/4HANA on premise, **OData through the SAP Gateway**. The data read is the same; fields ODP cannot deliver are listed per table.
- **"RODPS_REPL_ODP_OPEN is not available on this system"**: the ODP functions are missing or not authorised. Grant `S_RFC` for function group `RODPS_REPL`, or choose **Automatic**, which reads with the table reader.
- **An OData table failed with 404**: the API service is not activated on the Gateway (`/IWFND/MAINT_SERVICE`).
- **"The table does not exist in this release. Nothing to fix."** Expected on some releases.
- **"This system is extracted but no rule has run on it. Run an analysis."** Use Run analysis.
- **"Testing, loading and extracting need the trigger sync permission on this system."** Ask your administrator for a grant on that system.
- **A schedule did not run**: due runs start within 5 minutes of their time; check Runs, Jobs for a failed extraction.
