# Master data

Master data management brings together records that describe the same real-world thing, such as one supplier held twice, and keeps one trusted version of it: the golden record. Stewards use it to review matches and merges; data owners use it to see how healthy their master data is.

The master data pages are in the **More** menu under **MDM**: **Overview**, **Survivorship**, **Golden records**, **Glossary** and **Match rules**.

## Overview

The [MDM overview](/mdm) page reads "N golden records, N waiting on a steward" under its title, with a **Survivorship rules** button.

The large figure is **MDM health**, out of 100, with a mark at 85. It reads **Healthy** at 85 or more, **Needs attention** from 60 and **Unhealthy** below 60. Four inputs make it up, each with a small trend line:

- **Coverage** (weight 40%): the share of SAP objects with a promoted golden record. Select it to open golden records.
- **Match confidence** (weight 30%): the average confidence of automatically merged records. Select it to open match rules.
- **Steward SLA** (weight 20%): the share of stewardship tasks resolved within their SLA. Select it to open the inbox.
- **Source consistency** (weight 10%): the share of fields where every source agrees with the golden record. Select it to open golden records.

**Health over time** charts the score at each snapshot.

**Match work** lists up to ten open stewardship tasks, merge decisions first, then the earliest due, with **Work**, **Object**, **Due** and **Open**. **Open** takes you to the [Inbox](/docs?page=inbox) filtered to that kind of task. **Open inbox** shows the rest.

"No MDM health snapshot" means the first snapshot has not been taken. It is taken after golden records are built.

## Golden records

A golden record is the single best version of an entity, assembled from matching records across systems. [Golden records](/mdm/golden) lists them with **SAP key**, **Object**, **Status**, **Sources**, **Confidence** and **Open issues**. Rows with open issues say **Review**; the rest say **Open**.

A record's status is one of:

- **Candidate**: assembled but not yet confirmed.
- **Pending review**: waiting for a steward.
- **Golden**: confirmed as the trusted version.
- **Superseded**: merged into another record.

Filter the list with **Domain** (Material master or Business partner), **Status**, **Min confidence %** and **Max confidence %** (0 to 100). The list shows 100 records a page.

## How to review a golden record

1. Open a record from the list. The page is titled with its SAP key.
2. On the **Overview** tab, read its status and confidence.
3. Check **Golden fields**: each field and the value the golden record holds.
4. Check **Source contributions**: each source **System**, the **Value** it holds, its **Confidence** and any **Model recommendation**.
5. Open the **Related** tab for linked records (**Relationship**, **To** and **Object**).
6. Open the **History** tab for each change (**When**, **Type** and **By**). **Audit** lists every logged action.

### Promote a record

1. Select **Promote**.
2. The dialog warns that the merged values replace the current golden fields and that this cannot be undone.
3. Select **Promote** to confirm, or **Keep as is**.

**Promote** is unavailable on a record that is already golden or superseded. It needs the approve permission (Admin, Manager, Steward and Approver).

### Write back

**Write back** does not change SAP. It confirms the golden field values are ready, shows a message that SAP write-back runs from validated findings, and then stays unavailable. See [Fix](/docs?page=fix) for how corrections reach SAP. Without the apply permission, the button is greyed out and its tooltip names the role you need, with a **Request access** link.

## How to compare sources field by field

The merge page shows, for one record, the golden value of every field beside the value each source holds.

1. Open [Merge conflicts](/mdm/golden/merge) with a record chosen in the address (`/mdm/golden/merge?id=` followed by the record's id).
2. The page title reads "Merge conflicts for" and the SAP key.
3. **Field comparison** has a column per source. Each value shows its confidence. Values that differ from the golden value are shown in red.
4. Select **Back to record** to return.

Without a record in the address, the page asks you to choose one and links to merge candidates.

## Duplicates and merging

Duplicates are found by the match rules and reviewed in two places.

The **Duplicates** page under **Insights**, **Explore** works on one record at a time:

1. On the **Clusters** tab, choose an **Object** and type a **Record ID**.
2. The cluster graph shows every record linked to it by a match.
3. Under **Pick the surviving (master) record**, choose a record. The line under it says how many documents would move.
4. Select **Create merge proposal**. Meridian creates a merge decision for each matched pair touching that record and offers **Review in the inbox**.

The same page has **Mined duplicates**, **Anomalies** and **Relationships** tabs for the chosen run. Creating merge proposals needs the approve permission.

Each merge decision then waits in the [Inbox](/docs?page=inbox). When a steward approves it, Meridian keeps the record with the higher confidence, fills its blank fields from the other, and marks the other **Superseded**. When a steward rejects it, the pair is recorded as "do not match" and is not proposed again.

The **Duplicates** tab under [Fix](/docs?page=fix) also lists candidate pairs, read-only.

## Match rules

A match rule tells the matcher how to compare one field. [Match rules](/mdm/match-rules) has three tabs.

### Rules

The table lists **Object**, **Field**, **Match**, **Weight**, **Threshold** and **State** (Active or Off). Choose a **Domain** to narrow it.

1. Select **New rule**, or select a rule and then **Edit**.
2. Fill in **Domain**, **Field** (the SAP field name, saved in capitals), **Match type**, **Weight**, **Threshold** (0 to 1) and **State**.
3. Select **Create** or **Save**. **Delete rule** removes it; **Discard changes** closes the form.

The match types are **Exact**, **Fuzzy**, **Phonetic**, **Numeric range** and **Semantic**.

To see what the rules would do, choose a domain and select **Simulate**. Meridian shows **Candidate pairs**, **Would auto-merge**, **Would dismiss** and **To steward queue**.

### Tuning

Tuning is a dry run: it re-scores the newest 50,000 stored pairs in a domain with the weights you enter. Nothing is saved.

1. Choose a **Domain**. Each active field shows with its current weight.
2. Change any weights, and set **Auto-merge at** and **Review floor** (both 0 to 1; the floor must be below the auto-merge point).
3. Select **Run dry run**.
4. Read **Pairs re-scored**, **Newly linked**, **Unlinked**, **Clusters before / after**, **Would merge** and **Would split**, and the table of pairs that would move between bands.

Pairs scoring at or above the auto-merge point would merge on their own. Pairs between the floor and that point go to a steward. Pairs below the floor are dismissed.

### Constraints

A constraint pins a pair: **Do not match** or **Always match**. Stewards create them by accepting or rejecting a pair, or by unmerging, and they override the score until cleared. Filter by domain, kind or record key. **Clear** removes one and asks for an optional reason; it needs the approve permission.

The **Rules** tab and the current weights on **Tuning** need the manage rules permission (Admin and Steward), even to read. Without it, **Rules** shows a message naming the `manage_rules` permission instead of the table, and **Tuning** shows a note that rule weights need that permission. You can still try thresholds there.

## Survivorship

When sources disagree, survivorship decides which value the golden record keeps for each field. [Survivorship rules](/mdm/survivorship) lists the rules with **Object**, **Field**, **Rule**, **Trusted sources**, **Weight**, **Status** (Active or Off) and **Set by**. **Set by** reads "Model inference" for a rule the model suggested, or "A person". **Open records** shows the golden records for that object.

The page is read-only. Until a rule exists for a field, the most recent source value wins.

## Glossary

The business glossary defines each term, where it lives in SAP and who owns it. [Glossary](/mdm/glossary) lists terms with **Term**, **Object**, **Status** (Active, Under review or Deprecated), **S/4HANA mandatory**, **Definition** (Model draft or Steward), **Rules** and **Open**. Search by term, SAP table or field, and filter by **Domain** and **Status**.

Terms are drafted from the SAP fields Meridian's rules check. Each analysis adds the terms of the objects it covered. If the glossary is empty after runs that finished before this was in place, select **Draft terms from analysed objects** (it needs the approve permission). Drafting is safe to repeat: a term that already exists is left as it is.

## How to maintain a glossary term

1. Open a term from the list.
2. Read the pills: its status, **Mandatory for S/4HANA** where it applies, and **Model draft** if the model wrote the definition.
3. Under **Definition of record**, edit **Business definition**, then select **Save**, or **Discard**.
4. To get a suggestion, select **Auto-draft**. Read the draft, then select **Use draft** to put it in the box, or **Discard**. Save it as in step 3.
5. When the term is due for review, select **Mark reviewed**. The button reads **Current** when the term is not yet due.

The term page also shows **Where it lives in SAP** (**SAP table**, **Field**, **Technical name**, **Steward**), **Approved values** with each **Code** and **Label**, **Linked rules failing** with each rule's pass rate and records affected, and **Change history**.

Saving and marking reviewed need the approve permission (Admin, Manager, Steward and Approver). Without it, **Mark reviewed**, **Save** and **Use draft** do not show and the definition is read-only. **Auto-draft** shows only with the trigger AI permission (Admin, Manager, Steward and Analyst) and is limited to 20 drafts an hour. The model receives only the term's names and descriptions (its technical name, SAP table and field, why it matters and its SAP impact), never SAP records.

## Good to know

- "No golden records" means matching has not built any yet. Start with [Match rules](/mdm/match-rules).
- "No records match" means your filters hide them; select **Clear filters**.
- Promoting a record cannot be undone.
- Merge and golden record reviews are decided in the inbox, so every decision is recorded with who made it.

## Related

- [Inbox](/docs?page=inbox)
- [Fix](/docs?page=fix)
- [Insights](/docs?page=insights)
- [Glossary of terms](/docs?page=glossary)
- [Roles and permissions](/docs?page=roles)
