# Usability test script

A moderated session script for testing the journeys on the live site with five people per role. Five sessions per
role find most of the problems a role meets; run the roles in this order, because each feeds the next with real work:
administrator, SAP Basis, data steward, data owner, programme lead, auditor.

- **Format**: 60 minutes, one participant, one moderator, one note-taker; remote with screen sharing or in the room.
- **Site**: the customer's own Meridian, on a test tenant or with sandbox mode on (Administration, Settings, **Enter
  sandbox mode**) so decisions do not reach real batches. Never record SAP record values: the recording shows the
  screen, so use the test tenant's own data and keep recordings inside the customer's environment.
- **Participants**: people who will hold the role in production, not the project team. No names in the notes: use
  the participant code (for example ST-3 for the third steward).
- **Measures per task**: success (completed, completed with help, failed), time on task, clicks (from the recording),
  errors, the moment of hesitation (more than 10 seconds without acting), and the post-task rating.
- **Compare with**: the targets of each journey and the friction findings ([friction-audit.md](friction-audit.md));
  note when a finding shows up (for example "F06 observed: owner did not know a batch waited").

## 1. Before the session (moderator)

- [ ] The participant has an account with the role under test and has signed in once.
- [ ] The tenant has a finished run, a batch waiting for approval (built by someone other than the owner under test),
      a failed job and a wave with a gate.
- [ ] Recording on; the observation sheet open; a timer.
- [ ] Browser at the participant's usual size; for the phone sessions (one per role), the participant's phone.

## 2. Consent and introduction (5 minutes, read aloud)

> Thank you for taking part. We are testing Meridian, not you: if something is hard, that is what we need to find.
> There are no wrong answers.
>
> I will ask you to do some tasks you would do in your job. Please think aloud: say what you are looking for, what
> you expect, and what surprises you. I may not answer questions during a task, because I want to see what you would
> do on your own; ask anyway, and I will answer afterwards.
>
> We would like to record the screen and your voice. The recording stays inside your company's environment, is used
> only by the people improving the product, and is deleted after the analysis. Your name will not appear in any
> report; you are a code such as ST-3. You may pause or stop at any time, and skip any task, without giving a reason.
>
> Do you agree to take part and to the recording?

- [ ] Consent given (spoken, on the recording) and noted on the sheet with the date.
- [ ] Warm-up: "What did you do last in your job that involved SAP master data? What made it slow?" (2 minutes)

## 3. Tasks by role

Give each task on a card, in the participant's words, without the names of controls. Start the timer when the card
is read, stop it when the participant says they are done or at twice the target time. Success criteria are what the
note-taker checks; the participant never sees them.

### Administrator (journey: [first live week](first-live-week.md))

| # | Task card | Success criteria | Target |
|---|---|---|---|
| A1 | "Check that this installation is licensed and see until when." | Reaches `/admin/licence`, runs **Check with Meridian HQ now**, says the expiry | 2 min, 3 clicks |
| A2 | "Give a new colleague access as SAP Basis." | **Invite a user** with role SAP Basis sent from `/admin/users` | 3 min, 4 clicks |
| A3 | "Finance says one failing record of a critical rule costs 400 in your currency. Make Meridian use that." | **Save cost model** with the currency and the critical cost; says where the amounts now read differently | 4 min, 5 clicks |
| A4 | "Make sure every material master record has an owner who approves its fixes." | Owner set in **Stewardship**, **Check what applying does**, **Apply** | 5 min, 6 clicks |

### SAP Basis (journeys: [first live week](first-live-week.md), [Basis operations](basis-operations.md))

| # | Task card | Success criteria | Target |
|---|---|---|---|
| B1 | "Add our quality system so Meridian can read it, and check the connection works." | Reaches `/s/new` (note how: button, command line, typed address), **Test connection** passes, **Connect system** | 5 min, 4 clicks |
| B2 | "Before reading anything, find out how long reading material master and vendors would take." | **Dry run** in the system inspector with both objects; reads the duration | 3 min, 5 clicks |
| B3 | "Something failed overnight. Find out what and get it working again." | Opens the failed job, reads the cause, fixes the connection (or names the SAP-side fix), retries | 6 min, 3 clicks to the fix |
| B4 | "Material master should be read every weekday morning, changes only." | A schedule with **Changes only** on weekdays in the system's **Schedules** view | 3 min, 4 clicks |

### Data steward (journey: [find, fix, approve, send](find-fix-approve-send.md))

| # | Task card | Success criteria | Target |
|---|---|---|---|
| S1 | "Start your day: what should you work on first?" | Names the rule or rows with the most value at risk, from the start screen or Work | 1 min, 0 to 1 clicks |
| S2 | "Meridian suggests values for one rule. Accept them where they are right." | Accepts a rule's suggested values with the confirmation (or by selection); sees the notice and the counts move | 4 min, 3 clicks |
| S3 | "This record has no suggestion. Give it the right value." | Opens the record, types a valid **New value**, `Enter` | 3 min, 3 clicks |
| S4 | "Who will check your changes, and how will they know?" | Finds **Waiting for approval**; says who approves; note whether they believe the owner is told (F06) | 2 min, 1 click |
| S5 | "Your last batch came back. Find out why." (a sent-back batch is prepared) | Finds the batch and reads the reason (note how they would have known: F07) | 3 min, 3 clicks |

### Data owner (journey: [find, fix, approve, send](find-fix-approve-send.md))

| # | Task card | Success criteria | Target |
|---|---|---|---|
| O1 | "Is anything waiting for you?" | Names the waiting batch from the start screen or the inbox | 1 min, 0 to 1 clicks |
| O2 | "Check the changes in that batch and decide." | Opens the batch, reads changes and trail; approves, or sends back with a reason; note if they spot changes with no value (F12) | 5 min, 2 clicks |
| O3 | "Get the approved values into SAP." | **Send to SAP** (or **Check with SAP** then **Send to SAP** with live write-back); says what happens next and who loads the file (F08) | 3 min, 1 to 3 clicks |
| O4 | "You are away next week. Make sure approvals do not wait for you." | **Out of office** with a deputy and dates | 2 min, 4 clicks |

### Programme lead (journeys: [migration wave](migration-wave.md), [monthly governance](monthly-governance.md))

| # | Task card | Success criteria | Target |
|---|---|---|---|
| L1 | "Is Wave 1 ready? If not, what holds it back?" | Opens the Waves view; names the gate conditions not met and the objects | 3 min, 2 clicks |
| L2 | "Make the wave's gate: every object at 85 or more and no critical rule over tolerance." | **Save the gate** with both conditions | 3 min, 4 clicks |
| L3 | "If the stewards fixed the two worst rules of accounts payable, would it pass?" | **Simulate fixing…** with the chosen rules; reads the result | 4 min, 5 clicks |
| L4 | "How did the scores move since last month?" | A run compare of the latest run with a run about a month earlier; names two movers | 4 min, 4 clicks |
| L5 | "Who is behind on their work? Get them going." | Finds overdue people on People; opens one person's work; note what they do to remind (F30) | 4 min, 3 clicks |
| L6 | "The steering committee should get a summary every month without you sending it." | Schedules the board pack, or a digest; note whether they reach Digests (F29) | 5 min, 6 clicks |

### Auditor (journey: [audit](audit.md))

| # | Task card | Success criteria | Target |
|---|---|---|---|
| U1 | "Show every change one person made last month." | Audit log filtered by person and dates, exported (note the missing person filter, F25) | 4 min, 5 clicks |
| U2 | "Prove that value changes were checked by a second person." | Opens a batch and reads drafted by, approved by, sent by | 3 min, 3 clicks |
| U3 | "Give me every record signed off without a change, with the reason, as a file." | Exceptions exported; checks the row count in the file against the screen (F26) | 4 min, 4 clicks |
| U4 | "Which SOX controls are breached today?" | Policy chip on Work or Policy packs; names the breached classes | 3 min, 3 clicks |

## 4. Observation sheet (one per task)

| Field | Note |
|---|---|
| Participant code, role, device and width | |
| Task | |
| Start and end time; time on task | |
| Outcome | Completed / completed with help (what help) / failed / skipped |
| Path taken | Screens in order, with the controls used |
| Clicks | Counted from the recording |
| Hesitations | Where, how long, what they said |
| Errors | Wrong control, wrong screen, wrong value, and whether they recovered |
| Words that confused | Labels they misread or asked about |
| Left Meridian | Did they reach for email, Excel, SAP or a colleague, and why |
| Finding seen | IDs from the friction audit, or "new" with a one-line description |
| Quote | One sentence in their words |

## 5. After each task (ask aloud, rate 1 to 7)

1. "How easy or hard was that?" (1 very hard, 7 very easy)
2. "How sure are you that it is done?" (1 not at all, 7 completely)
3. "What did you expect to happen that did not?"
4. For hand-off tasks: "Who does the next step, and how will they know?"

## 6. After all tasks (10 minutes)

1. "What was the hardest part of today?"
2. "Which of these would you do in Meridian, and which elsewhere? Why?"
3. "If you could change one thing before you use this every day, what would it be?"
4. "Is there anything your colleagues in other roles would find hard here?"

## 7. System Usability Scale

Read the statements; the participant answers 1 (strongly disagree) to 5 (strongly agree).

1. I think that I would like to use this system frequently.
2. I found the system unnecessarily complex.
3. I thought the system was easy to use.
4. I think that I would need the support of a technical person to be able to use this system.
5. I found the various functions in this system were well integrated.
6. I thought there was too much inconsistency in this system.
7. I would imagine that most people would learn to use this system very quickly.
8. I found the system very cumbersome to use.
9. I felt very confident using the system.
10. I needed to learn a lot of things before I could get going with this system.

Score: for odd items subtract 1 from the answer; for even items subtract the answer from 5; add the ten and multiply by
2.5 (0 to 100). Report the mean per role and overall; 68 is the usual average, and we aim for 75 or more per role.

## 8. Close (2 minutes)

> Thank you. Everything you found today helps. The recording stays inside your company and is deleted after the
> analysis; your answers are reported only under your code.

- [ ] Recording stopped and stored in the agreed place inside the customer's environment.
- [ ] Observation sheets complete; SUS scored.

## 9. Analysis

- Per task: success rate, median time and clicks against the target, the post-task ratings.
- Per finding: how many of the five participants met it; raise its rank in the friction audit when three or more did.
- New findings: add to [friction-audit.md](friction-audit.md) with the same columns, the route and the steps.
- Per role: SUS mean, the three worst tasks, and one quote each.
