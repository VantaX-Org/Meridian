# Data in

Everything Meridian checks has to come in first: from a connected SAP system, from an export file, or as part of a migration wave. The **Data in** section of the **More** menu holds the three pages for that: **Systems**, **Import file** and **Migration**. SAP Basis teams and analysts use them most; stewards rarely need them.

## Systems

[Systems](/systems) lists every connected system with its type, health (**Healthy**, **Degraded**, **Unreachable**, **Sign-in refused** or **Not tested**), the objects that hold data, the latest score, whether its configuration is loaded, and when data was last read. In the **More** menu the entry carries a dot for the worst health: red when a system cannot be reached or refused sign-in, amber when one is degraded, green when all are healthy.

### How to connect a system

1. Select **Connect system**, enter a **Name** such as "PRD ECC", and choose the **Type** and **Environment**.
2. Fill in the connection fields. ECC, S/4HANA on premise and Extended Warehouse Management connect over RFC with host, client, instance number, user and password; the SAP user needs read authorisations only. S/4HANA Cloud, BTP, SuccessFactors and Concur connect with OAuth: base URL, client ID and client secret, and a token URL where asked.
3. Select **Connect system**, then **Test connection**. Meridian also checks every connection every 30 minutes.

Connecting and editing systems needs a role that manages systems, such as SAP Basis or a programme lead.

### How to load configuration

On the system's **Health** tab, select **Load configuration**. It tells Meridian which fields and rules apply to this system; until it loads, every rule applies by default. "Configuration loaded with gaps" means some areas could not be read, and **Try again** retries.

### How to run an extraction

1. Open the system and select **Extract**.
2. Tick the objects to read, and set the scope: company codes, plants, sales or purchasing organisations, and a document date window for transactional objects. Leave a field empty to read all.
3. Give the run a **Run label** if you like, then select **Extract N objects**, or **Extract and analyse** to score the data as soon as it is read, and **Confirm**.

When the analysis finishes, the run's work list is built and its failing records appear in [Fix work](/docs?page=fix). **Extraction log** on the **Runs** tab shows each step, its duration and any error.

### How to schedule re-evaluation

On the **Health** tab, under **Scheduled re-evaluation**, choose an object, a schedule (daily, weekly, monthly, hourly or your own) and an extraction mode, then **Add schedule**. **Full download** reads every record; **Changes only** re-reads the records SAP's change log shows as changed, with a full download at least weekly. The next run after an export is what confirms your fixes, so a schedule keeps Fix work and Progress current.

## Import file

Use [Import file](/import) when you have an export but no live connection. Importing needs the upload permission.

1. Select **Choose file**, or drop one on the page: CSV, TSV, TXT, XLSX, XLS, JSON or Parquet, up to 2 GB.
2. Meridian says what the file looks like, such as "looks like Material master (92% sure)". Check the object and the **Column mapping**: each of your columns, the standard field it maps to and the confidence.
3. Select **Run import**, and follow the steps from reading the file to scoring.
4. Select **Open the run**.

Each import becomes a run. Imports of the same objects are compared with each other, so a second file of the same data confirms the fixes of the first. A required field with no column is named, and the checks that need it are skipped; an administrator can map the column under **Field mapping**.

## Migration

[Migration](/migration) tells you whether your data is ready to move to S/4HANA, wave by wave. It shows to roles with the analyse permission.

- **Create wave**: a name, source and target system, the modules, a target date, a stage (**Plan**, **Mock 1**, **Mock 2**, **Dress rehearsal** or **Cutover**) and a **Minimum readiness %**, 95 by default.
- **Run now** scores every module of the wave. Readiness is the share of records that would load; a record is blocked by a critical or high gap. A module is **Go** with nothing blocked, **At risk** with readiness at 90% or more, and **No-go** otherwise. The wave takes the worst verdict of its modules.
- **Dry run (S/4 load)** applies the target's load checks to your source records and lists each record that would fail to load, with the reasons. Nothing is written to SAP.
- On a wave's **Blockers** tab, **Create fix batch** drafts a batch for one object, gap and field, which is then approved and exported as in [Approvals and export](/docs?page=approvals).
- When the verdict is **Go**, **Sign off** records who signed off and when. It needs the approve permission.

## Related

- [Fix work](/docs?page=fix)
- [Analysis](/docs?page=analysis)
- [Administration](/docs?page=admin)
- [Troubleshooting](/docs?page=troubleshooting)
