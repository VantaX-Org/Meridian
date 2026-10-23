# Key concepts

This chapter explains the ideas every other page builds on: runs, objects, rules, the data quality score and the verdicts. Read it once before you rely on a number in Meridian.

## Runs

A run is one measurement of your data at a point in time. Meridian creates a run each time it extracts data from a system or you import a file. The rules then run over that data, and every score, finding and record list belongs to that run.

- A run is finished when its analysis completes. Scores and findings come from finished runs.
- A run's name is its label, or the objects it measured, followed by the date.
- A pinned link such as `/objects/material_master?run=...` always shows the same run, so two people looking at it see the same numbers.

### Lineage

Runs are compared only with runs of the same source. That chain is the run's lineage.

- A run extracted from a system belongs to that system. Every extraction from PRD ECC is one lineage.
- An imported file has no system, so imports are grouped by the objects they carry. An import of Business partner data compares only with other imports of Business partner data, never with an import of Controlling data.

Trends, "what changed" and comparisons always stay inside one lineage, so they never mix objects or systems.

### Baseline runs

A baseline is the run you choose to compare later runs against, such as the first run before a cleansing project. Each lineage has at most one baseline.

- On a run's page, select **Pin as baseline**. The run then carries a **Baseline** pill. Select **Unpin baseline** to remove it.
- Comparisons use the pinned baseline when there is one, and the previous finished run otherwise.
- Pinning needs a role that can run analysis, such as Analyst, Data steward or Programme lead.

See [Runs](/docs?page=runs).

## Objects and records

An object is one area of SAP data that Meridian measures as a whole, such as Material master, Business partner, FI general ledger or eWMS stock. Meridian covers 29 such objects across ECC and S/4HANA, SuccessFactors and warehouse systems. Each object has its own rules and its own score.

A record is one row the rules judge, such as one material, one vendor or one sales order line. Each record has a key built from its SAP key fields, for example `MATNR=000000000010001234`. Meridian keeps the failing records of every rule, so you can open the exact rows behind any number.

## Rules, findings and severities

A rule is one fixed check on the data. For example, `MM001` checks that every material has a material number, and `MM002` checks that the number has a valid format. Each rule has:

- an ID such as `MM001`, shown in a monospaced font;
- a dimension, one of the six below;
- a severity: critical, high, medium or low;
- a grain, the level it judges at, such as a header, a line item or a document;
- a plain description of why it matters and how to fix a failing record.

When a rule runs, it produces a finding for that run: how many records it checked, how many failed and which ones.

Severity says how much a failure matters, from **Critical**, the most serious, through **High** and **Medium** to **Low**. Severity changes how a failure counts:

- A critical failure weighs most in the score and can cap it.
- Critical and high failures count as blocking on Home and object pages.
- Impact, the ranking of work, weighs critical failures eight times as much as low ones.

A blocking rule is one that stands in the way of a Go verdict. On Home and on object pages, blocking means a failing rule of critical or high severity. The readiness views count failing critical rules, plus rules that the S/4HANA readiness rule map marks as blocking.

Rules that do not apply to a system, for example because its configuration does not use the field, are skipped. A skipped rule is neither a pass nor a failure and does not count in the score.

## The six dimensions

Every rule belongs to one of the six data quality dimensions from DAMA DMBOK.

- **Completeness**: are the required values present?
- **Accuracy**: are the values right?
- **Consistency**: do related values agree, within a record, across tables and across systems?
- **Timeliness**: is the data current?
- **Uniqueness**: does each real thing appear once, with no duplicate records?
- **Validity**: do values follow the format and the allowed list of values?

## The data quality score

The data quality score (DQS) is a number from 0 to 100 for how fit the data is. Meridian builds it in steps.

1. Each rule gives a record-level pass rate: the share of the records it checked that passed. A rule that fails on 40 of 1,000 materials has a pass rate of 96.
2. Severity scales the failing share. For a critical rule each failing percentage point counts five times, for a high rule twice, and for medium and low rules once. The critical rule above therefore scores 80, not 96.
3. Each dimension score is the average of its rules' scores, weighted by severity: critical 4, high 3, medium 2, low 1.
4. The object's score is the weighted average of its dimension scores.
5. Where several objects are shown together, the score is the average of the object scores. An object can be given more weight; by default every object weighs the same.

The default dimension weights are:

- Completeness 25%
- Accuracy 25%
- Consistency 20%
- Timeliness 10%
- Uniqueness 10%
- Validity 10%

The weights are configurable per tenant. An administrator changes them on **Rules**, **Scoring and alerts**, in the **Dimension weights** card, and **Use DAMA defaults** restores the values above. A dimension that no rule measured is shown as not measured, never as 100, and the weights of the other dimensions are scaled up to fill its share. An object where no rule ran has no score and shows **Not analysed**.

Because the score uses record-level pass rates, a rule that fails on one record in a million barely moves it, and a rule that fails on half the records moves it a lot.

## The critical cap

A high average must not hide a blocking defect, so failing critical rules cap an object's score.

- One critical rule over tolerance caps the score at 85.
- Two or more cap it at 70.

The tolerance stops a handful of records from capping a large object. By default a failing critical rule triggers the cap when it fails on at least 0.1% of the records it checked, or on at least 25 records. The tolerance is set per tenant.

When the cap applies, the score shows the capped value, a "Capped at 85" note and the rules that caused it. The measured value still shows as a ghost beyond the cap, so you can see what fixing those rules would give back.

## Score bands

Three thresholds turn a score into a band. The defaults are:

- Target, 90: a score of 90 or more meets the target.
- Warning, 75: a score from 75 to below 90 is a warning.
- Critical, 60: below 75 fails, and below 60 is the deepest band.

Every score is drawn on the same ruler from 0 to 100, with the target as a tick and the cap, when there is one, as a second tick.

## Readiness verdicts

Each object gets one of three verdicts.

- **Go**: the score meets the target and no critical rule is over tolerance.
- **At risk**: the score is at or above the warning threshold but not Go. Reports call this "conditional".
- **No-go**: the score is below the warning threshold.

An object that has not been measured is not counted as a pass. For a group of objects in a report, the overall verdict is Go only when every object is Go, No-go when any object is No-go, and At risk otherwise.

## Impact and value at risk

Impact ranks the work. For each failing rule it is the number of failing records multiplied by a severity weight: critical 8, high 4, medium 2, low 1. A rule failing on 500 records at critical severity has an impact of 4,000. Impact is a ranking, not a sum of money. Reports and the rule rankings in Insights use it to order the work.

Value at risk puts a money figure on blocked SAP features. Your organisation sets a value per record for the features it wants to price. For each priced feature, value at risk is the number of affected records multiplied by that value, shown in the tenant currency.

Value at risk is grouped by top-level business process (L1), such as procure to pay or order to cash. It is never added up across processes. Pages show the value per process and name the worst one. A feature nobody has priced shows no value, not zero.

See [Insights](/docs?page=insights).

## Fix proposals and confidence

For many failing records Meridian proposes a corrected value. A proposal comes from one of three places:

- the rule's own automatic fix, which Meridian checks by running the rule again on the proposed value;
- a value a steward enters;
- nothing, when the record needs a manual correction.

Each rule proposal carries a confidence: **High**, **Medium** or **Low**. The **Cleaning queue** shows the average confidence per rule as a percentage, and counts the records at 85% confidence or higher.

Accepted proposals are grouped into fix batches. A batch needs a second person: the person who created it cannot approve or export it. An approver can accept all high-confidence proposals in a batch at once. An approved batch is exported as a file, such as a Migration Cockpit workbook or a mass change file, and loaded into SAP through your own controlled process. On the next extraction, Meridian marks each exported record **Fixed** or **Still failing**.

See [Fix](/docs?page=fix).

## Good to know

- No language model computes any score, count or ranking. The same data and the same rules always give the same numbers.
- A score shown for a scope, such as one system or one object, is not a total for the whole installation.

## Related

- [Welcome to Meridian](/docs?page=welcome)
- [Objects](/docs?page=objects)
- [Rules](/docs?page=rules)
- [Runs](/docs?page=runs)
- [Glossary](/docs?page=glossary)
