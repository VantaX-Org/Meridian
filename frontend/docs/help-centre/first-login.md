# Your first hour in Meridian

Meridian reads your SAP data, tests it against fixed rules and lists every record that fails. Nothing here is a guess: each score, count and suggested value comes from a rule that ran over stored data. The first hour is about three things only: getting to the right starting page, learning the frame every page sits inside, and telling Meridian who you are.

## Sign in and land where your work is

Accounts are created by an administrator. There is no self sign-up, so an invitation comes first. Open it, choose a password, then use your work email and that password to sign in.

Where you land depends on your role:

- Data stewards land on the fix list, with the worst records at the top.
- Data owners and approvers land on approvals, where fix batches wait for a second pair of eyes.
- Leads, analysts, SAP Basis and process analysts land on a home page for their role, which answers how healthy the data is and what to do next.

Your rights come from one main role plus any grants for a particular system or object. Pages and actions you have no part in are hidden rather than offered dead. If a colleague's home page looks different, use the view-as switch to read it: the layout changes, your permissions do not.

## The frame around every page

Every page sits in the same frame. Four parts, and the product reads quickly once you know them.

- The index bar holds the pages you use daily, a **More** menu for the rest, search, the jobs tray, notifications, help and your user menu.
- The scope bar names where you are and carries two controls you will touch all day: a box that finds a failing record by key or name, and the run picker.
- The run picker decides which measurement every screen reads. The latest run follows the newest finished one. Pick an older run and Meridian keeps it as you move around, in this browser, until you set it back. Because the run sits in the page address, a link you copy shows a colleague exactly the same numbers.
- When your access covers one system or object only, a scope pill says which, so a figure is never mistaken for the whole landscape.

One warning worth taking early: you see the records your scope covers. If a colleague has records you cannot see, ask an administrator to check your grants.

## Take the tour, then live in the ? menu

Open the help menu, marked **?**, on any page. Where a guided tour exists, it is offered there. Tours are short and shaped by role: one for stewards, one for leads, one for SAP Basis, one for processes. A tour jumps between pages for you and skips any step whose page has nothing to show yet. Take your role's tour now; every tour can be replayed later from [your preferences](/me/preferences).

The same menu holds the shortcuts sheet, what is new, the documentation library and a report-a-problem dialog. Report a problem copies the page address, the current run and the version for you; opening it sends nothing anywhere.

## Find things without hunting

Two boxes cover nearly everything.

- Press `?` to see which keys the page you are on answers to. Press `/` to jump into the record box, type two or more characters of a material number, a vendor name or a record key, then press Enter to open that record where it fails.
- Press Ctrl K, or `⌘K` on a Mac, to open search and jump. It lists every page your role can open. It also reads what you type with fixed rules rather than a model: an object name, a severity or dimension, a rule ID such as `MM003`, or a record key. Anything it cannot interpret opens the search page, which spans objects, rules, glossary terms, fix batches and runs.

Keys never fire while you are typing in a box, so both habits are safe to learn on the same morning.

## Set your name, time zone and density

Your preferences sit at [Me, Preferences](/me/preferences) and are kept on the server, so they follow you to any browser.

Set your time zone first. Runs, schedules, due times and digests read sensibly once it is right; the default is UTC, which makes a 07:00 extraction look like an afternoon job. Then set locale, theme and row density, which retune rows, cards and spacing everywhere: compact suits a long fix list, comfortable suits a screen you share in a meeting.

Digests are off until you choose a cadence, so nothing arrives in your email until you ask for it. Where email is not configured on this deployment, notifications stay inside the product.

## Next steps

- Connect a system, or check an existing one is healthy, at [Connect a system](/systems).
- Take a measurement with [Your first analysis run](/runs).
- Clean your first record in [Fix work](/fix).
