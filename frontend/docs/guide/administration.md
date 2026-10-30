# Administration

Administration is everything that sets up the tenant: who can sign in, what the licence covers, how scoring and alerts behave, and the state of the platform. It opens from your account menu, **Administration**, for anyone who holds an administrative permission, at `/admin`. "Everything that sets up this tenant: who can sign in, what the licence covers, how scoring and alerts behave, and the state of the platform. Each section opens in this column." You see only the sections your role opens; the rest say which permission they need.

## People and access

- **Users**: "7 of 25 seats. A person's roles are grants: open a row to add or remove them." **Invite a user**, **Import users**, filters by role and status (Invited, Invite expired, Active, Locked, Suspended). A banner warns about invitations older than 7 days. Opening a person shows their grants, what they can do now and every action on the account. Needs manage users.
- **Roles and permissions**: "Built-in roles cannot be changed. Copy one to start a custom role, then set exactly what it may do. Give a role for one system or object only, from a person's grants." The matrix "What each role may do", **Access requests** (grant, or decline with a reason the person reads) and recent changes.
- **Single sign-on**: OpenID Connect with your identity provider (Microsoft Entra ID, Okta). Issuer address, client ID, client secret ("Stored encrypted and never shown again."), button name, the redirect address to register, **Test sign-in** and **Turn off single sign-on**. "People who sign in for the first time get the Viewer role and no access grants; give them access under Users."
- **Sign-in page**: the button name, allowed email domains, **Require single sign-on** ("Password sign-in stops for everyone except administrators, who keep it as a way in if the provider is down."), and the fixed password rules: "At least 12 characters, not the email name, and not a common password"; "10 failed sign-ins lock the account for 15 minutes".
- **View as a role**: "See the product as one role sees it, to answer a support question or check a role before you grant it. Everything is read-only while you view as a role, and starting and stopping are in the audit log." The top bar shows "Viewing as" until you stop.
- **Share links**: "Read-only links to one page, opened as a viewer by people of this tenant until they expire. Revoke one and it stops working at once."
- **Out of office**: "Who is away and who covers their approvals and assigned work. Each person sets their own from Preferences; an administrator can end one."
- **API keys**: "A key acts as its own service account with only the roles you give it, and shows in the audit log under its name. The key itself is shown once, when you create it."

## Tenant

- **Licence**: company, status, tier, seats, validity, last checked, platform version and the licensed modules and features. **Check with Meridian HQ now**. "Plan changes and invoices are handled in Meridian HQ; this deployment keeps its data either way."
- **Billing**: resolved exceptions by billing tier on top of the base fee; read only.
- **Settings**: the tenant; **Dimension weights** ("The score is each measured dimension times its weight. The weights must add up to 100." **Use the DAMA defaults**); **Score bands** ("At or above target is on target (go), at or above warning is at risk, below that is failing."); **Cap rule and tolerance**: "One critical rule failing beyond its tolerance holds that object at 85; two or more hold it at 70. The caps are fixed. The tolerance says how many failing records count as beyond.", with **Failing share, percent** and **Failing records** and the severity weights and multipliers; **Cost model and currency**; **Planner assumptions**; **Retention** (keep runs, reports and audit rows for so many days, keep the baseline; purges rehearse first and the purge log records each one); **Delete all data**, which issues a token that works after 24 hours.
- **Stewardship**: "One accountable owner per object and one steward per company code, plant or organisation." The template per object (owner role, owner, stewards by slice, steward, teams), **Save the template**, **Check what applying does** (a dry-run diff), **Apply**, and **Gaps**: "Every object needs one owner and at least one steward per active slice", for example "Vendor master (AP): No steward for purchasing organisation 1000".
- **Configuration bundle**: "Rules switched on or off, field mappings, waves and their gates, settings, SLA policies and the escalation chain as one JSON file." **Download the bundle**; import with a diff first: "Import adds and changes; it never deletes what the file leaves out. Check the diff first."

## Data

- **Field mappings**: "Name the column in your files that holds each standard SAP field, then save the row." **Reset all to defaults**.
- **Reference data**: postal code and bank code (SWIFT BIC) lists per system. "Until a list is loaded those rules check the format only." An upload replaces the system's current list.
- **Rules import and export**: "Every rule of the tenant as YAML or Excel, and many rules at once back in. Imported rules are validated against the data dictionary and land as drafts for review, never live." **Check the file**, then **Create drafts**.
- **Audit log**: every change, who made it, the object and the result, filters by person, action, object kind and dates, **Export CSV** and **Export Excel**, and **AI calls**: "Every call to the language model: which service, how long, and whether a deterministic rule answered first. Prompts and records are never stored here."

## Notifications

- **Alerts**: channels (email, Microsoft Teams, signed webhook) with their digest, board pack and critical alerts; **When to alert** (critical and high failing rules, score drop in points) and **Score floors per object**. "Alerts carry counts, rule ids and links, never record values."
- **Notifications**: the tenant's default digest. Each person sets their own under Preferences.

## Operations

- **Runs and jobs**: start an extraction (objects, company codes, plants, document dates, analyse straight after), start an analysis of a stored extraction, load the configuration, scheduled runs, **Upload a file** (a CSV, TSV, Excel, JSON or Parquet file of one object becomes a run and is analysed at once; its columns are matched by the field mappings; needs upload) and recent jobs with **Retry**.
- **Jobs and system update**: jobs by state and kind, the platform version and **Update to** the latest when Meridian HQ knows one, and **Health checks** (database, cache and queue, background workers, licence, email delivery, file storage): "Each check says what it found and what needs fixing. They refresh every 30 seconds."

## Provisioning, theming and compliance

These are set through the API in this version; there is no screen for them yet:

- **SCIM provisioning**: SCIM 2.0 under `/scim/v2`, authenticated by a per-tenant token issued, rotated and revoked at `POST /api/v1/admin/scim/token`. Map identity-provider groups to roles at `GET/PUT /api/v1/admin/scim/group-roles`. Only grants SCIM made are removed, and the last active administrator is never left without admin.
- **Theming**: `GET/PUT /api/v1/settings/theme` sets the tenant's colours and logo (PNG or SVG), with contrast checks.
- **Compliance**: `GET/PUT /api/v1/settings/compliance` records data residency, retention days per table family, encryption flags and the last backup.

## The numbers and where they come from

- **Seats** count active and invited users against the licence.
- **Settings** hold the numbers every score uses: the dimension weights, the score bands, the tolerance (failing share and failing records) and the severity weights. A change applies to the next analysis; scores already stored with a run are kept as they were.
- **Health checks** are measured by the platform itself and refresh every 30 seconds.
- **Billing** counts resolved exceptions by tier for the month, on top of the base fee, from Meridian HQ.

## What you can do, by role

- **Platform admin**: every section.
- **Manage users**: users, roles, single sign-on, sign-in page, view as, share links, out of office, API keys.
- **Manage settings**: settings, billing, stewardship, configuration bundle, alerts, notifications.
- **Manage system**: licence, jobs and system update.
- **View audit** (auditor): the audit log, and a person's activity in People.
- **Manage field mappings**, **manage systems**, **manage rules**: field mappings, reference data, rules import and export.
- **Trigger sync** or **analyse** (SAP Basis, analyst, programme lead): runs and jobs.
- Anyone who holds view reads the licence, settings, mappings, reference data, alerts and notifications, read only.

## Keyboard

- In every section table, `j` and `k` move and `Enter` opens the row in the inspector.
- `Esc` closes the inspector; the section index stays on the left.

## When something is wrong

- **"... needs the ... permission. Ask an administrator to grant it."** Your role does not open that section.
- **"These settings are read only for your role."** You can read but not change them.
- **Health check warning "No email backend configured"**: digests and email alerts are not sent until the deployment's email settings are set.
- **Single sign-on test fails**: check the redirect address registered at the identity provider matches the one shown, character for character.
- **A purge request**: purges are irreversible. The token only works after 24 hours so a mistake can be caught; the purge log keeps the record.
