# Welcome to Meridian

Meridian measures the quality of your SAP data and helps your team fix it. Data leads use it to judge whether data is ready for a go-live or a migration, stewards use it to work through failing records, and SAP Basis teams use it to connect systems and keep extractions running.

## What Meridian does

- It reads data from your SAP systems (ECC, S/4HANA, S/4HANA Cloud, SuccessFactors, Concur, Ariba, eWMS and BTP), or from an export file you import.
- It runs rules over every record. Each rule is a fixed, deterministic check, so the same data always gives the same result. No language model computes any score, count or ranking.
- It scores each object, such as Material master or Business partner, from 0 to 100 and gives it a verdict: Go, At risk or No-go.
- It lists the failing records, proposes fixes, routes the work to stewards and checks on the next run whether the records now pass.
- It manages master data: golden records, match rules, survivorship and a business glossary.
- It produces reports for leads, owners and auditors as PDF and Excel files.

## Your data stays with you

Meridian runs inside your organisation's own environment. SAP data, findings and reports are stored there and do not leave it. The only call Meridian makes to the outside on its own is licence validation, which checks your licence and carries no SAP data.

If your administrator connects a cloud AI provider under **AI settings**, that provider receives summaries of findings for the written summaries. It never receives raw SAP records. Any text written by the model is labelled as such in the page.

## Signing in

Accounts are created by an administrator. There is no self sign-up.

1. Open the invitation email and follow its link. The **Join Meridian** page asks you to choose a password.
2. On the sign-in page, enter your **Work email** and **Password**.
3. Select **Sign in**. Meridian opens the Home page for your role, or the page you were trying to reach before you signed in.

If you forget your password, select **Forgot password?**, enter your work email on the **Reset password** page and select **Send link**. Follow the link in the email, then sign in with the new password.

The sign-in page tells you what went wrong in plain words:

- "Email or password is wrong." Check both and try again.
- "Too many attempts. Wait a minute and try again."
- "Meridian could not be reached. Check that the server is running." Tell whoever runs your Meridian installation.

If the licence is invalid or has expired, Meridian shows **Licence needed** and stays locked until an administrator renews it.

## What you see

Every page has the same frame. There is no sidebar.

### The index bar

The row at the top is the index bar. From left to right:

- The Meridian mark. Select it to go to your Home page.
- Pills for **Home**, **Objects**, **Fix**, **Inbox**, **Runs**, **Insights** and **Systems**. You see only the pills your role allows. **Fix** shows the number of fix proposals waiting for review and **Inbox** the number of open stewardship tasks. **Systems** carries a small dot for the worst system health: red when a system cannot be reached or its sign-in failed, amber when one is degraded, green when all are healthy.
- **More**, which opens every other page you may use, grouped by section: Systems (such as **Import file** and **Migration**), Insights views, Process, MDM, Rules and Admin. Press Escape or select outside the panel to close it.

On a narrow screen the pills scroll sideways.

On the right of the index bar:

- The search box **Search or jump to…**. Press Ctrl K (⌘K on a Mac) from anywhere to open it. See [Keyboard shortcuts and search](/docs?page=shortcuts).
- The jobs tray. Its dot shows while an extraction, analysis or upload is running. Select it to see each job with its progress. A thin bar across the top of the page also fills while jobs run.
- Notifications (the bell). A count shows unread items. The panel lists the latest ten, with **Mark all read** and **Open all**. When there is nothing new it says "You are all caught up".
- The help menu (**?**).
- The user menu (your initials).

### The scope bar

Under the index bar is the scope bar. It shows the page title, the breadcrumbs and any scope the page publishes, such as the run you are viewing. When you hold access that is limited to one system or module, a pill such as "Scoped: PRD ECC, Material master" sits on the right. The bar collapses when the page draws its own title.

### The help menu

The **?** button offers:

- **Tour this page**, on pages that have a guided tour.
- **Keyboard shortcuts**, the full list of keys.
- **What's new**, the release notes. A dot on the button means there is something you have not seen.
- **Documentation**, which opens this guide. Use **Download PDF** on that page for a printable copy.
- **Report a problem**, which shows the page address, the run and the version so you can copy them into an email to your support contact. Nothing is sent from the page itself.

### The user menu and preferences

The user menu shows your name, email and role, a **Theme** choice (**Light**, **System** or **Dark**), **Preferences** and **Sign out**.

**Preferences** opens [your preferences](/me/preferences). They are saved to your account, so they follow you to any browser.

- **Display**: **Theme**, **Row density** (**Compact**, **Default** or **Comfortable**), **Language and region** and **Time zone**. A line under the card shows how dates will look.
- **Notifications**: **Digest of your open items** (**Off**, **Daily** or **Weekly**), **Tell me at once about critical findings** and **Also email me**. **Send me a test** writes a test message to your inbox, and emails you when email is set up. You can send three tests an hour.
- **Guidance and saved views**: **Replay tours** shows the guided tours again, and **Reset saved views** removes every table view you have saved.

## How runs scope every page

A run is one measurement of your data at a point in time. Every figure in Meridian belongs to a run. See [Key concepts](/docs?page=concepts).

- There is no global run setting. Each page picks the run that fits it.
- A page about one object shows the newest finished run that measured that object.
- Home and the cross-object Insights pages show the current state when no run is chosen: each system or set of uploaded objects at its newest finished run. The header says so, for example "Current state of 15 objects, latest run 16 Oct 2026".
- A run in the address as `?run=` pins the page to that run. The header then reads "As of" with the run's name and date, and offers **Back to latest**.
- Where an older run matters, the header offers a picker of the other runs from the same source.
- The pills in the index bar never carry a run, so each section opens on its own latest run.

Because the run is in the address, you can copy a link and a colleague sees the same numbers.

## Your first day

Follow these steps to go from an empty installation to your first report. Each step names the chapter with the detail.

1. Connect a system or import a file. Select **Systems**, then **Connect system**, and enter the connection details. If you have an export instead, open **More** and choose **Import file**, select **Choose file** (CSV, XLSX, JSON or Parquet), check the **Column mapping** and select **Run import**. Every import becomes a run. See [Systems](/docs?page=systems).
2. Run an analysis. On the system's page, select **Extract**, choose the objects, and select **Extract and analyse**. Watch progress in the jobs tray. An import is analysed for you. See [Runs](/docs?page=runs).
3. Read Home. The verdict sentence says whether your data is ready, the score shows how far, and **What moves the score** ranks the objects to work on first. See [Home](/docs?page=home).
4. Open an object. Select an object in the ledger or on the object map. Its page has the tabs **Overview**, **Rules**, **Fields**, **Records**, **Related**, **History** and **Audit**. See [Objects](/docs?page=objects).
5. Work the inbox or the fix queue. **Inbox** lists the tasks assigned to you and your team. **Fix** holds the proposed corrections in the **Cleaning queue** and groups them into **Batches** for approval. See [Inbox](/docs?page=inbox) and [Fix](/docs?page=fix).
6. Download a report. On Home, open **Export** and choose **Executive report, latest run (PDF)**. Other reports are under **Insights**, in the Summary view's **Reports** tab. See [Reports](/docs?page=reports).

Before the first run, Home names the next step to take. If your role cannot take it, Home says so, for example "Ask an administrator to connect a system." See [Roles and access](/docs?page=roles).

## Guided tours

- The first time you open Home, a row under the ledger offers "New here? A short tour shows where things are". Select **Take the tour** or **Not now**.
- On each Home page, **Tour this page** in the help menu walks you through that page for your role: data lead, steward, Basis or process owner.
- A tour moves with **Next** and **Back**, shows which step you are on, and ends with **Done**. Press Escape to leave it.
- To see the tours again, use **Replay tours** in Preferences.

If you set up the installation, Home also shows a **Get set up** row with the steps still open: **Connect a system**, **Complete a first run**, **Create a first fix batch**, **Invite your team** and **Set an alert channel**. Each step links to its page and ticks itself when done. Select **Dismiss** to hide the row.

## Good to know

- Every number is a link. Select it to open the records behind it.
- Pages are read top down: Home answers how healthy the data is, an object page what is wrong with that object, a rule which records fail, and the record which values to fix.
- Add `?present=1` to an address, or use **Present** on an Insights page, to show the page full screen for a meeting. Press Escape or select **Exit presentation** to return.

## Related

- [Key concepts](/docs?page=concepts)
- [Roles and access](/docs?page=roles)
- [Home](/docs?page=home)
- [Keyboard shortcuts and search](/docs?page=shortcuts)
- [Glossary](/docs?page=glossary)
