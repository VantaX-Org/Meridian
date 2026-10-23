# Keyboard shortcuts and search

Meridian can be driven from the keyboard, and one search box takes you to any page, object, record or rule. This chapter lists every key, explains how search reads what you type, and shows how to work with tables.

## How to see the shortcuts

Press **?** on any page, or open the help menu (**?** in the index bar) and choose **Keyboard shortcuts**. A panel titled **Keyboard shortcuts** opens with the line "Press ? any time to open this list".

- The **?** key does nothing while you are typing in a box, a list or a text area, so you can still type a question mark.
- On the Inbox, the Inbox keys are listed first.

## The shortcut sheet

The sheet groups the keys as Navigation, Tables, Inbox and Global. On Windows and Linux, read ⌘ as Ctrl.

### Navigation

- ⌘1: Go to Home.

### Tables

These keys work when a table has the focus. Select a row or press Tab until the table is outlined.

- ↑ / ↓: Move between rows.
- Home / End: Jump to the first or last row.
- Enter: Open the focused row.
- Space: Select the focused row, where the table lets you select rows. The x key does the same.
- Escape: Clear the selection and close the row's detail panel.

### Inbox

These keys work on the Inbox list. They do nothing while you type in a box, or with Ctrl, ⌘ or Alt held.

- j / k: Next or previous task.
- Enter: Open the record behind the task.
- a: Assign the task to me.
- r: Resolve (approve) the task.
- x: Reject the task with a reason. A box asks for the reason.
- Escape: Close the panel.

The a, r and x keys need a role that can approve. On the **Exceptions** view, a assigns the exception to you and r opens the box to resolve it with a reason.

### Global

- ⌘K (Ctrl K): Search or jump to a page.
- [: Collapse or expand the navigation.
- ?: Show keyboard shortcuts.

In this version ⌘1 and [ appear in the sheet but have no effect. There is no sidebar to collapse, and Home is one click on the Meridian mark or the **Home** pill. Many browsers also keep ⌘1 or Ctrl 1 for their own first tab.

## Keys on particular pages

A few pages have keys of their own that the sheet does not list.

- On an object's page, 1, 2, 3 and 4 open the **Overview**, **Rules**, **Fields** and **Records** tabs.
- On an object's page, f opens the fix sheet for the record row the keyboard is on, or for the first record in the list when no row is focused.
- On **Runs**, with exactly two runs selected, c opens the comparison of the two.
- In the process designer, Ctrl S (⌘S) saves the model.
- Escape closes the **More** menu, a guided tour, a dialog or a side panel, and leaves presentation mode.

## Search and jump

The search box **Search or jump to…** sits on the right of the index bar. Select it or press Ctrl K (⌘K) from any page. The box reads "Type a page, object, check ID or record key".

### How to jump to a page

1. Press Ctrl K.
2. Type part of a page name, such as `scoring` or `golden`.
3. Use ↑ and ↓ to choose, and press Enter.

The list holds every page your role can open, grouped by the sections of the **More** menu. The tabs of the Insights views are listed with their view's name, such as "Summary: Reports", "Progress: Trends" or "Explore: Value at risk". The bar at the foot of the box reminds you: ↑↓ navigate, ↵ open, esc close. When nothing matches, the box says "Nothing matches." with a hint.

### How search reads what you type

Search reads your words with fixed rules, in the browser, without any AI. Words it recognises appear as chips under the box, and the first choice in the list becomes **Open filtered view**. When it recognises nothing, the first choice is **Search for** your text, which opens the search page.

It recognises:

- An object, by its name or its ID, such as `material master` or `material_master`. The longest name wins, so "material master" is not read as "material".
- A severity: `critical`, `high`, `medium` or `low`.
- A dimension: `completeness`, `accuracy`, `consistency`, `timeliness`, `uniqueness` or `validity`.
- An owner, written as `owner` followed by the name.
- A record key: a number of 6 to 18 digits, or 10 letters and digits with at least one digit, such as a material or vendor number.

Small words such as "show me all", "the", "in", "for", "findings" and "records" are ignored.

Where it takes you:

- An object and a record key open that record's page, for example `material master 10001234`.
- A record key alone opens the search page for that key.
- An object with a dimension opens the object's page with its failing rules narrowed to that dimension, for example `completeness material master`. A severity is kept in the address and applies on the object's **Rules** tab.
- A dimension or an owner without an object opens the **Objects** list with that filter applied.
- Anything else opens the search page with your text.

To find a rule, type its ID, such as `MM003`, and press Enter on **Search for "MM003"**. The search page lists the rule; select it to open it.

## The search page

The search page at [/search](/search) lists matches across Meridian. Its header reads "Objects, rules, glossary terms, batches and runs".

1. Type in the **Search** box, for example a name, a rule ID, a batch ID or a run ID, and press Enter.
2. Read the results. Each row shows its **Type** (**Object**, **Rule**, **Batch**, **Run** or **Glossary term**) and the **Result**. Systems are listed too.
3. Select a row, or **Open** at its end, to go there.

Exact matches on the ID or name come first, then names that start with your text, then names that contain it.

- The chips under the box, such as "Text: …", show what you searched for. Select a chip to remove it.
- Opened with a run in the address, the page lists that run's objects, and a "Run: …" chip shows it.
- **Export** downloads **Findings (.xlsx)** when your role can export.
- With no text, the page says "Search objects, records, checks and rules." With no results, it says "Nothing matches." and names what search covers.

## Tables

Most lists in Meridian use the same table. Above it, on the left, is the filter box; on the right the table options.

### How to sort and filter

1. Select a column header to sort by it. An arrow shows the direction.
2. Select the header again to reverse the order, and once more to clear the sort.
3. Type in **Type to filter rows** to keep only rows that contain your text in any column.

When the filter removes every row, the table says "No rows match this filter" and offers **Clear filter**. A table with no data at all shows one row with a short message, such as "No rows".

Small tables inside a page show the filter box only once they hold eight rows or more.

### Table options

- **Columns** shows or hides each column.
- **Views** saves the current columns, row height and sort under a name. Type a name in **View name** and select **Save view**. Select a saved view to apply it, or **Remove** to delete it. Saved views belong to you and follow you to any browser. **Reset saved views** in [Preferences](/me/preferences) removes them all.
- **Compact rows** and **Comfortable rows** switch the row height for this table. Tables open with compact rows. Your **Row density** preference sets how tall each of these is.
- **Export table** downloads the rows. **CSV** holds the rows that pass your filter, with the visible columns. Some tables add a server export, such as an Excel file. The button shows only for roles that can export.

### Selecting rows

Where a table offers bulk actions, each row has a box and the header has **Select all rows**. A bar at the bottom then shows "3 selected" and the actions for the selected rows. Roles that can change nothing, such as Viewer and Auditor, see no boxes.

Some tables open a side panel when you select a row, and some rows have a chevron that expands detail under the row.

### Exports elsewhere on a page

Pages also carry an **Export** button in their header. With one format it downloads straight away; with several it opens a menu. While the file is prepared the button reads **Preparing**, and a message says "Download started". If there is nothing to export, the message says "Nothing to export". On report pages the menu also offers **Print**, and a viewer, who cannot export, sees **Print** alone.

## Good to know

- Tables with more than 200 rows draw only the rows on screen, so long lists stay fast. Printing a page prints every row.
- Search lists only the pages your role can open.
- Your table views, sort and density are saved per table. Two tables with the same columns share their views.

## Related

- [Welcome to Meridian](/docs?page=welcome)
- [Inbox](/docs?page=inbox)
- [Objects](/docs?page=objects)
- [Runs](/docs?page=runs)
- [Glossary](/docs?page=glossary)
