# Administration

The admin pages are where the people who run Meridian manage access, routing, alerts, retention, the language model and the installation. Open **More**, **Admin**. You see only the pages your role allows; a page opened without the right permission says which one it needs, such as "Needs the `manage_users` permission".

The **Admin** section lists **Users and audit**, **Audit log** and **Settings**. Under **Settings** sit **Triage**, **Field mapping**, **AI settings**, **Notifications**, **Jobs**, **Reference data** and **Licence**. **Roles and access** opens at `/admin/roles`.

## Users and audit

This page needs `manage_users`. The **Users** tab lists each person with their role, status (**Active** or **Suspended**), last sign-in and since when they are a member.

### How to invite a user

1. Select **Invite user** and enter the **Email** and, if you like, a **Name**.
2. Choose a **Role**, a **System** (or **All systems**) and a module (blank for all), then **Add grant**. Add at least one.
3. Select **Send invitation**. The person sets a password on the **Join Meridian** page.

For the fix workflow, give each steward the Data steward role and each approver the Data owner role, so every batch has a second person who can approve it. See [Roles and access](/docs?page=roles).

### How to change or remove a user

Select the user, pick a new **Role**, or clear **Active** to block sign-in, and **Save**. **Remove user** asks for a reason; a user referenced by audit or stewardship records cannot be removed, so deactivate them instead.

## Roles and access

**Roles and access** controls what each role can do and where. Built-in roles are read only: **Clone** one, then tick or clear permissions in its grid and **Save permissions**. On **Users & scopes**, add grants by system and module and check a user's **Effective permissions**. **Requests** lists the access requests people sent with **Request access**: **Grant** or **Decline** each. **History** lists every change.

## Audit log

The **Audit log** records who did what, with **When**, **Who**, **Action** and **Request**, and exports as `.xlsx` or `.csv`. **AI audit** lists every call to the language model with its outcome. Every decision in Fix work, every approval and every export is in the log. Admins, programme leads and auditors can open it.

## Settings

**Settings** shows the deployment (tenant, licence and language model), then **Alert channels**, **Retention** (how long runs, reports and audit rows are kept; only archived runs are ever purged, never a baseline) and **Health checks** for the database, Redis, object storage, the language model, the licence server and migrations, with **Check again**.

## Triage

**Triage** decides who gets new issues and how long they have, which drives the **Overdue** and **Due today** pills in Fix work and the SLA pills in the Inbox.

1. Under **Teams**, add a team with a name, a strategy (**Round robin** or **Least loaded**), a lead and members.
2. Under **Assignment rules**, add rules that send issues by severity, module, rule, dimension, company code, plant or sales organisation to a team or person. The first match wins; anything else goes to the fallback user.
3. Under **SLA policies**, set the acknowledge and resolve times and the at-risk share.
4. Under **Working calendar**, set the time zone, work days, hours, fallback user and holidays.

## Notifications

**Notifications** lists the outbound channels: Email, Slack, Teams or Webhook. Select **Add channel**, choose the type, enter the address or an `https` URL, pick a digest, and **Add channel**. Then open **Manage**, **Send test**. Alerts carry counts, rule IDs and links, never record values. An email channel can also take the board pack weekly or monthly.

## Field mapping

**Field mapping** tells Meridian which column of an imported file holds each standard field. Type the file's header in **Customer column** and **Save**. A standard field with no column is skipped by every check that needs it.

## AI settings

**AI settings** chooses the language model that writes narrative and remediation text: a cloud provider, a hosted service, the model bundled with the installation, or your own endpoint. It needs `manage_llm`. The model never sees SAP data: it receives aggregated finding summaries only, and every score, count and suggested value comes from deterministic checks. Choose the provider and model, select **Test connection**, then **Save settings**. The bundled model needs a request timeout of 120 seconds.

## Jobs, reference data and licence

**Jobs** lists extractions, analyses, uploads and simulations with their status and any error. **Reference data** shows the postal code and BIC lists held per system. **Licence** shows the tier, seats, modules and renewal date, and, for platform admins, the version running with **Update now** when a new one is out. The update restarts Meridian for everyone and rolls back on its own if a step fails. From the server, `sudo bash scripts/update.sh` updates and `sudo bash scripts/update.sh --rollback` returns to the previous version.

## Related

- [Roles and access](/docs?page=roles)
- [Inbox](/docs?page=inbox)
- [Data in](/docs?page=data-in)
- [Troubleshooting](/docs?page=troubleshooting)
