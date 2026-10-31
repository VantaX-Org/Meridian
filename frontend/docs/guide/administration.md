# Administration

Administration is everything that sets up the tenant: who can sign in, what the licence covers, how scoring and alerts behave, and the state of the platform. It opens from your account menu, **Administration**, for anyone who holds an administrative permission, at `/admin`. "Everything that sets up this tenant: who can sign in, what the licence covers, how scoring and alerts behave, and the state of the platform. Each section opens in this column." You see only the sections your role opens; the rest say which permission they need.

The banner on top says "Health of the setup" and names the first thing that needs an administrator, in this order: "The licence is not valid" (button **Open the licence**), "The licence ends in 21 days" (from 30 days before the end, no-go from 7), "2 people are waiting for access" (**Answer the access requests**) and "3 invitations need attention" (**Open users**). With none of these the headline reads "Nothing in the setup needs attention" and "The licence is valid, nobody is waiting for access and every invitation is on its way." Three figures: **Seats in use**, **Waiting for access** and **Licence** (the days left). **People by role** under it is a horizontal bar per role: "A person with several roles counts in each." Aletheia is docked on the right of the Administration pages.

## People and access

- **Users**: "7 of 25 seats. A person's roles are grants: open a row to add or remove them." **Invite a user**, **Import users**, filters by role and status (Invited, Invite expired, Active, Locked, Suspended). A banner warns about invitations older than 7 days. Opening a person shows their grants, what they can do now and every action on the account. Needs manage users.
- **Roles and permissions**: "Built-in roles cannot be changed. Copy one to start a custom role, then set exactly what it may do. Give a role for one system or object only, from a person's grants." The matrix "What each role may do", **Access requests** (grant, or decline with a reason the person reads) and recent changes.
- **Single sign-on**: OpenID Connect with your identity provider (Microsoft Entra ID, Okta). Issuer address, client ID, client secret ("Stored encrypted and never shown again."), button name, the redirect address to register, **Test sign-in** and **Turn off single sign-on**. "People who sign in for the first time get the Viewer role and no access grants; give them access under Users."
- **Sign-in page**: the button name, allowed email domains, **Require single sign-on** ("Password sign-in stops for everyone except administrators, who keep it as a way in if the provider is down."), and the fixed password rules: "At least 12 characters, not the email name, and not a common password"; "10 failed sign-ins lock the account for 15 minutes".
- **View as a role**: "See the product as one role sees it, to answer a support question or check a role before you grant it. Everything is read-only while you view as a role, and starting and stopping are in the audit log." The top bar shows "Viewing as" until you stop.
- **Share links**: "Read-only links to one page, opened as a viewer by people of this tenant until they expire. Revoke one and it stops working at once."
- **Out of office**: "Who is away and who covers their approvals and assigned work. Each person sets their own from Preferences; an administrator can end one."
- **Approval workflows**: who approves fix batches and change requests, in which order, and when a step applies. Each workflow lists its versions with the active one marked. Edit the definition of the next version as JSON, try it with **Dry run** on sample facts (which steps apply, the approvers and how long each has), then **Save as a new version**, active at once or not. **Activate** an older version to go back to it; approvals already under way keep the version they started with. Needs manage workflows.
- **API keys**: "A key acts as its own service account with only the roles you give it, and shows in the audit log under its name. The key itself is shown once, when you create it."

## Tenant

- **Licence**: company, status, tier, seats, validity, last checked, platform version and the licensed modules and features. **Check with Meridian HQ now**. "Plan changes and invoices are handled in Meridian HQ; this deployment keeps its data either way." Every licence is verified against the vendor's Ed25519 key built into the image. When Meridian HQ cannot be reached, the last valid signed answer is honoured for 14 days after it was signed: the page still reads Valid while the API reports the status `offline_grace` with the days left; after that, gated pages lock until Meridian HQ answers again.
- **Billing**: resolved exceptions by billing tier on top of the base fee; read only.
- **Settings**: the tenant; **Dimension weights** ("The score is each measured dimension times its weight. The weights must add up to 100." **Use the DAMA defaults**); **Score bands** ("At or above target is on target (go), at or above warning is at risk, below that is failing."); **Cap rule and tolerance**: "One critical rule failing beyond its tolerance holds that object at 85; two or more hold it at 70. The caps are fixed. The tolerance says how many failing records count as beyond.", with **Failing share, percent** and **Failing records** and the severity weights and multipliers; **Cost model and currency**; **Planner assumptions**; **Retention** (keep runs, reports and audit rows for so many days, keep the baseline; purges rehearse first and the purge log records each one); **Delete all data**, which issues a token that works after 24 hours. **Sandbox mode** is a switch: turning it on (**Enter sandbox mode**) copies the latest finished run into a sandbox run; until it is turned off (**Exit sandbox mode**), decisions land on the copy only, decisions on the real run are refused with the reason ("Sandbox mode is on: decisions apply to the sandbox run only."), and notifications, webhooks, digests, report mailouts and write-backs are held back and counted. A band across every page says "Sandbox: nothing leaves this deployment." with since when and by whom. Entering and exiting need manage system; exiting discards the sandbox runs.
- **Stewardship**: "One accountable owner per object and one steward per company code, plant or organisation." The template per object (owner role, owner, stewards by slice, steward, teams), **Save the template**, **Check what applying does** (a dry-run diff), **Apply**, and **Gaps**: "Every object needs one owner and at least one steward per active slice", for example "Vendor master (AP): No steward for purchasing organisation 1000".
- **Configuration bundle**: "Rules switched on or off, field mappings, waves and their gates, settings, SLA policies and the escalation chain as one JSON file." **Download the bundle**; import with a diff first: "Import adds and changes; it never deletes what the file leaves out. Check the diff first."

## Data

- **Field mappings**: "Name the column in your files that holds each standard SAP field, then save the row." **Reset all to defaults**.
- **Reference data**: postal code and bank code (SWIFT BIC) lists per system. "Until a list is loaded those rules check the format only." An upload replaces the system's current list.
- **Rules import and export**: "Every rule of the tenant as YAML or Excel, and many rules at once back in. Imported rules are validated against the data dictionary and land as drafts for review, never live." **Check the file**, then **Create drafts**.
- **Policy packs**: GxP, SOX and GDPR. Each pack names field classes, the authority each answers to (an article or section, such as "SOX Section 404(a) (controls over changes to vendor payment data)") and the catalogue rules that evidence it. A card per pack shows fields classified, rules evidencing, rules measured, failing records and classes breached, and whether it is applied. **Apply the pack** and **Remove the pack** need manage rules. Open a pack for its classes, their fields and the evidence of each rule, for the current state or one run. An applied class with a failing critical rule is a policy breach: a filled shield beside the score on the landscape cell, the ruler and the object's receipt, which names the class, its authority and the rules.
- **Audit log**: every change, who made it, the object and the result, filters by person, action, object kind and dates, **Export CSV** and **Export Excel**, and **AI calls**: "Every call to the language model: which service, how long, and whether a deterministic rule answered first. Prompts and records are never stored here."

## Notifications

- **Alerts**: channels (email, Microsoft Teams, signed webhook) with their digest, board pack and critical alerts; **When to alert** (critical and high failing rules, score drop in points) and **Score floors per object**. "Alerts carry counts, rule ids and links, never record values."
- **Default digest**: the tenant's default digest. Each person sets their own under Preferences.
- **Digests**: scheduled summaries for a role (the programme lead every Monday at 07:00) or a migration wave: the landscape sentence, score moves, the waves and their gates, approvals waiting, SLA breaches and the top value at risk. The form takes the cadence (a preset or a cron line, checked as you type), the time zone, the channel (email with addresses and people, an alert channel, or the `digest.sent` webhook event), **Attach the digest as a PDF** and **Send on its schedule**. Each digest is one row: its name with who it is for, the cadence and time zone, the channel, when it was last sent ("Sent 27 Oct 2026, 07:00" or "Never sent") and the next send, and **On** or **Paused**. Select a row to open it. In the digest's inspector: **Send now**, **Preview** (the email in a sealed frame, or the numbers it is built from), **Pause**, **Edit**, **Delete** and the delivery log. Needs manage settings.

## Operations

- **Start and schedule** (the runs themselves are on Runs): start an extraction (objects, company codes, plants, document dates, analyse straight after), start an analysis of a stored extraction, load the configuration, scheduled runs, **Upload a file** (a CSV, TSV, Excel, JSON or Parquet file of one object becomes a run and is analysed at once; its columns are matched by the field mappings; needs upload) and recent jobs with **Retry**.
- **Platform and updates**: jobs by state and kind, the platform version and **Update to** the latest when Meridian HQ knows one, **Health checks** (database, cache and queue, background workers, licence, email delivery, file storage): "Each check says what it found and what needs fixing. They refresh every 30 seconds.", and **Support** with **Download diagnostics bundle**: versions, health checks, recent errors and configuration with every secret removed, and no SAP record values.

## Provisioning, theming and compliance

- **Provisioning (SCIM)**, under Users: "Microsoft Entra ID, Okta and other identity providers create, update and suspend people here through SCIM 2.0. Give them the base URL and a token." **Create a token**, **Rotate the token** (the old one stops at once), **Revoke**, and **Group to role**: "A person in one of these identity provider groups gets its role. Saving re-syncs everyone in a SCIM group at once." Only grants SCIM made are removed, and the last active administrator is never left without admin.
- **Appearance**, under Settings: the tenant's accent, logo and name, and a **Dark-mode accent** for people who choose the dark theme, with the contrast of the accent checked before it is saved. Light is the default theme; each person can switch to dark under Preferences, Display.
- **Compliance**, under Settings: data residency, retention days per table family, encryption flags and the last backup.

## Sign-in, audit and tenancy

- The first sign-in of an account that must change its password (the seeded administrator, or an account an administrator reset) goes to the password change before anything else.
- The audit log records sign-in, failed sign-in, lockout, sign-out and password change (`auth.login`, `auth.login_failed`, `auth.lockout`, `auth.logout`, `auth.password_change`), and single sign-on (`auth.sso_login`, `auth.sso_refused`, `auth.sso_user_created`). A failed sign-in keeps the email as typed and the reason, never the password.
- A signed-in request runs in the tenant its verified token names; the deployment's own tenant is set by `MERIDIAN_TENANT_ID`.

## The numbers and where they come from

- **Seats** count active and invited users against the licence.
- **Settings** hold the numbers every score uses: the dimension weights, the score bands, the tolerance (failing share and failing records) and the severity weights. A change applies to the next analysis; scores already stored with a run are kept as they were.
- **Health checks** are measured by the platform itself and refresh every 30 seconds.
- **Policy pack coverage** counts the fields of the pack's classes, the rules that check them, the rules a run has measured and their failing records in the current state; a class is breached when one of its critical rules fails.
- **Digest numbers** are the landscape's own: the preview's numbers are what the email is rendered from.
- **Billing** counts resolved exceptions by tier for the month, on top of the base fee, from Meridian HQ.

## What you can do, by role

- **Platform admin**: every section.
- **Manage users**: users, roles, single sign-on, sign-in page, view as, share links, out of office, API keys.
- **Manage settings**: settings, billing, stewardship, configuration bundle, alerts, default digest, webhooks, digests.
- **Manage system**: licence, platform and updates, the diagnostics bundle, sandbox mode.
- **Manage rules**: apply and remove policy packs; anyone who holds view reads them.
- **View audit** (auditor): the audit log, and a person's activity in People.
- **Manage field mappings**, **manage systems**, **manage rules**: field mappings, reference data, rules import and export.
- **Trigger sync**, **analyse** or **upload** (SAP Basis, analyst, programme lead): start and schedule.
- Anyone who holds view reads the licence, settings, mappings, reference data, alerts and the default digest, read only.

## Administrator training guide

The course for the administrator and the SAP Basis colleague (install and first start, licence, users and access, connecting SAP, extraction and schedules, scoring and money, write-back, notifications, operations and troubleshooting) is the printable administrator training guide, `docs/admin-training/meridian-administrator-training.pdf` in the Meridian repository. Ask your Meridian contact for it if you do not have the repository.

## Keyboard

- In every section table, `j` and `k` move and `Enter` opens the row in the inspector.
- `Esc` closes the inspector; the section index stays on the left.

## When something is wrong

- **"... needs the ... permission. Ask an administrator to grant it."** Your role does not open that section.
- **"These settings are read only for your role."** You can read but not change them.
- **Health check warning "No email backend configured"**: digests and email alerts are not sent until the deployment's email settings are set.
- **Single sign-on test fails**: check the redirect address registered at the identity provider matches the one shown, character for character.
- **"The tenant is already in sandbox mode."** or **"The tenant is not in sandbox mode."**: someone else entered or exited first; the page reads the state again.
- **A digest shows Held back**: the tenant is in sandbox mode, so nothing was sent; the delivery log keeps the attempt.
- **The interactive API documentation answers 404**: `/docs` and `/openapi.json` are served only on a development deployment or with `MERIDIAN_OPENAPI_PUBLIC=1`.
- **A purge request**: purges are irreversible. The token only works after 24 hours so a mistake can be caught; the purge log keeps the record.
