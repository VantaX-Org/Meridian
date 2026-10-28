# Master data: survivors and golden records

Master data work answers one question: when the same supplier, customer or material exists in more than one place, which record is the one people trust? Meridian finds the pairs, proposes the values, and asks a person to decide. The output is a golden record: one best version of an entity, with a link back to every source it was built from.

Stewards review matches and merges. Analysts check coverage and health. Administrators set the rules that decide. Everyone reads the same pages, and nothing here is automatic without a person in the loop.

## What survivorship decides

When sources disagree, survivorship chooses the value the golden record keeps, one field at a time. A telephone number from the newest record, a payment term from a trusted system, an address from whichever source actually fills it: a field's rule can be the most recent, the most complete, a chosen system, or the most frequent value.

Two facts avoid most surprises. Until a field has a rule, the most recent source value wins, which is a default rather than a decision. And every rule shows whether a person set it or it was suggested from the data; a suggested rule does nothing until a person activates it.

Read the field list before you activate anything. The fields that matter are the ones downstream processes key on: name, address, bank details, payment terms, tax classification. A rule on a note field is not worth review time. A rule you did not set on a payment term will decide money.

## Match rules at a glance

[Match rules](/mdm/match-rules) decide what counts as the same thing. Each rule compares one field, exactly or fuzzily, phonetically for names, by numeric range for amounts, or semantically, and carries a weight and a threshold; the pair scores a confidence between 0 and 1.

The three bands are what you tune. Pairs at or above the auto-merge point merge on their own. Pairs between the review floor and that point go to a steward. Pairs below the floor are left alone. Raising the floor sends fewer pairs to people and hides real duplicates; lowering it buries stewards in obvious non-matches. The honest setting is the one where a steward agrees with most of what reaches them.

Two tools make this safe. A simulation shows the candidate pairs a rule would produce and how they split across the three bands. A tuning dry run re-scores the newest stored pairs with the weights and thresholds you enter, and saves nothing. Constraints are the pairs pinned as do not match or always match, created when a steward decides, and they stop the same wrong pair coming back.

Editing rules needs the manage-rules permission. Coverage matters more than cleverness: an object with no match rule has no duplicates found, which looks identical to having none.

## Reviewing a merge

Every candidate pair is decided in [match review](/mdm/golden/merge), where the two records sit side by side, differing fields highlighted and identical ones folded away. You give a reason, then merge, mark it not a match, or skip; the next pair opens by itself. On the keyboard, `j` and `k` move, `m` merges, `n` marks not a match and `s` skips, and a decision needs a reason before it goes in.

Merging needs the approve permission, and it is the least reversible act in this part of the product. Read the two records as a person who has to explain the merge later: write "same vendor, one entered with the suffix and one without", not "duplicate".

What a merge does is concrete. The surviving record keeps its values, blank fields are filled from the other, and the other is marked superseded rather than deleted, so it stays traceable. A pair marked not a match is recorded and not proposed again. Skipping costs nothing and is the right answer when you need a second opinion.

Reviewing a [golden record](/mdm/golden) is a similar act with a wider effect: the golden fields grid shows one row per field and a column per source, with the kept value highlighted and the reason it was chosen beside it. Where a value is wrong, override it with a reason rather than promoting and correcting afterwards. Promoting needs the approve permission and cannot be undone.

## When to publish survivorship

Publish survivorship rules when the fields that matter each have a rule, and merge review has run long enough to show the decisions are stable. Publish too early and you promote golden records built on defaults nobody chose: the health score looks better while the substance gets worse.

A sensible order: turn on matching for one object, review a hundred pairs and fix the thresholds that produced obvious noise, set survivorship for the fields downstream depends on, promote golden records for that object, and only then widen. Check [master data health](/mdm) as you go. It is built from golden-record coverage, the confidence of automatically merged pairs, how often stewardship tasks are resolved in time, and how far the sources agree with the golden record. Coverage carries the largest weight, which is another way of saying the most common cause of a poor score is not having looked.

Write-back of a golden record to SAP is its own controlled step: someone other than the requester approves each one, and where live write-back is switched off, golden values travel as a file your team loads.

## The glossary as shared language

The [glossary](/mdm/glossary) defines each business term, where it lives in SAP, who owns it, which values are approved and which rules check it. Terms are drafted from the fields the rules already read, so the list starts half-written and needs people to make it true.

It is not documentation for its own sake. A steward, an owner and a report all say "supplier": the glossary is what makes those the same question. When a rule disagrees with the business definition, one of them is wrong, and that disagreement is the finding. Mark a term reviewed when you have checked its definition and owner; reviews that come due arrive as tasks in the inbox.

## Next steps

- Decide pairs in [Match review](/mdm/golden/merge).
- Set the choices per field in [Survivorship](/mdm/survivorship).
- Check coverage and health at [Master data](/mdm).
