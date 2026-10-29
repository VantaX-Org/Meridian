# Golden records

A golden record is the one trusted version of a thing your systems hold more than once, such as a material kept twice or a supplier in two systems. The **Golden records** tab of an object lists the match candidates waiting for review, the golden records already built and the survivorship rules that decide, field by field, which value survives. Open it from the object's tabs, for example `/v2/o/ecc-production/material-master/golden`.

## What is on it

- **Match candidates**: "148 pairs to review", best score first, each pair with its match score and both keys, for example "0.94, MATNR=5000 and MATNR=6000", and **Review**. "Showing the first 5 of 148, best score first." **Show 20 more** loads more.
- **Golden records**: "1,284 records", with golden key, name, sources, survivorship, confidence, last merged and open conflicts. The line under the table explains them: "Confidence is the match engine's score for the surviving record. Last merged is when the record last changed. Open conflicts are fields where the sources disagree and no rule has settled it."
- **Survivorship rules**: the rule per field, for example "MARA-MEINS Trusted source, ECC production" or "MARA-MATKL Most recent", with **Edit the rules**.

## The golden record inspector

Open a golden record for **Golden fields and how each value was chosen** (the value chosen, the rule that chose it, or "No rule decided this field"), its **Source records**, its open conflicts and its history ("No merge has changed this record yet."). **Choose records to split out** separates a record merged in by mistake.

## Review a pair

**Review** opens the pair: Record A and Record B **Side by side**, "The two records side by side, pick a value per field", with the **Fields that differ** and **Keep the key of** to choose the surviving key. "Each value you pick on a field that differs is kept in the merged record; the others follow the survivor." Merge the pair, or mark it **Not a duplicate** with the reason ("Why these are different materials"): "This pair will not be offered again." Every decision is in the audit log.

## Survivorship rules

"A rule decides which record's value survives in the golden record, field by field. A field with no rule keeps the survivor's value. Rules are listed by field." The rule types and what each says:

- **Most recent**: "The value from the record changed last survives."
- **Most complete**: "The longest non-empty value survives."
- **Most frequent**: the value most sources hold survives.
- **Trusted source**: "The value from the first trusted system that has one survives." List the trusted systems in priority order.
- **Chain of systems** and **Manual override**.

Each rule has a weight from 0 to 100 and can be switched off. A rule the miner suggested is marked "suggested by the miner" and takes effect only when a person saves it. **Save rules** stores them; they apply at the next match run.

## The numbers and where they come from

- **Match score** and **Confidence** come from the deterministic match engine, from 0 to 1 and as a percentage.
- **Sources** counts the records merged into the golden record.
- **Open conflicts** counts fields where the sources disagree and no rule settled it.

## What you can do, by role

- **Data owner** (approve): merge a pair or mark it not a duplicate. "Merging, or marking a pair as not a duplicate, needs the approve permission. A data owner can decide this pair."
- **Data steward** (mdm create and edit): read pairs, edit survivorship rules.
- **Everyone else**: read, export.

## Keyboard

- `j` and `k` move through candidates and golden records, `Enter` opens.
- `Esc` closes the inspector.

## When something is wrong

- **No match candidates**: matching has not run for this object, or found nothing above its threshold.
- **Many open conflicts**: a field without a survivorship rule. Add one for the fields downstream processes depend on.
- **A golden value differs from SAP**: golden records live in Meridian. SAP changes only through an approved batch or an approved write-back.
