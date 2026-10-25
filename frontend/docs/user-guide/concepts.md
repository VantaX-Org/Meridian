# Key concepts

This chapter explains the words every other chapter uses: run, object, rule, issue, record, suggestion, fix batch and the six statuses a record moves through. It ends with how the data quality score is built. Read it once before you rely on a number in Meridian.

## Run

A run is one measurement of your data at a point in time. Meridian creates a run each time it extracts data from a system or you import a file. The rules then run over that data, and every score, failing record and suggestion belongs to that run.

- A run is finished when its analysis completes. Every screen shows finished runs only.
- The **Run** picker in the scope bar chooses the run for every screen. **Latest run** always follows the newest finished run.
- Runs are compared only with runs of the same source, called the run's lineage. Every extraction from one system is one lineage; imported files are grouped by the objects they carry.
- A baseline is a run you pin as the reference for later runs, such as the run after a clean-up.

Each finished run also gets a work list: the failing records ranked worst first, with their statuses. Fix work reads that list. Runs from before the work list existed have none until someone builds it (see [Troubleshooting](/docs?page=troubleshooting)).

## Object

An object is one area of SAP data that Meridian measures as a whole, such as Material master, Business partner, Accounts payable or eWMS stock. Each object has its own rules, its own score and a verdict: **Go**, **At risk** or **No-go**. See [Objects](/docs?page=objects).

## Check and rule

A rule, also called a check, is one fixed test on the data, with an ID such as `MM001`. Each rule has a dimension, a severity (critical, high, medium or low), the field it reads, a plain message that says what is wrong, and usually an instruction for fixing it. The same data always gives the same result. See [Rules](/docs?page=rules).

## Record

A record is one row a rule judges, such as one material, one vendor or one sales order line. It is identified by its record key, built from its SAP key fields, for example `MATNR=000000000010001234`. Where the data carries a name, Meridian shows the name first and the key under it.

## Issue

An issue is one rule that one record fails. A record can have several issues: a vendor may lack a tax number and carry an invalid bank key at the same time. In Fix work, the **Issues** list on the left groups the issues by rule, so you can work one problem across many records, and the record panel lists every issue of the record you picked.

## Suggestion

A suggestion is the value Meridian proposes for a failing field. It comes from one of three places, and the record panel says which:

- **Rule fix, checked against the rule**: the rule's own correction, tested by running the rule again on the new value.
- **The rule's fix for this value**: a fixed mapping from a known bad value to the right one.
- **Cleaning engine**: a proposal from the cleaning queue, with its confidence.

Not every issue has a suggestion. When there is none, you enter the value yourself.

## Fix batch

A fix batch is a set of record-level corrections that are approved and exported together. When you accept a suggestion or enter a value in Fix work, it goes into your own draft batch, named "Fixes by" and your name. A second person must approve the batch: the person who drafted it can neither approve nor export it. The approved batch is exported as a load file for SAP. See [Approvals and export](/docs?page=approvals).

## The six statuses

Every failing record in the work list has one status:

1. **To fix**: nobody has decided a value yet.
2. **Fix proposed**: a value waits in a draft fix batch for a second person to approve.
3. **Approved**: the batch is approved and waits to be exported for the SAP load.
4. **Sent to SAP**: the batch was exported; the next run confirms the fix.
5. **Not an issue**: someone with the approve permission signed it off as an exception, with a reason.
6. **Fixed**: a later run showed the record passing.

The first four are open work. **Still open** in a status filter means any of them. A record whose value was sent to SAP but that the next run still finds failing goes back to **To fix**, with a warning that says so.

## The data quality score

The data quality score (DQS) runs from 0 to 100. Each rule gives a record-level pass rate; severity scales the failing share; rules are averaged into six dimensions (completeness and accuracy 25% each, consistency 20%, timeliness, uniqueness and validity 10% each); and the dimensions are weighted into the object's score. One critical rule failing over tolerance caps the score at 85, two or more at 70. The weights can be changed per tenant on **Scoring and alerts**.

## Related

- [Welcome to Meridian](/docs?page=welcome)
- [Fix work](/docs?page=fix)
- [Approvals and export](/docs?page=approvals)
- [Glossary](/docs?page=glossary)
