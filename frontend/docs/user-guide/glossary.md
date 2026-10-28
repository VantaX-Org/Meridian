# Glossary

The words Meridian uses with a specific meaning, in alphabetical order. Each entry links to the chapter that explains it in full.

### Accept risk

A sign-off for a record that is wrong but acceptable for now, such as a value the business will correct later. Like **Not an issue**, it needs a reason, which is kept in the record's history, and the approve permission. The record then reads **Not an issue**. See [Fix work](/docs?page=fix).

### Applicability

Whether a rule applies to a system. Once the system's configuration is loaded, each rule is checked against it. **Applies** means the configuration uses the field. **Does not apply** means it does not, so the rule is skipped. **Applies by default** means no configuration is loaded yet. **Not available** means the system cannot supply what the rule needs. See [Rules](/docs?page=rules).

### Approved

The status of a record whose value sits in a fix batch a second person has approved. It waits to be exported for the SAP load. See [Approvals and export](/docs?page=approvals).

### Baseline

The run you pin as the reference for later runs from the same source, such as the run before a cleansing project. Each lineage has at most one. Comparisons use the baseline when there is one, and the previous run otherwise. See [Analysis](/docs?page=analysis).

### Basis

What a figure is measured against: which rules were counted, which records they ran over and which run produced them. A percentage only means something with its basis. Rules that do not apply to your configuration are left out of the basis rather than counted as passes. See [Rules](/docs?page=rules).

### Blocking rule

A failing rule that stands in the way of a Go verdict. On Home and on object pages it is a failing rule of critical or high severity. The readiness views count failing critical rules and the rules the S/4HANA readiness rule map marks as blocking. Also called a blocker. See [Key concepts](/docs?page=concepts).

### Cadence

How often an object is checked by itself, such as daily at 02:00, or manual only when nobody scheduled it. Freshness is judged against it. See [Monitoring](/docs?page=monitoring).

### Cap

A ceiling on an object's score when critical rules fail. One critical rule over tolerance caps the score at 85; two or more cap it at 70. The score shows the capped value, the measured value beyond it and the rules that caused the cap, so you can see what to fix to lift it. See [Key concepts](/docs?page=concepts).

### Confidence

How sure Meridian is that a proposed fix is right: **High**, **Medium** or **Low**. A high-confidence proposal from a rule has been checked by running the rule again on the new value. An approver can accept all high-confidence proposals in a batch at once. See [Approvals and export](/docs?page=approvals).

### Conformance

How closely the cases found by process discovery follow the intended process model. Each case is replayed against the model to find skipped steps, extra steps and steps in the wrong order. It is summarised as fitness and listed per step. See [Analysis](/docs?page=analysis).

### Contract

A data contract: an agreed quality level for a set of data, such as a minimum score or a maximum number of failing records. It is checked after every run and marked met or breached. A breach notifies the owner. See [Rules](/docs?page=rules).

### Critical tolerance

How much a critical rule may fail before it caps the score. By default a failing critical rule caps the score when it fails on at least 0.1% of the records it checked, or on at least 25 records. The tolerance is set per tenant. See [Key concepts](/docs?page=concepts).

### Data quality score (DQS)

A score from 0 to 100 for how fit the data is. It is built from record-level pass rates, scaled by severity, averaged per dimension and then weighted across the six dimensions: completeness and accuracy 25% each, consistency 20%, and timeliness, uniqueness and validity 10% each. The weights are configurable per tenant. Failing critical rules can cap it. See [Key concepts](/docs?page=concepts).

### Dimension

One of the six ways data quality is measured, from DAMA DMBOK. Completeness asks whether values are present, accuracy whether they are right, consistency whether related values and systems agree, timeliness whether data is current, uniqueness whether records repeat, and validity whether values follow the format. Every rule belongs to one dimension. See [Key concepts](/docs?page=concepts).

### Draft batch

Your own fix batch that collects every value you accept or enter in Fix work, named "Fixes by" and your name. It is created on your first decision and stays a draft until a second person approves it. See [Approvals and export](/docs?page=approvals).

### Drift

A change in configuration or in how data behaves since it was last read, such as a field that turned from optional to required. Each drift entry names what changed and when, so a change in the score can be traced to a change in SAP rather than to the data. See [Data in](/docs?page=data-in).

### Dry run

A trial load that shows what the target system would reject, without changing anything. The target's own checks are applied to the source records and the blocked records are listed with the reason. See [Data in](/docs?page=data-in).

### Field status

Whether a field is required, optional, display only or suppressed in your SAP configuration. Meridian reads it from the configuration to decide whether an empty value is a defect. A required field that is empty fails; a suppressed one is not expected to hold data. See [Data in](/docs?page=data-in).

### Finding

The result of one rule in one run: how many records the rule checked, how many failed and which ones. A failing finding lists its records, why it matters and how to fix it. See [Key concepts](/docs?page=concepts).

### Fitness

A measure from 0 to 1 of how many discovered process cases can be replayed on the reference model without deviation. It is 1 when every case fits exactly and falls as cases skip, repeat or reorder steps. See [Analysis](/docs?page=analysis).

### Fix batch

A set of record-level corrections approved and exported together. A second person must approve it: the person who drafted the batch cannot approve or export it. The export is a file, such as a Migration Cockpit workbook or a mass change file, that you load into SAP through your own process. On the next run each record is marked **Fixed** or **Still failing**. See [Approvals and export](/docs?page=approvals).

### Fix proposed

The status of a record whose value waits in a draft fix batch for a second person to approve. **Undo** takes the value back out. See [Fix work](/docs?page=fix).

### Fix sheet

An Excel workbook of the filtered work list, one row per record and failing check, with blank **New value**, **Decision** and **Reason** columns. Fill it in offline and import it back; each row becomes a decision in your draft batch. See [Fix work](/docs?page=fix).

### Fixed

The status of a record a later run showed passing. Only a run can mark a record fixed, so the count always reflects what SAP now holds. See [Key concepts](/docs?page=concepts).

### Four eyes

The rule that two people handle every fix: one decides the value, another approves the batch. The person who drafted a batch cannot approve or export it. See [Approvals and export](/docs?page=approvals).

### Freshness

Whether an object has been checked as often as its cadence promises: Fresh, Due, Stale, Failed, Paused or Manual. Stale means older than one and a half times the cadence. See [Monitoring](/docs?page=monitoring).

### Ghost configuration

Configuration that exists in SAP but is never used in a transaction, such as a payment term or a plant that no document refers to. It adds noise to checks and choices to users. The list helps you decide what to retire before a migration. See [Data in](/docs?page=data-in).

### Golden record

The single best version of a business partner, material or other entity, assembled from matching records across systems. Survivorship rules pick each field's value. The golden record links back to every source record, so a change can be traced. See [Master data](/docs?page=mdm).

### Grain

The level a rule judges at, such as a header row, a line item or a document. Counting at the right grain keeps the pass rate honest: one purchase order with five bad lines is one failing document and five failing lines. See [Rules](/docs?page=rules).

### Grant

A role given to a user in addition to their main role, for all systems, for one system, for one object, or for one object on one system. A grant adds rights only where it applies. See [Roles and access](/docs?page=roles).

### Happy path

The most common route through a process, ideally the one the design intended. Its share of all cases shows how standard the process really is. See [Analysis](/docs?page=analysis).

### Impact

A number that ranks the work: the failing records of a rule multiplied by a severity weight of 8 for critical, 4 for high, 2 for medium and 1 for low. It is a ranking, not a sum of money. See [Key concepts](/docs?page=concepts).

### Issue

One rule that one record fails. A record can have several issues. In Fix work the **Issues** list groups them by rule, so you can work one problem across many records. See [Key concepts](/docs?page=concepts).

### Lineage

The chain of runs that come from the same source and may be compared. Runs extracted from a system belong to that system's lineage. Imported files are grouped by the objects they carry. Trends and comparisons never cross lineages. See [Key concepts](/docs?page=concepts).

### Match rule

A rule that scores how likely two records describe the same real-world entity. It compares chosen fields, exactly or fuzzily, and gives each pair a confidence between 0 and 1. Pairs above the automatic merge threshold are merged, pairs in the review band go to a steward, and pairs below it are left alone. See [Master data](/docs?page=mdm).

### Not an issue

The status of a record someone signed off as an exception, with a reason: the value is right for the business even though the rule flags it. It needs the approve permission and can be withdrawn. See [Fix work](/docs?page=fix).

### Object

One area of SAP data that Meridian measures as a whole, such as Material master, Business partner or FI general ledger. Each object has its own rules, score and verdict. See [Objects](/docs?page=objects).

### Pass rate

The share of the records a rule checked that passed, from 0 to 100. Every score in Meridian is built from pass rates, so a rule failing on one record in a million barely moves the score. See [Key concepts](/docs?page=concepts).

### Population exclusion

Records a rule deliberately skips, such as a vendor already flagged for deletion. Excluded records are neither passes nor failures, and the exclusion is listed with the rule so it can be reviewed. See [Rules](/docs?page=rules).

### Proven cost

Money measured on documents actually posted in SAP with a defective value, such as a payment sent twice. It is shown per top-level process in the tenant currency and is never added up across processes. See [Analysis](/docs?page=analysis).

### Readiness verdict

Whether an object is ready to use or load: **Go** when the score meets the target and no critical rule is over tolerance, **At risk** when the score is at or above the warning threshold, and **No-go** below it. Reports call At risk "conditional". See [Key concepts](/docs?page=concepts).

### Record

One row a rule judges, such as one material, one vendor or one sales order line. Each record is identified by its record key. See [Objects](/docs?page=objects).

### Record key

The SAP key fields that identify a record, such as the material number, written as `MATNR=...`. Type a record key in search to jump to the record. See [Objects](/docs?page=objects).

### Role

The set of rights a user holds, such as Data steward, Analyst or Viewer. Every user has one main role, and may hold more through grants. See [Roles and access](/docs?page=roles).

### Root cause

Whether a failure comes from bad data, bad configuration or both. A mistyped value is a data problem; a field that the rule treats as mandatory but SAP does not is a configuration problem. Knowing which sends the fix to the right team. See [Objects](/docs?page=objects).

### Rule

One fixed, deterministic check on the data, with an ID such as `MM001`, a dimension, a severity and a grain. The same data always gives the same result. See [Rules](/docs?page=rules).

### Run

One measurement of your data at a point in time, created by an extraction from a system or by an imported file. Every score, finding and record list belongs to a run. See [Analysis](/docs?page=analysis).

### Scope

The systems, objects and records a figure or a grant covers. A figure shown for a scope is not a total for the whole installation. A scoped grant gives a role for one system, one object or both. See [Roles and access](/docs?page=roles).

### Score band

The range a score falls in, set by three thresholds. By default 90 or more meets the target, 75 to below 90 is a warning, below 75 fails, and below 60 is the critical band. See [Key concepts](/docs?page=concepts).

### Sent to SAP

The status of a record whose batch was exported for the SAP load. The next run confirms the fix: the record becomes **Fixed**, or goes back to **To fix** if it still fails. See [Approvals and export](/docs?page=approvals).

### Severity

How much a rule's failure matters: critical, high, medium or low. Severity changes how a failure counts in the score, in the cap, in blocking and in impact. See [Key concepts](/docs?page=concepts).

### Steward

The person who looks after the data in an area and fixes its failing records. Stewards work from Fix work and the Inbox. Data steward is also a role in Meridian, and stewards land on Fix work after sign-in. See [Roles and access](/docs?page=roles).

### Still failing

A record that was sent to SAP but that the next run still finds failing. It returns to **To fix** with a warning, and its batch item reads **Still failing**. See [Troubleshooting](/docs?page=troubleshooting).

### Suggestion

The value Meridian proposes for a failing field: the rule's own fix, checked by running the rule again on the new value, the rule's fixed mapping for a known bad value, or a cleaning engine proposal with its confidence. Accept it with one click or the `a` key. See [Key concepts](/docs?page=concepts).

### Survivorship

The rules that choose, field by field, which source value a golden record keeps when sources disagree: for example the most recent, the most complete, the trusted system or the most frequent. Rules suggested by the AI take effect only once a person activates them. See [Master data](/docs?page=mdm).

### To do

The ranked list of what needs a person now in your scope, opened from the flag in the index bar. Each item has one button that opens its fix. See [To do](/docs?page=todo).

### To fix

The status of a failing record nobody has decided a value for yet. It is open work, together with **Fix proposed**, **Approved** and **Sent to SAP**. See [Key concepts](/docs?page=concepts).

### Unmaintained field

A field that exists in SAP but is almost never filled in. It usually means the field is no longer part of the business process. Meridian lists these so you can retire the field or the rule that checks it. See [Data in](/docs?page=data-in).

### Value at risk

A money figure for SAP features blocked by bad data: the number of affected records multiplied by the value per record your organisation sets for that feature. It is shown per top-level business process in the tenant currency, never added up across processes. A feature nobody has priced shows no value. See [Analysis](/docs?page=analysis).

### Variant

A distinct path that cases take through a process. Cases with the same sequence of steps form one variant. Many rare variants point to rework, workarounds or steps done out of order. See [Analysis](/docs?page=analysis).

### Wave

A batch of objects and systems migrated together in one cutover, with one verdict: Go when it meets its minimum readiness, At risk when close, and No-go when blocking records remain. See [Data in](/docs?page=data-in).

### Work list

The failing records of one run, ranked worst first with their statuses, built as part of every analysis. Fix work and each object's **Records to fix** tab read it. See [Fix work](/docs?page=fix).

### Write-back

Sending an approved change straight into SAP instead of exporting a file, offered as **Write back** on a golden record. Someone other than the requester must approve each request, under **Approvals** in the Inbox, beside the fix batches. A deployment can switch live write-back off; you then export fixes as a file and load them in SAP. See [Approvals and export](/docs?page=approvals).

### Z-object

A customer-defined table, field or program in SAP, named with a Z or Y prefix. Meridian finds them, lists who owns them and whether they are documented, and flags unusual values in them. See [Data in](/docs?page=data-in).

## Numbers on screen

Every number Meridian shows has one name and one meaning, listed here in the order they appear in the product.

### Score

The data quality score of the object or run, from 0 to 100, held down when a critical rule fails.

### Verdict

Go, At risk or No-go, from the score and your score bands.

### Failing rules

Rules that failed on at least one record in the run.

### Critical and high failing rules

Failing rules of critical or high severity, the ones that stand in the way of a Go verdict.

### Rule failures

Failing records summed over every failing rule: a record failing two rules counts twice.

### Records to fix

Distinct records in the work list that still need a decision, however many rules they fail.

### Critical records

Records to fix whose worst failing rule is critical.

### With a suggested value

Records to fix that already carry a suggested value you can accept.

### Overdue records

Records to fix that are past their due date.

### Approvals waiting

Fix batches and SAP write-backs that wait for a second person to approve.

### Open inbox items

Inbox items that are open, in progress or escalated.

### Overdue inbox items

Open inbox items that are past their due time.

### Objects below target

Objects whose verdict is At risk or No-go.

### New failing records

Records that fail in this run and passed in the baseline.

### Recovered records

Records that failed in the baseline and pass now.

### Newly failing rules

Rules that fail now and did not fail in the baseline.

### Recovered rules

Rules that failed in the baseline and have no failures now.

## Related

- [Key concepts](/docs?page=concepts)
- [Fix work](/docs?page=fix)
- [Roles and access](/docs?page=roles)
- [Keyboard shortcuts and search](/docs?page=shortcuts)
