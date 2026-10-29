# Master data

Master data management brings together records that describe the same real thing, such as one supplier held twice, and keeps one trusted version of it: the golden record. Stewards review matches and merges here; data owners see how healthy their master data is.

Open **More**, **Master data**: **Overview**, **Survivorship**, **Golden records**, **Glossary** and **Match rules**. Every role can read these pages.

## Overview

The [overview](/mdm) shows **MDM health** out of 100: **Healthy** at 85 or more, **Needs attention** from 60 and **Unhealthy** below. Four inputs make it up, each with a small trend line:

- **Coverage** (40%): the share of SAP objects with a promoted golden record.
- **Match confidence** (30%): the average confidence of automatically merged records.
- **Steward SLA** (20%): the share of stewardship tasks resolved within their SLA.
- **Source consistency** (10%): the share of fields where every source agrees with the golden record.

**Health over time** charts the score, and **Match work** lists the open stewardship tasks, merge decisions first, each opening the [Inbox](/docs?page=inbox).

## Golden records

[Golden records](/mdm/golden) lists each record with its SAP key, object, status, sources, confidence and open issues. A status is **Candidate** (assembled, not confirmed), **Pending review**, **Golden** (the trusted version) or **Superseded** (merged into another record). Filter by **Domain**, **Status** and confidence.

### How to review a golden record

1. Open a record. Read its status and confidence on **Overview**.
2. Check **Golden fields**: one grid with a row per field and a column per source (a column per merged record once records are merged). The value the golden record kept is highlighted, and **Chosen by** says why in words, such as "Source priority from PRD", with the record key or upload label beside it. Approvers can **Override** a field there, with a reason.
3. Select **Promote** to make it golden. The merged values replace the current golden fields, and this cannot be undone. Promoting needs the approve permission.

**Related**, **History** and **Audit** list linked records, each change and every logged action.

## Duplicates and merging

The match rules find candidate pairs. Every pair is decided in **Master data**, [**Match review**](/mdm/golden/merge): the pairs are listed on the left, and the selected pair is shown on the right with the two records side by side, the fields that differ highlighted and the identical ones folded away. Give a reason, then select **Merge**, **Not a match** or **Skip**; the next pair opens on its own. On the keyboard, **j** and **k** move between pairs, **m** merges, **n** marks not a match and **s** skips (without a reason, **m** and **n** put you in the reason box; press Ctrl Enter, or ⌘ Enter on a Mac, to send). Merging and marking not a match need the approve permission.

Pairs also reach you from:

- **Match review**: every duplicate pair, from the match rules and the cleaning engine, compared field by field; keep one or mark it not a match. Old links to Fix work's Duplicates tab open it.
- **Insights**, **Explore**, **Duplicates**: pick an object and a record, see its cluster, choose the surviving record and select **Create merge proposal**. Below it are the matcher's **Scored pairs** and the miner's **Likely duplicates**; **Review** on a likely duplicate opens it in Match review. Anomalies are under **Patterns** and field relationships under **Lineage**.
- The [Inbox](/docs?page=inbox): each merge decision waits there. Approving keeps the record with the higher confidence, fills its blank fields from the other and marks the other **Superseded**. Rejecting records the pair as "do not match".

Creating merge proposals and merging need the approve permission.

## Match rules

[Match rules](/mdm/match-rules) has three tabs:

- **Rules**: each rule compares one field (**Exact**, **Fuzzy**, **Phonetic**, **Numeric range** or **Semantic**) with a weight and a threshold. **Simulate** shows the candidate pairs and how many would auto-merge, be dismissed or go to a steward.
- **Tuning**: a dry run that re-scores the newest stored pairs with the weights and thresholds you enter. Pairs at or above **Auto-merge at** merge on their own, pairs between **Review floor** and that point go to a steward, and pairs below are dismissed. Nothing is saved.
- **Constraints**: pairs pinned as **Do not match** or **Always match**, created when a steward accepts, rejects or unmerges a pair.

Editing rules needs the manage rules permission.

## Survivorship

When sources disagree, [survivorship](/mdm/survivorship) decides which value the golden record keeps, field by field: for example the most recent, the most complete or a trusted system. **Set by** shows whether a person or the model suggested the rule; a suggested rule takes effect only once a person activates it. Until a field has a rule, the most recent source value wins.

## Glossary

The [glossary](/mdm/glossary) defines each business term, where it lives in SAP and who owns it, with its approved values and the rules that check it. Terms are drafted from the fields Meridian's rules check. Open a term to edit its **Business definition**, ask for an **Auto-draft**, or select **Mark reviewed** when it is due.

## Related

- [Inbox](/docs?page=inbox)
- [Approvals and export](/docs?page=approvals)
- [Rules](/docs?page=rules)
- [Glossary](/docs?page=glossary)
