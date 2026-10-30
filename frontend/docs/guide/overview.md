# Meridian in three minutes

Meridian checks your SAP data against fixed rules, scores every object, lists every record that fails and routes each fix through a second person before it goes back to SAP. It puts all of that on three surfaces: the **map** of systems and objects on the left, the **canvas** in the middle and the **inspector** on the right. There is no menu of pages. Every screen is a place on the map, every piece of work is a row in the ledger, and anything you select opens in the same inspector.

## The three surfaces

- **The map** lists **Landscape**, **Work**, **Runs** and **People** at the top, then each connected system with its objects. Every object row carries its score and, where there is work, the number of records to fix. On a phone the map is a sheet you open from the top bar.
- **The canvas** shows the place you chose: the landscape, one object with its tabs, one rule, the Work ledger, a run or a comparison of two runs, a system, People, Reports or Administration.
- **The inspector** opens beside the canvas when you select a row: a record, a rule, a run, a job, a batch, a person, a system. It always has the same order: title, status line, facts, actions, history. `Esc` closes it and returns you to where you were.

The top bar holds the scope (which systems), the run you are reading, the command line (`⌘K` or `/`), the inbox count, help (`?`) and your account menu with Preferences and, for administrators, Administration.

## The numbers on every screen

Every score in Meridian is drawn on one **ruler**: six segments whose widths are the dimension weights (completeness 25, accuracy 25, consistency 20, timeliness 10, uniqueness 10, validity 10), each filled to its own score, with a tick at the **measured** score. The number beside the ruler is the score **shown**. When a critical rule is over tolerance the shown score is capped and the word **capped** appears beside it.

The cap rule is fixed: one critical rule over tolerance caps a score at 85, two or more at 70. A critical rule counts as over tolerance when it fails at least the share of records or the number of records set under Administration, Settings, Cap rule and tolerance. The receipt under every object score states it in one line, for example: "Measured 71.8, the tick on the ruler. Capped at 70 by MM003 and MM035, two critical rules over tolerance."

Verdicts come from the score bands: **Go**, **At risk** and **No-go**. Value at risk comes from the cost model named in the footer, such as "cost model ZAR". Nothing is estimated by a language model: every figure is a rule result over stored data, and each one has an **i** beside it that shows the arithmetic.

## Where each role starts

Everyone lands on the **Landscape**, shaped for their role by one **next-step button**:

- Programme lead: "Clear the 3 no-go objects in Wave 1: finance foundations".
- Data steward: "Accept the suggested values".
- Data owner: "Approve batch B-241".
- SAP Basis: "Extract SuccessFactors" (the system not yet extracted).
- Process analyst: "Open PTP step 3".
- Auditor and viewer: the same landscape, read-only.

Under **Preferences**, **Start screen**, you can open Meridian as another role's start screen. Your access does not change.

## Keyboard

- `⌘K` or `/` opens the command line. Type a material number, a rule id such as `MM142`, an object, a run, or a word such as approve or export.
- `g` then `l`, `w`, `r` or `p` goes to Landscape, Work, Runs or People.
- `?` shows every shortcut. `⌘Z` undoes the last change. `Esc` closes the top layer.

## When something is wrong

- **A grey dash** means the number is unknown, never zero. Hover it for the reason.
- **"Not extracted yet. Extract"** on a system means nothing has been read from it; **"Extracted, not analysed. Run analysis"** means no scores exist yet.
- **The red line at the bottom of the screen** names a failed job, such as "Extraction of Employee central failed: OData refused credentials (HTTP 401)". Open it for the stages and a retry; SAP Basis owns connection errors.
- **"... needs the ... permission. Ask an administrator to grant it."** means your role does not hold that action. Your administrator grants it under Administration, Users.
- For anything else, open help (`?`), copy the diagnostics block under **Contact support** and send it to your administrator. It holds no record values and no secrets.
