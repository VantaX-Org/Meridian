# Rules

Rules are the checks Meridian runs on your SAP data. Every score, failing record and suggested value comes from a deterministic rule, never from a guess. Stewards use these pages to see what is checked, why a record fails and to write new rules; administrators set how the score is weighted and when alerts go out.

Open **More**, **Rules**. The section holds **Rules**, **Contracts**, **Drafts**, **Data dictionary** and **Scoring**. Who is told about what lives under **Admin**, **Alerts**.

## The rules list

The [Rules](/rules) page counts your rules and how many are enabled, and has three tabs: **All**, **Suppressions** and **Feedback**.

- **All** shows the figures **Failing**, **Disabled** and **Not run yet**, a filter bar (search, system, check type, dimension, severity, state, source, object and table), and the ledger **Rules, lowest pass rate first**. A rule that does not apply to your loaded configuration reads "Not applicable"; hover it for the reason. **Coverage by object** shows, for each object, how many rules apply on your loaded configuration and how many do not; it is measured on a finished run, so it stays empty until the first run completes.
- **Suppressions** lists rules or single records kept out of the score until a date, with the reason and who made it.
- **Feedback** shows, per rule, the records stewards flagged and the false-positive rate. A rate over 30% is marked red.

## A rule's page

Open a rule to see its last pass rate, its description, where it applies on each system and why, the fields and tables it reads, its owner and steward, its versions, a line of its pass rate over runs, **What changed between versions**, and its conditions, written as the check on the SAP field, such as "Required value on `LFA1.STCD1`". **See failing records** opens its records. The message and instruction you read in the Fix work record panel come from here.

## How to enable or disable a rule

Flip the switch in the **State** column, or open the rule and select **Disable rule**. A message offers **Undo**. The change applies from the next run; past runs keep their results.

## How to write a new rule

1. Select **New rule**.
2. Choose the **Object** and a **Check type**: Required value, Allowed values, Pattern match, Field-to-field consistency, Dependency check or No duplicates.
3. Fill in the SAP `TABLE.FIELD` names, the **Message**, the **Severity** and the **Dimension**.
4. Choose a run under **Dry run against** and select **Dry run** to see how many records are checked and failing, with samples.
5. Select **Save rule**. It is enabled only after a clean dry run.

**Drafts** holds rules being written. You can describe a rule in words and select **Generate with AI**; the model sees field metadata and counts only, never record values. **Publish rule** makes a saved draft active from the next run.

## Learned rules

**Learned from your data** lists patterns your own data follows for at least 95% of records, such as a field decided by another field. **Approve** turns a pattern into an active rule at medium severity; **Reject** drops it.

## Contracts and the data dictionary

A data contract turns rules into a promise between a producer and a consumer system, checked after every run and marked compliant or not. A draft is submitted for approval, then activated by someone other than its author. The data dictionary looks up standard SAP fields by `TABLE.FIELD` and finds the rules on each.

## Versions and what changed

Every change to a rule makes a new version, and a new version applies from the next analysis run; past runs keep the result they had. On a rule's page, **What changed between versions** compares a version with the one before it, or with the rule as shipped when it is the first change. Choose the version under **Version to read**. Lines that were added and removed are listed, so you can see exactly which threshold, field or message moved. When two versions read the same, the page says **Nothing differs**. The author of a version cannot approve it.

## Scoring

[Scoring](/rules/scoring) is about how the score is made. It sets the dimension weights (they must sum to 1.00; **Use DAMA defaults** restores 0.25, 0.25, 0.20, 0.10, 0.10, 0.10), the score bands that decide Go, At risk and No-go, the planner assumptions and the cost model behind value at risk. A preview shows how the current score would change before you save. Saving needs the manage settings permission; others read the page.

## Alerts

Telling people is a separate page: [Alerts](/admin/alerts), under **Admin**. It holds the thresholds that raise an alert (critical or high failing rules, or a score that drops by more than a set number of points), a score floor per object, the channels that carry alerts and digests (email, Slack, Teams or a signed webhook) and the default digest. Scoring answers "how good is the data"; Alerts answers "who is told, and when". See [Administration](/docs?page=admin).

## Who can change what

- Writing, enabling and publishing rules and creating contracts need the manage rules permission (Platform admin, Data steward).
- Approving learned rules, activating contracts and creating suppressions need the approve permission. The author of a rule version cannot approve it.
- Exporting the rule list needs the export permission.

## Related

- [Key concepts](/docs?page=concepts)
- [Objects](/docs?page=objects)
- [Fix work](/docs?page=fix)
- [Administration](/docs?page=admin)
