# Keyboard and the command line

Meridian can be driven from the keyboard: a whole ledger can be worked without the mouse, and every canvas and action is reachable by typing. `?` shows the full sheet at any time; the keys are the same on every screen.

## The command line

Open it with `⌘K` (Ctrl+K on Windows and Linux) or `/`. "Search or type a command." Type:

- a **record key** such as a material number to open the record;
- a **rule id** such as `MM014` to open the rule;
- an **object and system**, such as "material master ECC", to open the object;
- a **run** date to open the run;
- a word: **approve** opens the batches waiting for approval; **export** saves the fix sheet of what is on screen.

With nothing typed it offers **Go to**: Landscape, Work, Runs, People, Rules and Connect a system. `↑` and `↓` move through the results, `Enter` opens one, `Esc` closes.

## Everywhere

- `⌘K` or `/`: open the command line.
- `?`: show the shortcut sheet.
- `⌘Z`: undo the last change (when focus is not in a text field).
- `Esc`: close the top layer: menu, then inspector, then the selection.

## Go to

- `g` then `l`: Landscape.
- `g` then `w`: Work.
- `g` then `r`: Runs.
- `g` then `p`: People.

## Tables and lists

- `j` or `↓`: next row. `k` or `↑`: previous row.
- `Shift+J` or `Shift+↓`, `Shift+K` or `Shift+↑`: extend the selection.
- `Enter`: open the row in the inspector.
- `x`: select or clear the row.

## Work ledger

- `a`: accept the suggested value on the selected rows.
- `n`: mark the selected rows as not an issue.
- `r`: accept the risk on the selected rows.
- `e`: export the fix sheet of what is on screen.
- `f`: move to the filter chips.
- `⌘D`: fill the New value of the first selected row down the selection.
- Paste several lines into a New value cell to fill the selected rows.

## Inspector

- `]`: open the next row. `[`: open the previous row.
- `Tab` cycles inside the inspector.
- `Esc` closes it and returns you to where you were.

## Where the numbers come from

Nothing typed in the command line is guessed: results come from the tenant's own records, rules, objects and runs, grouped by kind.

## What you can do, by role

Every role can use every key. A key that acts (`a`, `n`, `r`) does nothing visible when your role does not hold the action; the ledger says "Read-only for your role".

## When something is wrong

- **A key does nothing**: focus is in a text field. Press `Esc` or click the page, then try again. `⌘K` and `Esc` work everywhere.
- **"Select rows first: x selects the highlighted row, Shift+J extends the selection."** A ledger key was pressed with no row selected.
- **The command line finds nothing**: try a shorter word, or the record key as SAP stores it, with its leading zeros.
- **Keyboard hints are missing beside places**: turn them on under Preferences, Keyboard.
