# Reviewing and approving fix batches

You are the second pair of eyes. Every value that reaches SAP has been decided by one person and approved by another, and you are usually the other. The rule is absolute: whoever drafted a batch cannot approve or export it. Your job is not to re-do the steward's work but to decide whether it is safe to load.

## What lands in Approvals

Open the approvals list in the inbox. Two kinds of thing wait there.

Fix batches are the main one. Each row names the rules it fixes, who requested it, how many records it holds, and its first change, written as the SAP field, the record and the pair of values: the old one, then the new one. Filters separate what is waiting for approval from what is approved, exported, or everything.

SAP write-back requests are the other kind. They ask Meridian to send an approved change straight into SAP rather than through a file. Live write-back is off unless an administrator turned it on; where it is off, the card says so and fixes go out as files. You cannot approve a request you made, any more than your own batch.

Merge decisions and other master-data approvals arrive here too, but the daily load is batches.

## Read the diff before you approve

Open the batch and read it as a change set, not as a count. Four things answer most questions.

- Items: every record with its field, the value it holds now, the value proposed, where the proposal came from, and its confidence. Values from a rule that has been re-tested against the rule are strong; cleaning engine proposals with low confidence deserve a look at the actual record.
- Before and after: each changed field as `TABLE.FIELD` with old and new values. This is the line you are actually approving.
- Who and when: the drafter, the history of the batch, and every change made to it.
- Exported files, once it has been exported: format, who exported, who approved, and the file's fingerprint, so you can check that the file loaded into SAP is the file Meridian produced.

Check the shape of the batch too. A batch of one rule and one object with a consistent change is easy to reason about. A batch spanning several objects, mixing typed values and sign-offs, is worth sending back for splitting even if every individual value looks fine.

## Approving, and sending back

Approve when the changes are right, or when they are right enough to load and the rest can be fixed afterwards. Say what you approved and when, which the batch records for you.

Send back when one of these is true. The reason on a sign-off does not hold, or is missing. The values look accepted in bulk without being read. The batch includes records you cannot see the effect of. The proposed value fails a rule you can name. Sending back is not a verdict on the steward; it is the control working. Put the reason in words the drafter can act on, and reference the rule ID.

While a batch is still a draft you can change a proposed value yourself: pick the item, type the correct value, and that is what goes forward. Do it for one obvious correction rather than bouncing a whole batch for one field.

Withdrawing a sign-off is a separate act from approving a batch, and it needs the same right that made the sign-off. If a record was marked not an issue and you disagree, withdraw it: the record returns to the open list with the withdrawal recorded, and the steward sees why. Use it for a decision that was wrong, not for a decision you would merely have made differently.

## When the change reaches SAP

Approval does not touch SAP. It is Meridian's record that the values are correct. The approved batch is then exported as a load file, in whichever format your team's process uses, and your own controlled process loads it: Migration Cockpit, a mass change, or a mass maintenance run.

Where live write-back is switched on and approved, the change goes to SAP through that route instead. Either way, the record's status moves to sent to SAP, and the work is not finished until a run says so.

The next finished run of that system reconciles every exported record. Those that pass become fixed. Those that still fail return to the fix list, and the batch shows them as still failing after export. That figure is yours to watch: a batch with a high still-failing count points at the load, the client, or a rule that keeps losing to an interface.

## What to ask before you say yes

Short questions, quickly answered from the batch itself.

- Who drafted this, and have I approved their work before?
- What changed in SAP between the run the batch was cut from and now?
- Is any of this a critical value that blocks a process, where an unnecessary change costs more than leaving it open?
- Does the reason on each sign-off explain why the business accepts it?
- Can I say what one wrong value in here would cost? If not, look at the records that hold keys used by other objects.
- Has the same rule been approved and re-fixed twice? Then approve this load and raise the rule, not the steward.
- Would I be comfortable if an auditor read this batch, this reason and this name beside my approval? That is exactly what they will do.

## Next steps

- See the work the batch came from in [Fix work](/fix).
- Check which rules are failing most at [Failing rules](/insights/rules).
- Read the full approval reference in [Documentation](/docs).
