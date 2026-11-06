# Objects

Objects is the board of every object on every system. Open it from **Objects** on the rail, or press g then o. Its address is `/objects`. Use it to find the object you want, then open it for its score, its rules and its runs (see the An object and its tabs chapter).

## What is on it

- **The sentence and the button**: one sentence says which object has the lowest measured score on the board, and the one button opens that object.
- **One table per system**, with the object that scores lowest first. Each row shows the **Object**, the **Score** out of 100, the **Trend** over the object's finished runs, the **Open findings** (records that fail at least one rule), **At risk** (the priced cost of those findings from the cost model, or a dash when nothing could be priced) and the **Run** the figures come from.
- **Held-down scores**: when failing critical rules cap an object, the row says so, for example "held down from 71.8". The score shown is the capped one; the measured score is the figure before the cap.
- **A system with no finished run** shows a plain sentence and a link to open the system, so you know to extract and analyse it first.

## Which run you are reading

Each object is shown at its own newest finished run. To read every object at one run, pin that run: the board then says "Pinned to one run" and offers **Show each object at its newest run** to go back. Inside an object, the run picker sets the run, and the run stays in the address, so a link shows the same run.

## Finding other things

- **Runs** on the rail lists every measurement on a timeline (see the Runs chapter).
- The **Objects** menu on the rail lists the systems and their objects as a tree, with a link to connect a system.
- The command line (Command K or slash) opens any object by typing its name.

## What you can do, by role

Everyone who can read a system sees its objects. Acting on an object, such as fixing records, depends on the role, as the Work chapter says.

## The numbers and where they come from

The score is the measured score out of 100, or the capped score when failing critical rules hold it down. Open findings come from the run shown. At risk is priced from the cost model, and reads as an estimate while the shipped costs are in use.

## When something is wrong

- **An object is missing from its system's table**: no finished run scored it. The row says so, and the object page shows the earlier runs.
- **A system shows a sentence instead of a table**: it has no finished run. Open the system, extract it, then run an analysis.
- **A dash under At risk**: nothing could be priced for that object from the cost model.

## Keyboard

- `g` then `o` opens Objects.
- `Esc` closes the topmost layer.
