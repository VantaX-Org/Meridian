# A day as a data steward

Steward work is a queue, not a hunt. The records that need you are already listed, ranked and filtered by what the last run found. The skill is choosing the order, and keeping the numbers honest so your owner can plan around them.

## Rank the day by severity-weighted value

The fix list is worst first, and worst means severity-weighted: a rule's failing records multiplied by its severity, critical counting highest. That ranking is a decent first guess, but two adjustments make a real plan.

Critical records first, always. A critical failure blocks SAP processes and caps the object's score, so the cap does not lift until they are cleared. Work the critical count down before anything else in an object.

Then look at what you can clear in bulk. One rule failing on 8,000 records with the same checked suggestion is a morning. Ten records each needing a different typed value is also a morning, and moves the score by nothing. Severity-weighted value is the ranking; volume times a checked suggestion is the shortcut.

## Work a whole rule across an object

Open the object and work its issues from the list on the left rather than scrolling a flat record list. That list groups everything by rule, worst first, with how many records are open and how many have a suggestion. Pick one rule and drive it to zero.

This beats record order for three reasons. You learn one rule's logic and apply it 500 times, so each decision gets quicker. You can set one value across every open record of that rule, the single most productive action in the product. And the object's score moves in one step, so your owner sees progress today rather than in three weeks.

Set-one-value deserves care. It is offered on blank fields by default, so filled values are left alone. Read the count it covers, and check a handful of records first to confirm the rule's problem really is the same problem in all of them.

## Bulk accepts, and proposals worth trusting

You can select records and accept their suggestions together, take them, or mark them not an issue with one reason. At very large counts this is intended behaviour.

It stops being safe when you cannot say what the value is. Accepting a suggestion that was re-tested against its own rule is a different act from accepting a low-confidence cleaning proposal. On the second kind, read a sample: ten records. If the proposed value is wrong in a third of them, stop and send the rule back to whoever maintains it rather than approving 3,000 guesses into a batch.

The proposals tab holds values the cleaning engine suggests, grouped by object and field with their confidence. Review a group, accept or reject each, then draft a fix batch from what you approved. Rejecting is useful and remembered: a rejected value or pair is recorded so it is not proposed the same way again. Reject the same kind of suggestion every week and the rule needs tuning, not you. Say so with the rule ID: a rule whose false-positive rate stays high is visible to whoever owns rules.

Bulk sign-offs carry the same warning in reverse. Marking a thousand records not an issue with one reason is a policy decision, not stewardship, and it needs the approve permission precisely because it should be somebody's deliberate call.

## Keep the queue honest

Take the records you are actually working, and release the ones you are not. Assignment exists so colleagues and your owner can see what is held. A record taken three weeks ago and untouched reads as work in progress that is not happening.

Three habits keep the numbers true. Set the queue to yours and clear your own overdue items before picking up new ones. Empty your draft batch: accepted values sitting undrafted stay open forever, and open work is not fixed work. And when a run shows a value you sent did not take, reopen it rather than accepting it again into a new batch, because the load is usually the reason.

Your owner sees open work per person, critical and overdue counts, and the decisions you have made: accepted suggestions, typed values, sign-offs, approvals. Read that as a workload signal, not a scoreboard. Use it to make sure the view shows what you are really holding.

## Recurrence, and what owners see

Some fixes come back. A record was fixed, a later run finds it failing again, and it returns to your list. A rule with a high recurrence rate is telling you the cause is upstream: a process, an interface or a default in SAP keeps writing the bad value, and no amount of cleaning will hold.

Spot it early. When the same record key fails the same rule after two loads, stop cleaning it. Write what you found in the record's note, name the rule to your owner, and let the fix go to configuration or to the interface. That is worth more to the programme than a third clean of the same vendor.

## Next steps

- Get a batch through review in [Reviewing and approving fix batches](/inbox?kind=approvals).
- See what your owner sees about backlog at [Owners](/insights/owners).
- Work duplicates and golden records in [Master data](/mdm).
