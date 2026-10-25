# Keyboard shortcuts and search

Cleaning data is repetitive, so Meridian can be driven from the keyboard: you can work a whole list of records without touching the mouse. This chapter lists every key and explains the two search boxes. Keys never fire while you are typing in a box, a list or a text area, or while a dialog is open, and they ignore Ctrl, ⌘ and Alt unless stated. On Windows and Linux, read ⌘ as Ctrl.

Press `?` on any page, or choose **Keyboard shortcuts** in the help menu, to see the list for the page you are on.

## Everywhere

- `/`: jump into **Find a record by key or name** in the scope bar.
- Ctrl K (⌘K): open **Search or jump to...**, for any page, object, rule or record key.
- `?`: show the keyboard shortcuts.
- Ctrl 1 (⌘1): go to your Home page.
- `Escape`: close the **More** menu, a dialog, a side panel or a guided tour.

## Fix work

On the **Records to fix** tab:

- `j` or the Down arrow: next record.
- `k` or the Up arrow: previous record.
- `a`: accept the record's suggested values. They go into your draft fix batch, and the next record comes up.
- `t`: take the record, so it is assigned to you.
- `u`: undo the record's proposed values.
- `Enter`: open the full record.

`a` and `u` need the apply permission and `t` the assign permission. The keys are printed under the list as a reminder.

## Objects

On an object's page:

- `1` to `5`: open **Records to fix**, **Overview**, **Rules**, **Fields** and **Records by rule**.
- On **Records to fix**, `j` and `k` (or the arrow keys) move between records and `Enter` opens the full record.
- `f`: open the full record of the row the keyboard is on in a rule's record list, or of the first record.

## Inbox

- `j` and `k`: next or previous item.
- `Enter`: open the record behind the item.
- `a`: claim the item.
- `r`: approve the task, or open the resolve box on an exception.
- `x`: reject the task with a reason.
- `Escape`: close the panel.

## Tables

When a table has the focus (select a row, or press Tab until it is outlined):

- Up and Down arrows: move between rows. Home and End: first or last row.
- `Enter`: open the focused row. Space: select it, where the table allows.
- `Escape`: clear the selection.

On **Runs**, with two runs ticked, `c` opens their comparison.

## Finding a record

**Find a record by key or name** sits in the scope bar on every page. It searches the failing records of the run you are viewing.

1. Press `/`, or select the box.
2. Type at least two characters of a record key or a name, such as a material number or a vendor name.
3. Move through the matches with the arrow keys. Each shows its name or key, its object and its status.
4. Press `Enter` to open the record in its object, on **Records to fix**, with the record picked. `Escape` closes the list.

Only records that fail a check in the run are listed. To find a record that passes, open the object and use its search, or the search page below.

## Search or jump

**Search or jump to...** (Ctrl K) lists every page your role can open, grouped by the sections of the **More** menu. Type part of a name, such as `scoring` or `golden`, choose with the arrow keys and press `Enter`. It also reads what you type with fixed rules, without any AI:

- an object, such as `material master`;
- a severity or a dimension, such as `critical` or `completeness`;
- a rule ID, such as `MM003`;
- a record key, such as a 10-digit material number.

An object and a record key open that record; a rule ID opens the rule; an object with a severity or dimension opens its **Rules** tab narrowed to them. Anything else opens the search page.

## The search page

The search page at [/search](/search) lists objects, rules, glossary terms, batches and runs that match your text, exact matches first. Select a row to open it. With the export permission, **Export** downloads the findings.

## Related

- [Fix work](/docs?page=fix)
- [Objects](/docs?page=objects)
- [Inbox](/docs?page=inbox)
- [Glossary](/docs?page=glossary)
