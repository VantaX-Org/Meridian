# Administration

The admin pages are where the people who run Meridian manage access, routing, alerts, retention, the language model and the installation. Open **More**, **Admin**. You see only the pages your role allows; a page opened without the right permission says which one it needs, such as "Needs the `manage_users` permission".

The admin pages share one row of tabs under the page title: **Overview** (Settings, with the checklist of what still needs setting up), **Users**, **Roles and access**, **Sign-in**, **Alerts**, **Triage**, **Field mapping**, **Reference data**, **Jobs**, **Audit log**, **Billing** and **Licence**. A tab appears only when your role may open it, so the row is the same on every admin page, and you can move from one to the next without going back to **More**. When the right-hand side of the index bar shows a number on the **To do** flag, admin chores such as access requests, pending invitations, seats and expiring grants are in it; see [To do](/docs?page=todo).

## Users

This page needs `manage_users`. The header counts the people, how many never signed in and how many seats the licence has used, such as "41 of 50 seats". The list shows each person's role, **Status**, last sign-in and member-since date. Filter by **Search**, **Status**, role and system; the filters are part of the address, so you can share a filtered list.

### User statuses

- **Invited**: the invitation was sent and has not been accepted. It works for seven days.
- **Invite expired**: seven days passed without the person setting a password. Resend the invite.
- **Active**: the person can sign in. **Password change due** next to it means they must choose a new password at their next sign-in.
- **Locked**: ten failed sign-ins locked the account for fifteen minutes. It unlocks by itself, or you can reset the password.
- **Suspended**: the person cannot sign in. Their name stays on past work.

### How to invite a user

1. Select **Invite user** and enter the **Email** and, if you like, a **Name**.
2. Choose a **Role**, or add access for one system or object, with an optional **Expires** date. Add at least one.
3. Select **Send invitation**. The person sets a password on the **Join Meridian** page, or signs in with single sign-on if you turned it on.

An invited person takes a seat at once. When seats are nearly used up the page warns you, and at the limit invitations are refused until you suspend someone or raise the licence.

### Invitations that need attention

When invitations are older than seven days or an email could not be delivered, a notice says so. Open the row's actions to **Resend invite**, **Copy invite link** (a one-time link you can pass on yourself when email does not arrive, which works until the date shown) or **Revoke invite**. Revoking removes the person from the list; you can invite them again later.

### How to import many people

Select **Import users** to add a team from a CSV file. Paste it or choose **Upload a CSV file**. The columns are `email`, `name`, `role`, `system` and `module`; the last two may be blank. Select **Check the file** first: every line gets a verdict, and the page shows how many seats the lines need against how many are free. Nothing is written until you select **Import**. Lines that fail are skipped and named, and the rest are invited. A file can be up to 256 KB, and the import is refused as a whole when it would pass the seat limit.

### How to change, suspend or remove a user

Select the user to change the role or access. In the row's actions you can **Suspend** (the person cannot sign in, their history stays), **Reactivate**, **Reset password** (sends a reset email) or **Remove**. Select several rows to suspend, reactivate, resend or reset in one step; anyone the system refuses, such as yourself or the last administrator, is skipped and named. **Remove** asks for confirmation. A user referenced by audit or stewardship records cannot be removed, so suspend them instead. **Export users** downloads the list.

For the fix workflow, give each steward the Data steward role and each approver the Data owner role, so every batch has a second person who can approve it. See [Roles and access](/docs?page=roles).

## Roles and access

**Roles and access** controls what each role can do and where. It has the tabs **Roles**, **Matrix**, **Users & scopes**, **Requests**, **History**, **Invite** and **API keys**. Built-in roles are read only: **Clone** one, then tick or clear permissions in its grid and **Save permissions**. The **Matrix** shows what every role may do on each kind of data, and the **What this role sees** preview lists the pages a person holding only that role could open, without impersonating anyone. On **Users & scopes**, add grants by system and module, give a grant an expiry date and check a user's **Effective permissions**. Before a grant is saved, a preview shows what it changes. **Expiring within 30 days** lists the grants to review. **Requests** lists the access requests people sent with **Request access**: **Grant** or **Decline** each. **History** lists every change. The details are in [Roles and access](/docs?page=roles).

### API keys

An API key lets another system, such as your scheduler or reporting tool, call Meridian without a person signing in. Open **Roles and access**, then **API keys**.

- **Create a key**: name it, choose what it may do (the same roles and scopes as a person, never an administrator role) and, if you like, when it expires. The key is shown once. Copy it into the other system straight away; Meridian keeps only a fingerprint of it.
- **Revoke a key** to stop it working at once. **Delete** removes it from the list.
- A key belongs to a service account. Service accounts are not people: they do not use a seat, cannot sign in with a password and are managed only here.
- Keys that expire within 14 days appear in **To do** for administrators.

## Audit log

The **Audit log** records who did what, with **When**, **Who**, **Action** and **Request**, and exports as `.xlsx` or `.csv`. **AI audit** lists every call to the language model with its outcome. Every decision in Fix work, every approval and every export is in the log. Admins, programme leads and auditors can open it.

## Settings

**Overview**, the Settings page, shows the deployment (tenant, licence and language model), then **Alert channels**, **Retention** (how long runs, reports and audit rows are kept; only archived runs are ever purged, never a baseline) and **Health checks** for the database, Redis, object storage, the language model, the licence server and migrations, with **Check again**.

## Alerts

[Alerts](/admin/alerts) answers who is told about what, and when. It needs `manage_settings`; others read it.

- **When to alert**: alert when a run has at least this many critical or high failing rules, or when an object's score falls by more than a set number of points against the previous run. **Score floors per object** raise an in-app alert when an analysis scores an object below its floor. Select **Save thresholds**.
- **Channels**: Email, Slack, Microsoft Teams or a signed webhook. Select **Add channel**, choose the type, enter the address or an `https` URL, and choose a digest: **Daily digest**, **Weekly digest**, **No digest**, or **Send new critical findings immediately**. A **Board pack** channel receives the board pack and the analyst workbook for the latest finished run, weekly or monthly. Then **Send test**. Alerts carry counts, rule IDs and links, never record values. A channel with no digest and no immediate delivery never fires.
- **Default digest**: the summary the whole organisation gets by default, by email and Teams. Each person still picks their own under **Your own digest**.

How the score itself is weighted is a different page: see **Scoring** in [Rules](/docs?page=rules).

## Sign-in

[Sign-in](/admin/sign-in) needs `manage_users`. It holds three things.

- **Single sign-on**: connect your identity provider through OpenID Connect, such as Microsoft Entra ID or Okta. Enter a **Display name**, the **Issuer address**, the **Client ID** and the **Client secret** (it is stored but never shown again), and optionally the **Allowed email domains**. Register the redirect address the page shows at your identity provider, then test the connection before you save. A person who signs in this way for the first time becomes a viewer with no access grants; give access afterwards under Roles and access. **Turn off single sign-on** removes the settings; people keep their accounts and sign in with a password, or use **Forgot password**.
- **Require single sign-on**: password sign-in then stops for everyone except administrators, so a person who cannot reach the identity provider is locked out until an administrator changes this. Meridian asks you to confirm.
- **Password sign-in**: the rules are fixed and are not settings. A password has at least 12 characters, is not the email name and is not a common password. Ten failed sign-ins lock an account for 15 minutes.

## Triage

**Triage** decides who gets new issues and how long they have, which drives the **Overdue** and **Due today** pills in Fix work and the SLA pills in the Inbox.

1. Under **Teams**, add a team with a name, a strategy (**Round robin** or **Least loaded**), a lead and members.
2. Under **Assignment rules**, add rules that send issues by severity, module, rule, dimension, company code, plant or sales organisation to a team or person. The first match wins; anything else goes to the fallback user.
3. Under **SLA policies**, set the acknowledge and resolve times and the at-risk share.
4. Under **Working calendar**, set the time zone, work days, hours, fallback user and holidays.

## Field mapping

**Field mapping** tells Meridian which column of an imported file holds each standard field. Type the file's header in **Customer column** and **Save**. A standard field with no column is skipped by every check that needs it.

## Language model

Meridian runs its own language model inside the installation to write narrative and remediation text. It is set when Meridian is installed and has no settings page. It never sees SAP data: it receives aggregated finding summaries only, and every score, count and suggested value comes from deterministic checks. The **AI audit** tab of the audit log lists every call it answered.

## Jobs, reference data and licence

**Jobs** lists extractions, analyses, uploads and simulations with their status and any error. **Reference data** shows the postal code and BIC lists held per system. **Licence** shows the tier, seats, modules and renewal date, and, for platform admins, the version running with **Update now** when a new one is out. The update restarts Meridian for everyone and rolls back on its own if a step fails. From the server, `sudo bash scripts/update.sh` updates and `sudo bash scripts/update.sh --rollback` returns to the previous version.

## Related

- [Roles and access](/docs?page=roles)
- [To do](/docs?page=todo)
- [Monitoring](/docs?page=monitoring)
- [Inbox](/docs?page=inbox)
- [Data in](/docs?page=data-in)
- [Troubleshooting](/docs?page=troubleshooting)
