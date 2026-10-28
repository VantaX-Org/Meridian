# Welcome to Meridian

Meridian checks your SAP data against rules. It lists every record that fails and says why. Where it can, it suggests the right value. It routes each fix through a second person's approval and out to SAP as a load file. It then tracks progress run by run until the data is clean.

This guide is written for the people who do that work: data stewards who clean records, data owners who approve them, leads who follow progress, and the analysts and administrators who keep Meridian running. Start with this chapter, then read [Key concepts](/docs?page=concepts) and [Fix work](/docs?page=fix).

## Your data stays with you

Meridian runs inside your organisation's own environment. SAP data, findings and reports are stored there and do not leave it. The only call Meridian makes to the outside on its own is licence validation, which carries no SAP data.

Every score, count and suggested value comes from a fixed rule, so the same data always gives the same result. The built-in language model receives summaries of findings for written commentary, never raw SAP records, and any text it writes is labelled as such.

## Signing in

Accounts are created by an administrator. There is no self sign-up.

1. Open the invitation email and follow its link. The **Join Meridian** page asks you to choose a password.
2. On the sign-in page, enter your **Work email** and **Password**, then select **Sign in**.
3. Meridian opens the page for your role, or the page you were trying to reach.

Data stewards and data owners land on **Fix work**. Everyone else lands on the Home page for their role, found under **More**, **Analysis**. If you forget your password, select **Forgot password?** and follow the link in the email.

## The screen

Every page has the same frame. There is no sidebar.

### The index bar

The top row is the index bar. From left to right:

- The Meridian mark, which opens your Home page.
- Four pills, the places you work from every day: **Fix work**, **Objects**, **Progress** and **Inbox**. **Fix work** carries the number of records to fix (no number appears until a run's work list is built), and **Inbox** the number of open stewardship tasks. You see only the pills your role allows.
- **More**, which opens every other page you may use, grouped as **Analysis**, **Master data**, **Rules**, **Data in** and **Admin**. Press Escape or select outside the panel to close it.
- On the right: **Search or jump to...** (Ctrl K, or ⌘K on a Mac), the jobs tray, the **To do** flag with the number of critical and high items waiting for you (see [To do](/docs?page=todo)), the notification bell, the help menu (**?**) and your user menu.

### The scope bar

Under the index bar is the scope bar. It names the page you are on and, on the right, holds two controls you will use all day:

- **Find a record by key or name**: type a record key or a name, pick one of the failing records it matches, and the record opens in its object. Press `/` from anywhere to jump into it.
- **Run**: the run every screen shows. **Latest run** follows the newest finished run. Pick an older run and Meridian keeps it as you move between screens, in this browser, until you pick **Latest run** again.

When your access is limited to one system or object, a pill such as "Scoped: PRD ECC, Material master" sits beside them.

### The help menu

The **?** button offers **Tour this page** (where a guided tour exists), **Keyboard shortcuts**, **What's new**, **Documentation**, which opens this guide, and **Report a problem**. On the guide's page, **Download PDF** gives you a printable copy of every chapter.

## Your first day

- **Data steward**: open **Fix work**, switch on **Mine** or pick an object, and work the list from the top. See [Fix work](/docs?page=fix).
- **Data owner or approver**: you land on **Inbox**, **Approvals**: approve the fix batches your stewards prepared and the SAP write-backs others requested. See [Approvals and export](/docs?page=approvals).
- **Lead**: open **Progress** to see how fast the backlog is falling and what slows it. See [Progress](/docs?page=progress).
- **Analyst or SAP Basis**: open **More**, **Data in**, **Systems** to connect a system and run the first extraction, or **Import file** to load an export. See [Data in](/docs?page=data-in).

## Good to know

- Because the run is in the page address, a link you copy shows a colleague the same numbers.
- Your preferences, such as theme and row density, are under the user menu and follow you to any browser.

## Related

- [Key concepts](/docs?page=concepts)
- [Roles and access](/docs?page=roles)
- [Fix work](/docs?page=fix)
- [Keyboard shortcuts and search](/docs?page=shortcuts)
