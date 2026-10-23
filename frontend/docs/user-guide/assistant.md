# Ask Meridian

Ask Meridian answers short questions about your data quality in plain words, with a link to the page behind each answer. Every role can use it: leads checking the score before a meeting, stewards looking for their next piece of work, analysts who want the worst rule without building a view.

## What you see

The **Ask Meridian** button sits at the bottom right of every page. Click it to open the panel above it.

- The header reads **Ask Meridian** with the line "Answers come from your run's figures", and a close button on the right.
- An empty panel shows **Try one of these** and four questions you can click to ask straight away.
- Once you ask, the panel lists the conversation: your question on the right, the answer under it in one to three sentences, a small bar or line chart where it helps, and links such as **Open trends**.
- At the bottom is the question box, "Ask about your data quality", with a send button. While Meridian works out an answer the panel shows **Reading the figures**.

## How to ask a question

1. Click **Ask Meridian** at the bottom right of the page.
2. Type your question in the box, or click one of the suggested questions.
3. Press Enter, or click the send button.
4. To see the rows behind an answer, click one of its links. The panel closes and the page opens, on the same run where the page shows one run.
5. Press Escape, or click the close button, to put the panel away. Focus returns to the **Ask Meridian** button.

Questions can be up to 500 characters long.

## What it answers

Ask Meridian recognises the questions below in your own wording: it looks for words such as "score", "weakest", "rules", "critical", "blocking", "root cause", "fixes", "owners" or "changed", and for an object's name.

- **The score and how it moved.** "How has the score moved?" gives the data quality score, the change since the previous run and what led it, with a line of the recent runs. Name an object ("How is material master doing?") to get that object's score.
- **The weakest objects.** "Which objects are weakest?" names the lowest scoring objects and how many meet the target.
- **The top failing rules.** "What are the top failing rules in material master?" ranks rules by failing records weighted by severity. Add a severity ("the worst high rules") or an object to narrow the list. "What should I fix first?" gives the same ranking.
- **Critical findings.** "How many critical findings are there?" counts the critical checks that fail, the records they touch and the object that carries the most.
- **Blockers and readiness.** "What is blocking the waves?" says how many blocking rules fail and gives each migration wave's verdict: go, at risk or no-go.
- **Root causes.** "What are the root causes?" names the field that explains the largest share of the failures.
- **Fixes.** "How many fixes are approved?" gives the failing records with a proposed fix, how many are approved and how many are applied.
- **Owners.** "Who has the most open work?" names the owner with the most open items and how many are critical.
- **What changed.** "What changed since the last run?" gives the score change, how many rules now pass, how many started failing and the rule that grew the most.

Ask "What can you answer?" to see this list in the panel.

## How answers are computed

Every built-in answer is computed from the figures the Insights pages show, for the run in the page address (`?run=`), or the newest finished run when there is none. No model is involved, so the same question on the same run always gets the same answer.

The AI is only the fallback. When a question matches none of the built-in answers, and your administrator has set up a language model, Meridian passes the model your question and a summary of the run: the overview sentences, each object's score and the top ten failing rules by rule ID, object, severity and number of failing records. The model never sees a record key, a field value or any other row of your SAP data. Each call is listed on the **AI audit** tab of the audit log.

An answer the model wrote carries the line "AI-generated from aggregated findings; no built-in answer fitted". Check its figures on the page it links to.

When no model is set up, or the model does not answer in time, Meridian says it has no built-in answer and lists the four example questions instead.

## Links

Each answer links to the page that holds the full picture. The score opens Trends (`/insights/trends`), the weakest objects open that object and the Objects list, the top rules open the rule ranking (`/insights/rules`) with the same filters, readiness opens `/insights/readiness`, fixes open [Fix](/fix), owners open `/insights/owners`, and what changed opens the comparison of the two runs. Only links inside Meridian are shown.

## Good to know

- Ask Meridian only reads. It never changes a rule, a record or an assignment.
- It answers about one run at a time, the one in the page address or the newest finished run. To ask about an older run, open that run first.
- With no finished run, it says so and points you to [Import](/import) and [Runs](/runs).
- Owner questions cover items assigned to people across all runs, not one run.
- Each question stands alone: earlier questions do not change the next answer.
- Your licence decides whether the button is shown. If you cannot see it, ask your administrator.
- The button is left out when you print a page.

## Related

- [Insights](/docs?page=insights)
- [Objects](/docs?page=objects)
- [Fix](/docs?page=fix)
- [Migration](/docs?page=migration)
- [Roles and access](/docs?page=roles)
