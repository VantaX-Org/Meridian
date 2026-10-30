# Landscape

The landscape is the start screen for every role. It answers three questions in order: how ready is the data across every system and object, what holds it back, and what is the one thing you should do next. It opens at `/`, from **Landscape** at the top of the map, or with `g` then `l`.

## What is on it

- **The title and scope**: "Landscape" and the systems in scope, such as "All systems". Change the scope and the run from the top bar.
- **The sentence**: one line that says what holds the landscape back, for example "11 of 15 objects are held under 85 by 30 critical rules over tolerance; fixing MM003 and MM035 would release 1 of them."
- **The provenance line**: records checked, rules measured and the run, for example "400,662 records checked, 794 rules measured, run 16 Oct 2026, 05:17".
- **The next-step button**: one per role (see below), with the wave and its due date under it for the programme lead.
- **The coverage matrix**: objects as rows, systems as columns. Each cell is a small ruler with the shown score, the word **capped** where a cap applies, the verdict (Go, At risk, No-go), records checked and rules measured. A cell flagged **low coverage** has fewer than 70% of its rules producing a result. A system never extracted shows "Not extracted yet. Extract"; one extracted but not scored shows "Extracted, not analysed. Run analysis".
- **Coverage, All objects and Waves**: the view switch. **Waves** groups the objects under each migration wave with its due date, its go, at-risk and no-go counts and the gate state (see the Waves and gates chapter).
- **Your next work**: the top five rows of the Work ledger for you, ranked by value at risk, with **View all**. SAP Basis sees **Your next work** as system tasks instead: extract again, run analysis, extract a system never read.

## The numbers and where they come from

- **The score in each cell** is the object's shown score in the run in the top bar: the weighted dimension scores, capped at 85 by one critical rule over tolerance and at 70 by two or more. Open the **i** beside the object name for the receipt.
- **The verdict** comes from the score bands under Administration, Settings: at or above target is go, at or above warning is at risk, below that is no-go. A critical rule over tolerance keeps an object out of go.
- **The sentence's counts**: "held under 85" counts the objects whose shown score is capped; "critical rules over tolerance" counts the rules behind those caps; "would release" names the rules whose fix lifts the most objects off their cap.
- **Value at risk** in Your next work is the cost model named under the table: "Rows ranked by value at risk, cost model ZAR."
- **The footer** repeats the run, the records checked, the rules measured, the scoring time, the cost model and the licence validity, and shows a failed job in red when one needs attention.

## What you can do, by role

- **Programme lead**: follow the next step ("Clear the 3 no-go objects in Wave 1: finance foundations"), switch to **Waves**, open any cell, share the page from **Share and export**, export the grid to Excel.
- **Data steward**: "Accept the suggested values" opens Work with your rows; Your next work lists your highest-value records.
- **Data owner**: the line under the sentence says how many batches wait for you and your SLA, for example "2 batches wait for your approval, SLA met on 92% of your open work"; the button is "Approve batch B-241".
- **SAP Basis**: the button extracts or analyses the system that needs it first; the task list below shows every system's state.
- **Process analyst**: "Open PTP step 3" opens the first blocked process step.
- **Auditor and viewer**: read everything; actions are not offered.

Selecting a cell opens the object canvas. Selecting a system heading opens the system in the inspector.

## Keyboard

- `g` then `l` returns here from anywhere.
- `⌘K` opens the command line; type an object name and system, such as "material master ECC".
- In the matrix and in Your next work, `j` and `k` move, `Enter` opens.

## When something is wrong

- **Every object reads 70.0**: most objects have two or more critical rules over tolerance, so the cap holds them at 70. The measured score differs; read it on the ruler tick or in the receipt.
- **A system row says "Not extracted yet"**: ask SAP Basis to extract it, or extract it yourself if you hold trigger sync.
- **A cell shows a dash**: no run has scored that object on that system. "Not analysed" and "Not extracted" say which step is missing.
- **Low coverage**: some rules could not run because a table, field or value list was missing. Treat the score as indicative and ask SAP Basis to check the extraction scope.
- **The footer shows a failed job**: open it from the footer link; the job inspector says why it stopped and offers a retry.
