# Systems

Systems is where you connect SAP systems, check that each connection is healthy, and read their data into runs. SAP Basis administrators use it most. Your SAP data stays inside your own environment.

## What you see

Open **Systems** from the index bar. The header reads **Systems**, with a count such as "4 systems, 1 need attention". On the right are the export menu, which downloads **Runs (.xlsx)**, and **Connect system** if your role can add systems.

### Health figures

Under the header are figures for **Healthy**, **Degraded** and **Unreachable**, plus **Not tested** when any system has not been checked yet. Select a figure to filter the table. A pill above the table names the filter, and **Clear filter** removes it.

### The systems table

The table lists the systems worst health first, then lowest score. The columns are:

- **System**: the name, with the environment and client, such as `PRD/100`.
- **Type**: the system type.
- **Health**: Healthy, Degraded, Unreachable, Sign-in refused or Not tested, with when it was last checked.
- **Objects loaded**: objects that hold data, such as "8 of 14".
- **Latest DQS**: the mean score of the newest analysed run, with its change.
- **Configuration**: Loaded, Loaded with gaps, Loading, Not loaded, Failed or Not available. "Rules apply by default" means none has been loaded.
- **Last extraction**: when data was last read, and the next scheduled read or "Manual only".

Select a row, or **Open**, to open the system.

## How to connect a system

You need a role that can add systems, such as SAP Basis, a manager or an administrator.

1. Select **Connect system**. The **Connect a system** dialog opens.
2. Enter a **Name**, such as "PRD ECC".
3. Choose the **Type**: **SAP ECC**, **S/4HANA on premise**, **Extended Warehouse Management**, **S/4HANA Cloud**, **SuccessFactors**, **Concur** or **BTP**.
4. Choose the **Environment**: **Production**, **Quality** or **Development**.
5. Fill in the connection fields for the type, described below.
6. Select **Connect system**. A message confirms the system is connected, or says why it is not.

### Connection fields by type

- **SAP ECC**, **S/4HANA on premise** and **Extended Warehouse Management** connect over RFC: enter the **Host**, the three-digit **Client**, the two-digit **Instance number**, an optional **User** and the **Password**. The SAP user needs read authorisations only.
- **S/4HANA Cloud** and **BTP** connect with OAuth: enter the **Base URL**, **Token URL**, **Client ID** and **Client secret**.
- **SuccessFactors**: enter the **Base URL**, **Company ID**, **Client ID** and **Client secret**. The **Token URL** is optional.
- **Concur**: enter the **Base URL**, **Client ID** and **Client secret**. The **Token URL** is optional.

The dialog does not offer Ariba, because it cannot collect Ariba's API key and token URL. Passwords and client secrets are stored encrypted and are never shown again.

## How to test a connection

1. Open the system.
2. Select **Test connection** in the header, or on the **Health** tab.
3. A message reports the result and the response time, such as "Connection healthy, 120 ms". If the test fails, the button reads **Test failed, retry**, and the **Health** tab shows the reason.

Meridian also checks every system's connection automatically every 30 minutes. Testing needs a role that can start extractions.

## The system page

The header shows the system's name, a **Source system** or **Target system** pill, and its type, environment and host. The header buttons are **Edit**, **Test connection**, **Extract**, **Analyse** (analyses the newest run again) and the export menu. If your role cannot extract, **Extract** is shown disabled with a **Request access** link.

Four figures follow: **Health**, **Objects loaded**, **DQS** and **Open findings**. Each is a link.

### Overview

**Objects** lists the system's objects by record count, each with its verdict. Select one to see its score, blocking rule, last run and records affected, with **Open object**. Below are **Score per run**, **Objects by rows**, **Trend per object** and **Last 5 runs**. In **Trend per object**, notes such as **Scope changed** or **Incomplete extract** warn that a change is not like for like.

### Objects

A table of every object with **Enabled**, **Rows**, **Last synced** and **DQS**. Each row has **Extract again** and **Analyse**. Under the table is the extraction panel described below. If the table is empty, select **Discover design** to list the system's objects.

### Runs

Every run read from this system, with its status, objects, rows, analysed time and DQS. The **Extraction** column links to **Extraction log**, or **Why it failed** for a failed run.

### Health

- **Connection**: the health sentence, last health check, discovery status and SAP release, with **Test connection**, **Load configuration** and **Discover design**.
- **Configuration**: the configuration load, area by area. A table the SAP user may not read is named.
- **Scheduled re-evaluation**: the schedules, described below.
- **Reference data**: upload official postal codes and a SWIFT BIC directory as CSV files. Addresses and bank BICs are checked against them at the next analysis.
- **Design discovery**: tabs for **Data dictionary**, **Configuration**, **Coverage** and **History**. Coverage shows any table the SAP user may not read.

### Configuration, Custom objects and Pilot

- **Configuration** covers every connected system in the workspace, from the latest run, in the tabs **Health**, **Inventory**, **Processes**, **Alignment**, **Ghost and shadow**, **Drift**, **Licence use** and **Compare**. Ghost configuration is set up but never used; shadow configuration is used but not set up. **Discover now** reruns it.
- **Custom objects** lists the custom Z objects found across the workspace, in the tabs **Registry**, **Anomalies**, **Ghost**, **Dormant**, **Drift**, **Rules** and **Mapping**. **Detect now** reruns detection.
- **Pilot** scores how often each rule was right, judged by your stewards' decisions.

The last tabs, **Related**, **History** and **Audit**, list linked items and every logged action on the system.

## How to load configuration

Loading configuration tells Meridian which fields and rules apply to this system. Until you load it, every rule applies by default.

1. Open the system and go to the **Health** tab.
2. Select **Load configuration**. Loading continues if you leave the page.
3. Read the result. "Configuration loaded with gaps" means some areas could not be read. Rules that depend on them apply by default. Select **Try again** to retry.

SAP BTP has no business configuration to read, so the button does not appear for BTP systems.

## How to run an extraction

1. Open the system and select **Extract**. The panel **Extract objects into a new run** opens. The same panel sits under the **Objects** tab.
2. Select the objects to read. Each row shows its tables, its last extraction and its rows.
3. Set the scope. Enter **Company codes**, **Plants**, **Sales organisations** or **Purchasing organisations** as a comma-separated list, or leave a field empty to read all. Only the fields that apply to the chosen objects appear.
4. For transactional objects, set **Documents from** and **Documents to** to replace the default date window.
5. Optionally, give the run a **Run label**.
6. Tick **Skip records flagged for deletion** for faster reads. Leave it off for a full quality score, because inactive data is itself a finding.
7. Select **Extract N objects**, or **Extract and analyse** to score the data when the read finishes.
8. Check the question, then select **Confirm**. **Keep scope** goes back.

Organisational filters restrict every table that carries the field. General data without it is read in full, so no record loses its context. While the read runs, the system page shows "Extraction in progress" with the table being read and the share done.

On Home, **Run analysis** opens the same panel after you choose a system. On Runs, **Run analysis** opens the first connected system.

## The extraction log

Select **Extraction log** on the **Runs** tab. The page shows a progress bar while the read runs, a notice naming any failed step and its error, a chart of step durations, and each step with its status and duration.

## How to schedule re-evaluation

A schedule re-reads an object and reruns its checks, so trends and alerts pick up every run. You need a role that can manage systems.

1. Open the **Health** tab and find **Scheduled re-evaluation**.
2. Choose an object in **Schedule an object**.
3. Choose a **Schedule**: **Daily at 02:00**, **Weekly, Monday 02:00**, **Monthly, 1st at 02:00**, **Hourly**, or **Custom cron…** for your own cron expression.
4. Choose the **Extraction mode**.
5. Select **Add schedule**.

Each schedule shows its last and next run, and whether it is active or paused. Select **Pause** or **Resume** to change it. Times are server time, and the scheduler looks for due runs every five minutes.

### Full download or changes only

- **Full download** reads every record of the object.
- **Changes only** re-reads just the records SAP's change log shows as changed since the last download, and still does a full download at least weekly.

Extractions you start by hand read the selected objects in full, within the scope you set.

## How to import a file

Use **Import file** when you have an export but no live connection. Open it from the **More** menu under Systems, or at `/import`. Importing needs the upload permission.

1. Select **Choose file**, or drop a file on the page. Meridian accepts CSV, TSV, TXT, XLSX, XLS, JSON or Parquet files up to 2 GB.
2. Meridian reads the columns and says what the file looks like, for example "looks like Material master (92% sure), 18 columns mapped".
3. Check **Column mapping**. Each row shows **Your column**, the **Standard field** it maps to, the **Confidence** and the **Match**. Columns with no field show "Not mapped".
4. Check the object, and select another object button if the guess is wrong.
5. Select **Run import**. A progress bar shows the upload, then each step: reading the file, mapping columns, validating records, running checks and scoring.
6. When it finishes, select **Open the run**.

JSON and Parquet columns cannot be previewed: pick the object, and the columns are read on import. If required fields have no column, a notice names them and the checks that need them are skipped. **Clear** starts again.

**Recent imports** lists earlier files with their objects, records, score and status. Each import becomes a run. Extracting from a connected system keeps runs comparable; file imports suit one-off assessments.

## How to edit or remove a system

1. Select **Edit** on the system page.
2. Change the **Alias**, **Environment**, **Role**, **Target** or **Description**, or untick **Active**. For a source system, **Target** is the system it is compared with; **None (SAP standard baseline)** compares it with the SAP standard.
3. Select **Save**.

To remove a system, select **Delete**, then **Remove**. Its credentials and schedules go with it. Runs and findings already read stay.

## Good to know

- "Sign-in refused" means the system refused Meridian's sign-in. Check the user and credentials.
- "Not tested" is not a failure. It only means no check has run yet.
- If a read times out, try again outside peak hours or ask Basis to raise the RFC timeout.
- An empty list reads "No systems yet" and offers **Import file**.

## Related

- [Runs](/docs?page=runs)
- [Objects](/docs?page=objects)
- [Rules](/docs?page=rules)
- [Process](/docs?page=process)
- [Roles](/docs?page=roles)
- [Troubleshooting](/docs?page=troubleshooting)
