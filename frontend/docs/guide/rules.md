# The rule canvas and the rules library

Every number in Meridian comes from a rule: a fixed, deterministic check with an id such as `MM014`, a field, a dimension and a severity. The **rule canvas** shows one rule across every object and system it runs on. The **rules library** lists every rule of the tenant, with drafts and suppressions. Open a rule by typing its id in the command line, from any rule row, or at `/v2/r/{id}`. Open the library from the command line ("Rules") or at `/v2/rules`.

## The rule canvas

The title is the rule id and name, for example "MM014 Base unit of measure not valid". The facts line under it reads like "Critical, Validity, 4,212 failing across 2 objects, 4.99% of records checked, ZAR 1.18 m at risk, over tolerance, blocks 3 S/4 features".

Four sections follow:

- **Definition**: the check class (such as `domain_value_check`), the field (`MARA.MEINS`), the expression (`MARA-MEINS in T006-MSEHI`), its parameters, the source ("Shipped with Meridian" or a custom rule), the authority ("SAP hard constraint") and what goes wrong in SAP. **Versions** lists every version with who changed it and why; the shipped definition names its file and content hash.
- **Failing records**: the scope, for example "Scope: 2 objects, 1 system", with each object, its run and its failing count. **Open failing records** opens the Work ledger filtered to this rule.
- **Impact**: the S/4 features this rule blocks or degrades and the lineage from field to rule to feature.
- **History**: each run's failing count next to the version changes, so a jump in failures can be read against a change to the rule.

**Contract** shows the data contracts that name this rule.

## The rule inspector

Selecting a rule anywhere opens the inspector with the same facts: severity, dimension, field, **Tolerance** (for example "25 rows"; only critical rules carry a tolerance), **Over tolerance**, failing records by object, **Failing %** ("4.99% of 84,456 records checked") and **Value at risk**. Below come the definition, scope, the features it blocks, lineage, versions, contract, history, **Watch** and **Comments**.

## The rules library

The library title says what is there, for example "38 rules across 19 objects, 38 enabled". Three views: **All rules**, **Drafts** and **Suppressed**. Filter by object, dimension, severity, check class and state; the table shows rule, object, severity, dimension, class, failing records, pass rate, state and source. **New rule draft** starts a rule in authoring; a draft runs nowhere until it is reviewed and enabled.

Rules can also be imported and exported in bulk under Administration, Rules import and export: imported rules are validated against the data dictionary and land as drafts for review, never live.

## The numbers and where they come from

- **Failing** is distinct records failing the rule in the latest run of each object in scope.
- **Failing %** divides by the records checked in those runs.
- **Over tolerance** applies to critical rules only: a critical rule is over tolerance when it fails at least the share or the count of records set as its tolerance. "Only critical rules count: when one is over tolerance it caps the score (85 for one rule, 70 for two or more); a critical rule within tolerance still lowers its dimension but never caps."
- **Value at risk** is from the cost model of the run, in the tenant currency.
- **Pass rate** is the share of checked records that pass.

## What you can do, by role

- **Everyone**: read, watch, comment, export the library.
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
