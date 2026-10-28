# Fix your first record

A fix in Meridian is a decided value for one field of one record, a second person's approval, and a later run that proves the record now passes. Four steps, and the first takes two minutes. Do this once and the rest of the work list reads the same way.

## Start from a finding

Open the fix list from a finding, or from Fix work directly. A finding is one rule that failed on records in one run, so arriving from a finding means the rule is already filtered: every record that failed it, worst first.

Pick the run in the scope bar first; the latest finished run is the default. If the list says no finished run exists, no analysis has completed. If it says the work list is not built, build it or choose a newer run. Filters worth using on day one: the object, the severity, and the switch for records with a suggested value. Those are the quickest way to learn the flow.

## Read the record before you decide

The record panel gives you what you need, in a fixed order: the message that says what is wrong, the field and rule ID, the value the record holds now, and where a proposed value comes from.

The source matters. A suggestion can be the rule's own correction, tested by running the rule again on the new value; a fixed mapping from a known bad value to the right one; or a proposal from the cleaning engine, carrying a confidence. The first two have been checked against the rule. A cleaning proposal is a guess worth reading: check the value looks right for the record in front of you.

The panel also says why it matters, which is what goes wrong in SAP while the value stays as it is. Read that line once per rule, then trust it.

## Accept a suggestion, type a value, or sign it off

Where there is a suggestion, accept it: one decision, and the record moves to a proposed state. Where there is none, enter the value yourself and save it. If what you type still fails the rule, Meridian says so before it goes anywhere. A record with several issues can have several suggestions; accept them together rather than one by one.

Keys, once you are working a list: `j` and `k` move, `a` accepts the suggestions on the record you are on, `t` takes it so colleagues see it is yours, `u` undoes a decision, `Enter` opens the full record. After each decision the next record comes up by itself, which is the point: you are working a queue, not browsing.

Sometimes the data is right and the rule is wrong for it: a legacy material that will never be ordered again, a vendor legitimately missing a tax number. Mark it not an issue and write the reason. That reason is not a formality: it is the record of a decision, it sits in the history and the audit log, and the second person reads it when they review your batch. Where the value is genuinely wrong but the business will correct it later, accept the risk instead: the same sign-off, a different meaning. Both need the right to sign records off, and both can be withdrawn, which returns the record to the open list.

## What a draft batch is

Every value you accept or type goes into your own draft batch. It is private work in progress: it touches nothing, and nobody waits for it. A batch is a set of corrections approved and exported together, and it stays a draft until a second person approves it.

The four-eyes rule has no bypass. Whoever drafted a batch cannot approve or export it, which is why a steward's batch is opened by a data owner or another steward.

When you hand over, say what is in it. Forty accepted values against one mapping rule is easy to approve. A batch mixing three objects, a dozen rules and six sign-offs is not, and it will come back to you.

## From sign-off to SAP, and proof

An approver reads the diff and approves. The batch then waits to be exported as a file for your SAP load process, in whichever format your team uses. Meridian never changes SAP on its own: live write-back is a separate route, off unless an administrator enabled it, and each request needs someone other than the requester. Records then read sent to SAP, and nothing is confirmed yet.

Confirmation comes from a run. The next finished run of that system reads those records again. A record that now passes becomes fixed and leaves the open list. A record that still fails returns to it, with a warning that the value was sent and did not take.

When that happens, in order: check the exported file was loaded completely and into the right client; check the run you are viewing finished after the load, because only later runs reconcile; then check whether SAP wrote the value back itself, or the record now fails a different rule. Enter another value if you need to, and it goes through approval again.

## Next steps

- Work the queue in [Fix work](/fix).
- See what waits for you, and who it waits on, at [Inbox](/inbox).
