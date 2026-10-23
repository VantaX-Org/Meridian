# Rules

Rules are the checks Meridian runs on your SAP data. Every score, count and finding comes from a deterministic rule, never from a guess. Data stewards use these pages to see what is checked and to write rules; administrators set how the score is weighted and when alerts go out.

You reach Rules from the **More** menu, under Rules. The same group holds **Contracts**, **Drafts**, **Data dictionary** and **Scoring and alerts**.

## What you see

The Rules page (`/rules`) opens with a header that counts your rules and how many are enabled. On the right are **Learned from your data** and, if you may write rules, **New rule**. Below are three tabs: **All**, **Suppressions** and **Feedback**.

On the **All** tab, from top to bottom:

- Three figures: **Failing** (rules whose last pass rate is under 100), **Disabled** and **Not run yet**. Select one to filter the list to those rules.
- The filter bar: **Search**, **System** (ECC, SuccessFactors or Warehouse), **Check type**, **Dimension**, **Severity**, **Authority** (SAP standard (shipped) or Customer configured), **State**, **Source** (built-in, HQ, mined or custom), **Object** and **Table**. **View** appears for the material master, and **Configuration** appears when you have more than one system. A filter shows only when there is more than one value to pick.
- Each active filter shows as a chip. Select a chip to remove it, or **Clear all**.
- The ledger **Rules, lowest pass rate first**, with the columns **Rule**, **Object**, **Severity**, **Pass rate** and **State**, and **Open** at the end of each row. A rule that has not run reads "Not run yet". A rule that does not apply to your loaded configuration reads "Not applicable"; hover it for the reason.
- **Coverage by object**: for each object, the **Total** rules, how many are **Configured**, how many **Applies by default**, how many **Does not apply**, and **Passing applicable**. Coverage is measured on a finished run.

Select a row to open a side panel with the rule's definition, conditions and thresholds, and the buttons **Disable rule** (or **Enable rule**) and **Open rule**.

The **Suppressions** tab lists active suppressions: the rule, the scope (one record key, or **Whole rule**), the reason, when it expires and who made it. A suppression keeps a rule or one record out of the score until it expires. You create one from a finding.

The **Feedback** tab shows, per rule, the records stewards flagged, confirmed as real or marked as false positives, with the **False-positive rate**. A rate over 30% is marked red.

## A rule's page

Open a rule to see its page (`/rules/<id>`). The header shows the rule's name, its ID, its severity and whether it is enabled, with **Disable rule** (or **Enable rule**) and **See failing records**. Above the tabs, **Export** offers **Rule run history (.xlsx)**.

The **Overview** tab shows:

- **Last pass rate** and **Last run**. Both open the failing records.
- The description, then the **Object**, the **System** and the **Source**. For a built-in rule the source names the YAML file the rule ships in.
- **Where it applies**: one row per connected system, with **Applies** (Applies, Applies by default, Does not apply or Not available), the **Reason** and **Configured in**, the configuration path or transaction that decides it.
- **Lineage and ownership** (built-in rules only): the **Fields** and **Tables** the rule reads, its **Targets**, the **Joins** it follows, linked **Glossary terms** and the **Object owner**. Below are **Owner** and **Steward** pickers for the rule itself.
- **Versions**: the rule's tenant versions with their state (draft, in review, active or retired).
- **Pass rate over runs**: a line of the pass rate per run. Select a point to open that run's failing records.
- **Conditions**: what the rule checks, written as the check type on the SAP field (for example "Required value on `LFA1.STCD1`"), followed by its other parameters such as the dimension and message.
- **Thresholds**, when the rule has any.

The **History** tab lists the last 20 runs with **Run**, **Object** and **Pass rate**. The **Audit** tab lists every logged change to the rule.

## How to enable or disable a rule

1. Find the rule on the **All** tab.
2. Flip the switch in the **State** column, or open the rule and select **Disable rule**.
3. A message confirms the change and offers **Undo**.

The change applies from the next analysis run. Past runs keep their results.

## How to write a new rule

1. On Rules, select **New rule**.
2. Choose the **Object** and a **Check type**: Required value, Allowed values, Pattern match, Field-to-field consistency, Dependency check or No duplicates.
3. Fill in the fields the check needs. Fields are SAP `TABLE.FIELD` names and are checked against the data dictionary.
4. Write the **Message** shown on each finding, and pick the **Severity** and **Dimension**.
5. Under **Dry run against**, choose an analysed version, then select **Dry run**. You see how many records were **Checked**, how many are **Failing**, the **Pass rate** and sample record keys.
6. Select **Save rule**. It is enabled only after a clean dry run of the current draft. The rule runs on every later analysis of the object.

## How to work with drafts

Drafts (`/rules/drafts`) holds rules being written before they run. The ledger shows **Object**, **Rule**, **Field**, **Why** and **Saved**.

1. Select **New draft**, or **Open** on an existing one.
2. To start from words, type the rule under **Describe the rule**, choose an object, and select **Generate with AI**. The model sees field metadata and aggregate statistics only, never record values.
3. Check the **Rule id**, **Object**, **Field**, **Check class**, **Severity**, **Dimension**, **Message** and **Conditions (JSON)**, and say **Why this rule**.
4. Select **Dry run** to see **Rows matched**, **Rows checked**, **Pass rate** and a sample.
5. Select **Save draft**. **Publish rule** is available once the draft is saved with no unsaved changes; it makes the rule active from the next run.

**Delete draft** removes the draft for everyone. Published rules are not affected.

## How to review learned rules

Learned rules (`/rules/learned`, from **Learned from your data**) are patterns your own data follows for at least 95% of records: a field decided by another field, a limited value set, a format or a numeric range.

1. Pick a **Status** (Awaiting review, Approved or Rejected) and a **Kind**.
2. Read **Field**, **Decided by**, **Holds for**, **Breaks it** (select it to see the records) and **Examples**.
3. Select **Approve** to turn the pattern into an active rule, at medium severity, from the next run. Select **Reject** to drop it.

**Mine now** looks for new patterns in the latest finished run. Mining runs after the second analysis.

## How to manage data contracts

A contract (`/rules/contracts`) turns rules into a promise between a producer and a consumer system. Breached contracts are listed first. The ledger shows **Status**, **Contract**, **Producer and consumer**, **Latest check** (Compliant, Not compliant or Not checked) and **Checked**. The figures **Breached** and **Awaiting approval** filter the list.

1. Select **New contract**, enter the **Contract name**, **Producer system**, **Consumer system** and **What the contract governs**, then **Create draft**.
2. Open a contract to see its schema, quality, freshness and volume terms and its **Compliance history**.
3. A person other than the author selects **Activate**.

Quality, volume and schema terms are checked after every analysis run; freshness is checked hourly.

## How to look up SAP fields

The data dictionary (`/rules/dictionary`) looks up standard SAP fields. Type one or more `TABLE.FIELD` names, such as `MARA.MATNR, KNA1.KUNNR`. Each row shows the **Domain**, **Data element** and **Length**, and **Find rules** searches for rules on that field. Entries that are not `TABLE.FIELD` are skipped and listed.

## How to set scoring and alerts

Scoring and alerts (`/rules/scoring`) sets how the score is built and who is told.

1. At the top, **Score now** shows the latest score and **With these weights** previews it under the weights you are editing. **Weights sum** must read 1.00 before you can save.
2. Under **Dimension weights**, enter a weight per dimension. The table shows the **Normalised** share, the **Latest score** and its **Contribution**. Select **Save weights**, or **Use DAMA defaults** (completeness 0.25, accuracy 0.25, consistency 0.20, timeliness, uniqueness and validity 0.10 each). Weights apply from the next analysis run.
3. Under **When to alert**, set **Critical findings**, **High findings** and **Score drop, points**. An alert is raised when a run reaches that many critical or high findings, or an object's score falls by more than that against the previous run.
4. Under **Score floors per object**, use **Add a floor for** to give an object a minimum score. A run that scores it lower raises an alert. Select **Save thresholds**.
5. Under **Planner assumptions**, set the effort figures and an optional **Cost per failing record** and **Currency**, then **Save assumptions**.
6. Under **Reports by email and Teams**, enter an **Email** and **Teams webhook**, tick **Daily digest**, **Weekly summary** or **Monthly report**, then **Save notifications**.
7. Under **Cost model**, enter what one blocked record costs at each severity, then **Save cost model**. This feeds value at risk.

Some parts of the score have no field on this page. One failing critical rule caps an object's score at 85 and two or more at 70, but only when the rule fails at least 0.1% of the records it checks or at least 25 of them. By default, rules within a dimension weigh by severity (critical 4, high 3, medium 2, low 1), and the bands are target 90, warning 75 and critical 60. The methodology section of the board pack and other reports prints the weights and bands in use.

## Who can change what

- Anyone who can see Rules can read every page in this chapter.
- Enabling and disabling rules, writing rules and drafts, publishing, **Mine now**, rejecting learned rules and creating contracts need the manage-rules permission (administrator and data steward).
- Approving learned rules, activating contracts, creating and ending suppressions, and approving a rule version need the approve permission (administrator, manager, data steward and approver). The author of a version cannot approve it.
- Saving anything on Scoring and alerts needs the manage-settings permission (administrator). Everyone else sees "These settings are read only for your role".
- Exporting the rule list or a rule's history needs the export permission.

## Good to know

- A rule that does not apply to a system's configuration is left out of the score, not counted as a pass.
- A rule is evaluated at its grain, such as a document header, a line item or a plant record, and can exclude a population, such as records flagged for deletion. Excluded records are neither passes nor failures.
- "No rules loaded" means the built-in rules did not load; check HQ sync in settings.
- Retiring a version stops the rule from the next analysis. You can write a new version later.

## Related

- [Objects](/docs?page=objects)
- [Runs](/docs?page=runs)
- [Insights](/docs?page=insights)
- [Reports](/docs?page=reports)
- [Roles](/docs?page=roles)
- [Administration](/docs?page=admin)
