# The rule canvas and the rules library

Every number in Meridian comes from a rule: a fixed, deterministic check with an id such as `MM142`, a field, a dimension and a severity. The **rule canvas** shows one rule across every object and system it runs on. The **rules library** lists every rule of the tenant, with drafts and suppressions. Open a rule by typing its id in the command line, from any rule row, or at `/r/{id}`. Open the library from the command line ("Rules") or at `/rules`.

## The rule canvas

The title is the rule id and name, for example "MM142 Base unit of measure MEINS must reference a valid entry in T006". The facts line under it reads like "High, Consistency, 4,212 failing across 2 objects, 4.99% of records checked, ZAR 1.18 m at risk, estimated, within tolerance, blocks 3 S/4 features".

Five sections follow:

- **Definition**: the check class (such as "Exists in check table"), the field (`MARA-MEINS`), the expression (`MARA-MEINS in T006-MSEHI`), its parameters such as the check table `T006` and check field `MSEHI`, the source ("Shipped with Meridian" or a custom rule), the authority ("Best practice", or "SAP hard constraint") and what goes wrong in SAP. **Versions** lists every version with who changed it and why; the shipped definition names its file and content hash.
- **Failing records**: the scope, for example "Scope: 2 objects, 1 system", with each object, its run and its failing count. **Open failing records** opens the Work ledger filtered to this rule.
- **Prove in SAP**: how to reproduce the rule's count by hand in SE16 or SE16N (see below).
- **Impact**: the S/4 features this rule blocks or degrades and the lineage from field to rule to feature.
- **History**: each run's failing count next to the version changes, so a jump in failures can be read against a change to the rule.

**Contract** shows the data contracts that name this rule.

## Prove in SAP

Your SAP team can check any number Meridian shows without trusting Meridian. **Prove in SAP** gives, for the rule and the run of one object (choose the object when the rule runs on several):

- **Record grain**: the table the rule judges and its key, for example `MARA`, one record per `MATNR`.
- **SE16 selection**: one row per selection field, marked **Population** (the records the rule judges) or **Failing** (added to find the failing ones), with the SE16 option and values. **Initial value** means leave the value empty with the option "=", which selects blank, 0 and 00000000. The population always leaves out what SAP itself marks as dead, such as records flagged for deletion (`MARA-LVORM` is initial), and the facts say how many records that left out.
- **What SE16 cannot express**: a pattern, a lookup in a check table (for example "MARA.MEINS has no entry in check table T006: list T006 in SE16 and compare"), a duplicate, a join to another table, a check digit. The selection above is then the closest one, and this list says the rest in plain words. When one selection is enough, the section says "One SE16N selection on MARA gives the failing count".
- **Population** and **Failing**: the counts Meridian measured in that run, to compare with the number of entries SE16 shows.
- **Five failing records**: their keys as SE16 shows them (`MATNR 232`, without the leading zeros of the conversion exit), with the key as stored (`MATNR=000000000000000232`) beside it.

To prove a run in one go, **Download the reconciliation workbook** (needs the export permission): a summary sheet with one row per rule and empty **SE16 count** and **Match** columns for your team, and one sheet per rule with its selection, steps, counts and sample keys, for the ten rules with the most failing records in that run. The same pack is `GET /api/v1/rules/{id}/reconcile?run={run}` and the workbook `GET /api/v1/runs/{run}/reconciliation.xlsx?top=10`.

Cloud sources (SuccessFactors, Concur, Ariba) have no SE16: the section says so and the same selection applies in the source's own reporting.

## The rule inspector

Selecting a rule anywhere opens the inspector with the same facts: severity, dimension, field, **Tolerance** (for example "25 rows" on `MM003`; only critical rules carry a tolerance, so a high rule such as `MM142` reads within tolerance), **Over tolerance**, failing records by object, **Failing %** ("4.99% of 84,456 records checked") and **Value at risk**. Below come the definition, scope, the features it blocks, lineage, versions, contract, **Prove in SAP**, history, **Watch** and **Comments**.

## The rules library

The library title says what is there, for example "794 rules across 15 objects, 794 enabled". It reads every page of the rule list, opens filtered to an object from that object's Rules tab, and its **Share and export** offers Excel and a CSV of the columns and rows on screen. Three views: **All rules**, **Drafts** and **Suppressed**. Filter by object, dimension, severity, check class and state; the table shows rule, object, severity, dimension, class, failing records, pass rate, state and source. **New rule draft** starts a rule in authoring; a draft runs nowhere until it is reviewed and enabled.

Rules can also be imported and exported in bulk under Administration, Rules import and export: imported rules are validated against the data dictionary and land as drafts for review, never live.

## The numbers and where they come from

- **Failing** is distinct records failing the rule in the latest run of each object in scope.
- **Failing %** divides by the records checked in those runs.
- **Over tolerance** applies to critical rules only: a critical rule is over tolerance when it fails at least the share or the count of records set as its tolerance. "Only critical rules count: when one is over tolerance it caps the score (85 for one rule, 70 for two or more); a critical rule within tolerance still lowers its dimension but never caps."
- **Value at risk** is from the cost model of the run, in the tenant currency.
- **Pass rate** is the share of checked records that pass.

## What you can do, by role

- **Everyone**: read, watch, comment, export the library, read the SE16 selection of a rule.
- **Export permission**: download the reconciliation workbook of a run.
- **Data steward and rule maintainers** (manage rules): **New rule draft**, **Edit in authoring**, **Suppress** with a reason, **Hand to a steward**.
- **Process analyst** (handoff rule): hand a blocking rule to a steward from the step inspector.
- **Platform admin**: enable, disable and change severity; bulk import and export.
- **Auditor**: read the versions and the history; the rule's change trail across versions and runs is read side by side, there is no single joined trail yet.

## Keyboard

- `⌘K`, then a rule id, opens the rule.
- In the library table, `j` and `k` move, `Enter` opens the rule in the inspector.
- `Esc` closes the inspector.

## When something is wrong

- **A rule fails far more records than last run**: compare **History** with **Versions**. A version change on the same day usually explains it; otherwise the data changed.
- **Coverage below 100%**: the rule could not read some records because a table, field or value list was missing from the extraction.
- **A rule is wrong for your business**: suppress it with a reason, or mark the affected records not an issue in Work. Both are audited. Ask the rule's maintainer or your administrator to change its severity or tolerance.
- **Your edit buttons are missing**: authoring needs the manage rules permission.
