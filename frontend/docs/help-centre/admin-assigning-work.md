# Assigning tasks to users

Work reaches people through three things working together: ownership set on objects and rules, triage rules that route new issues, and queues people can see. Get those right and the fix list organises itself week after week. Get them wrong and every steward works on whatever they noticed first.

## Say who owns what

Ownership is set on the object page, where an owner and a steward can be chosen from the active users of this tenant. The same two fields sit on a rule page under its lineage and ownership card, so a rule that keeps causing arguments has a name against it. Changing ownership needs the assign permission; without it the page shows who holds the role and offers nothing to change.

Owners matter beyond the label. When no assignment rule matches, routing falls through in a fixed order: the rule's owner, then the object's owner, then the steward named on the glossary term, then the tenant's fallback user. An object with no owner is a queue with no bottom.

## How a new issue finds a person

After each analysis, and again on a five-minute sweep, unassigned issues are put through your assignment rules in order. The first match wins: a rule can narrow on severity, object, rule id, dimension, company code, plant or sales organisation, and it sends what matches to a team or a named person. Inside a team, work is spread either round robin or to whoever is least loaded, which is the setting that matters when one steward is on leave.

Anything unmatched goes to the fallback chain above, which is why the fallback user on the working calendar is worth setting deliberately: it is the person who quietly receives everything your rules do not describe.

Assignment starts a clock. An issue with no deadline takes its acknowledge and resolve times from the SLA policy matching its severity, and optionally its object, counted in business hours against your working calendar. Waiting states pause the clock, and leaving one moves the deadlines by the time spent waiting. At-risk and breached each raise one notification, never a repeat every sweep.

## The queues people actually work from

Fix work is where record-level work happens. A steward takes records for themselves, releases them, or hands one to a named colleague from the record panel; a whole selection can be taken at once. The Inbox holds approvals, exceptions and review tasks with the same claim, reassign and release actions, and exceptions carry their own deadlines and escalation. Keep the model simple: route by rule and severity, let people claim within that, and reserve named assignment for items that genuinely need one specific person.

## Configure it on the triage page

The triage page holds teams, assignment rules, SLA policies and the working calendar. Teams take a name, a strategy, a lead and members, and show their open items. Assignment rules can be switched off and moved up or down, because the order is the policy. SLA policies show acknowledge and resolve times, the at-risk share and whether the clock counts business or calendar hours; deleting an override sends that severity back to the default. The calendar sets the time zone, work days, hours, holidays and the fallback user, and it warns before changing the time zone because extraction schedules move with it.

Teams, rules and SLAs need the manage rules permission; the calendar needs manage settings. Everyone can read them.

## Tell people what they are holding

The owners view ranks people by the score of the records assigned to them, with open issues by severity, movement over the last seven days, what each owner fixed and how old their oldest item is. Each row opens that person's inbox. The same page sends the weekly digest on demand, for one owner or for everyone, which writes the notification without changing the schedule; someone who has chosen their own digest frequency in their preferences is served by that instead.

Alert channels carry the same news out of the app: email, Slack, Teams or a signed webhook, each with a digest frequency, an option to send new critical findings immediately, and a test you can send before you trust it. Alerts carry counts, rule ids and links, never record values, which is what makes them safe on a shared channel.

Report schedules are a lighter form of the same idea: a named report on a daily, weekly or monthly cadence at a set time in a chosen zone, sent to up to fifty users and up to twenty alert channels. Recipients must be active and hold the export permission, or the schedule is refused.

## Balance the load before it piles up

The progress view has a workload table: open rule failures, critical count and overdue items per person, with an explicit row for nobody yet. That last row is the one to read first, because unassigned work is not late, it is invisible. Decisions per person sit beside it, so a large backlog held by someone making no decisions reads differently from the same backlog worked steadily.

Move work where the evidence says to: an assignment rule for the object that keeps landing on one person, an SLA override for a severity your calendar cannot meet, and a scheduled report so the numbers arrive without anyone asking.

## Next steps

- Set teams, routing and deadlines at [Triage](/admin/triage).
- Read the workload table in [Progress](/insights/progress).
- Send owners their digest from [Owners](/insights/owners).
