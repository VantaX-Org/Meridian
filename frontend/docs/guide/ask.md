# Ask Meridian

Ask Meridian answers questions about the current run in plain words. It is grounded: the answer may use only the facts Meridian measured, and every number in it must match one of those facts. The same answers are in two places. **Aletheia** is docked on the right of every main screen: the landscape, an object, a rule, Work, Runs, a run and a comparison, People, Requests, the rules library, Reports, a system and Administration. Its header reads "Grounded answers from this run. Every number is checked against a fact, with the rules cited." On a narrow screen the panel moves under the page. **Ask Meridian** in the top bar opens the same answers in a panel of its own, and you can also type a question in the command line and choose Ask Meridian.

## What is on it

- **Your question**, typed in the box ("Ask about this run") and sent with **Ask**, and four suggested ones: "What is holding the score down?", "Which objects are under 85?", "What is the money at risk?" and "What did Aletheia find?".
- **The answer**, marked either "Grounded, every number matches a fact" or "Not answered" when the draft quoted a figure that is not a fact.
- **Facts used**, with "Coverage" saying how much of the question the facts cover, and **Rules cited**, so you can open the rule or object behind each sentence. The intent Meridian read from your question is shown, and "Reworded by model" when a language model phrased the sentence.
- **Was this answer helpful?** Under each answer, press **Helpful** or **Not helpful**. One vote per answer is recorded with the run it came from, so the team can see which answers worked; after the vote the buttons give way to a thank you.
- The Aletheia mark, which identifies the grounded intelligence that checks the answer.

## Aletheia found

At the top of the landscape and of every object, the **Aletheia found** band lists what Aletheia found without being asked. It ranks the failing rules of the latest run by their impact on the score. Each finding shows the rule number with its text, the object and the SAP field it fails on, and why it matters: how many failing records it gained or lost since the previous run, and, where Meridian traced where the bad values come from, what share of them come from one origin. Beside it are the failing records with a sparkline over the last runs, the money at risk when a cost model covers the rule, and a confidence. The confidence is the share of reviewed issues stewards confirmed as real, or the share of failing values from the dominant origin; when neither has been measured it shows a dash.

Each finding carries one action. **Draft cleansing batch** drafts a cleansing batch over the rule's open issues; it still needs approval before anything is written back. **Draft tuned version** drafts a tuned version of a rule that produces too many false alarms, for review in the rules library. **Open rule** opens the rule when there is nothing to act on directly.

Under the findings, **What changed since the last run** shows each object's score change against its previous run and the rules that moved it. **Proof of value** follows every finding someone acted on: it waits for the next run, then shows the score gain, how many fewer records fail, and the proven cost before and after for the cost metrics that rule feeds.

Ask "What did Aletheia find?" in the dock to hear the same findings as grounded sentences. The answer uses only rule numbers, field names and counts, never record values.

## The numbers and where they come from

Meridian collects the run's facts first: scores, failing counts, money at risk and the rules behind them. A language model only rewords those facts. Before the answer is shown, every figure in it is compared with the facts; if one does not match, the answer is withheld rather than shown with a wrong number.

## What you can do, by role

Every role can ask. The answer only covers objects and systems your role can already see.

## Keyboard

- `⌘K` opens the command bar; type a question there or use Ask Meridian in the top bar.
- `Enter` sends the question; `Escape` closes the panel.

## When something is wrong

- **"Not answered"**: the question needs facts the run does not hold. Ask about scores, rules, objects or money at risk.
- **"The numbers in the draft answer did not match this run's facts, so it was withheld."** The model's draft did not match the facts. Rephrase, or open the screen the facts point to.
- **The answer reads as from an older run**: answers use the latest finished run. Check Runs for one still in progress.
