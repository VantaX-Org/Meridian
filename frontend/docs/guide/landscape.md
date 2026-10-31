# Landscape

The landscape is the start screen for every role. It answers three questions in order: how ready is the data across every system and object, what holds it back, and what is the one thing you should do next. It opens at `/`, from **Landscape** at the top of the map, or with `g` then `l`.

## What is on it

- **The Demo data bar**, only in the demo build: "Every figure on this page is sample data built into the interface, not read from your SAP systems." A customer installation never shows it.
- **The title and scope**: "Landscape" and the systems in scope, such as "All systems". Change the scope and the run from the top bar.
- **The go-live banner**, at the top: one headline that gives the verdict of the next go-live. The small line above it names the next migration wave ("Next go-live: Wave 1: finance foundations"), or reads "All objects in scope" when no wave is planned. The headline is the worst verdict among the objects in that wave: **Go**, **At risk** or **No-go**. The line under it says why, for example "3 objects block go-live: Material master, Customer master, Vendor master", "Nothing blocks go-live, but some objects are below target." or "Every object in scope meets its target." Three figures follow: **Days to go-live** with the wave's date ("no date set" without one), **Cost of waiting** per month from the cost model ("no cost model" without one) and **Objects ready**, such as 4/15, with the critical issues still open. The banner has one button, chosen by the state: **Fix 3 blockers** opens Work on the no-go objects, **Clear 12 critical issues** opens Work on the critical rows, and **Sign off the wave** opens the waves when nothing is left.
- **The sentence**: one line that says what holds the landscape back, for example "11 of 15 objects are held under 85 by 30 critical rules over tolerance; fixing MM003 and MM035 would release 1 of them."
- **The provenance line**: records checked, rules measured and the run, for example "400,662 records checked, 794 rules measured, run 16 Oct 2026, 05:17".
- **The landscape map**: a heat map with one row per system (its name, type and client) and one tile per object, the lowest score first. The colour, the mark and the word on each tile all give the verdict, so it reads without colour too. Each tile shows the object, its score and either the records to fix, the critical rules failing ("2 critical rules failing") or "clean". The legend at the top counts the tiles of each verdict. Select a tile to open the object.
- **Three cards under the map**: **Readiness over time**, the average object score over the last runs ("Two runs are needed to draw a trend." until there are two); **Top blockers**, the five critical rules failing the most records, each with its message beside the rule id and the SAP field, and a link to Work filtered to that rule ("No critical rule is failing." when none is); and **Cleaned and watched**, the records fixed this week with a small weekly chart of records fixed against records that failed again, and **Open monitoring**.
- **Next steps**: the items waiting for you, each with its kind, due date, sentence and one link. The list is left out when nothing waits.
- **Aletheia**, docked on the right: "Grounded answers from this run. Every number is checked against a fact, with the rules cited." Ask a question in plain words; see the Ask Meridian chapter. On a narrow screen the panel moves under the page.
- **The next-step button**: one per role (see below), under the panel, with the wave and its due date under it for the programme lead.
- **The coverage matrix**, under the panel: objects as rows, systems as columns. Each cell is a small ruler with the shown score, the word **capped** and the measured score beside it where a cap applies ("70.0 capped, 71.8 measured"), the verdict (Go, At risk, No-go), records checked and rules measured. A cell flagged **low coverage** has fewer than 70% of its rules producing a result. A system never extracted shows "Not extracted yet. Extract"; one extracted but not scored shows "Extracted, not analysed. Run analysis".
- **The order**: objects are ranked by the measured score, so capped objects still sort by how good they are.
- **Coverage, All objects and Waves**: the view switch. **Waves** groups the objects under each migration wave with its due date, its go, at-risk and no-go counts and the gate state (see the Waves and gates chapter).
- **Your next work**: the top five rows of the Work ledger for you, ranked by value at risk, with **View all**. SAP Basis sees **Your next work** as system tasks instead: extract again, run analysis, extract a system never read.
- **The Basis home** (SAP Basis only), above the matrix: **Connections**, **Last extraction**, **Failed jobs to triage**, **Authorisation errors** and **Schedules**. See the SAP Basis walkthrough.
- **Objects from uploaded files**: when no system is connected but files have been uploaded, the landscape lists those objects with their records to fix, says they came from uploaded files, and offers Work, Runs and connecting a system.
- **Ask Meridian**, in the top bar on every page, opens the same grounded answers in a panel of its own.

## The numbers and where they come from

- **The banner's verdict** is the worst verdict among the objects of the next wave: one no-go object makes it No-go. Without a planned wave it covers every object on the landscape.
- **Days to go-live** counts the days to the wave's target date. **Cost of waiting** is the monthly opportunity cost from the cost model, an estimate. **Objects ready** counts the objects of the wave whose verdict is go; the critical issues are the open critical rows in Work.
- **The tiles** are ordered by score, lowest first; a tile's records to fix are the open rows of that object.
- **Readiness over time** plots the average object score of each run. **Top blockers** counts the failing records of each critical rule.

- **The score in each cell** is the object's shown score in the run in the top bar: the weighted dimension scores, capped at 85 by one critical rule over tolerance and at 70 by two or more. Open the **i** beside the object name for the receipt.
- **The verdict** comes from the score bands under Administration, Settings: at or above target is go, at or above warning is at risk, below that is no-go. A critical rule over tolerance keeps an object out of go.
- **The sentence's counts**: "held under 85" counts the objects whose shown score is capped; "critical rules over tolerance" counts the rules behind those caps; "would release" names the rules whose fix lifts the most objects off their cap.
- **Value at risk** in Your next work is the cost model named under the table: "Rows ranked by value at risk, cost model ZAR." Every amount is an estimate and says so: **est.**, or **default estimate** while the tenant has not saved its own cost model, with a link to Administration, Settings.
- **The footer** repeats the run, the records checked, the rules measured, the scoring time, the cost model and the licence validity, and shows a failed job in red when one needs attention.

## What you can do, by role

- **Programme lead**: follow the next step ("Clear the 3 no-go objects in Wave 1: finance foundations"), switch to **Waves**, open any cell, share the page from **Share and export**, export the grid to Excel.
- **Data steward**: "Accept N suggested values for" the top rule opens Work on that rule's rows; Your next work lists your highest-value records.
- **Data owner**: the line under the sentence says how many batches wait for you and your SLA, for example "2 batches wait for your approval, SLA met on 92% of your open work"; the button is "Approve batch B-241".
- **SAP Basis**: the Basis home above the matrix; the button extracts or analyses the system that needs it first; the task list shows every system's state.
- **Process analyst**: "Open PTP step 3" opens the first blocked process step.
- **Auditor and viewer**: read everything; actions are not offered.

Selecting a tile in the map or a cell in the matrix opens the object canvas. Selecting a system heading opens the system in the inspector.

## Keyboard

- `g` then `l` returns here from anywhere.
- `⌘K` opens the command line ("Search, ask, or type a command"); type an object name and system, such as "material master ECC".
- In the matrix and in Your next work, `j` and `k` move, `Enter` opens.

## When something is wrong

- **The banner reads "no date set"**: the next wave has no target date. Set it on the wave (see the Waves and gates chapter).
- **Cost of waiting shows a dash**: there is no cost model. Set one under Administration, Settings.
- **Many objects read 70.0 capped**: they have two or more critical rules over tolerance, so the cap holds them at 70. The measured score beside it differs, and the objects are ranked by it.
- **A system row says "Not extracted yet"**: ask SAP Basis to extract it, or extract it yourself if you hold trigger sync.
- **A cell shows a dash**: no run has scored that object on that system. "Not analysed" and "Not extracted" say which step is missing.
- **Low coverage**: some rules could not run because a table, field or value list was missing. Treat the score as indicative and ask SAP Basis to check the extraction scope.
- **The footer shows a failed job**: open it from the footer link; the job inspector says why it stopped and offers a retry.
