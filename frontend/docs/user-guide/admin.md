# Administration

The admin pages are where the people who run Meridian manage access, alerts, retention, the language model and the installation. Open them from **More** in the index bar, under **Admin**. You only see the pages your role allows.

## What you see

The **Admin** group in **More** lists **Users and audit**, **Audit log** and **Settings**. Under **Settings** sit **Triage**, **Field mapping**, **AI settings**, **Notifications**, **Jobs**, **Reference data** and **Licence**. Two pages have no menu entry and open by address: **Roles and access** at `/admin/roles` and **Exception billing** at `/admin/billing`.

A page opened without the right permission says which one it needs, such as "Needs the `manage_users` permission".

## Users and audit

This page, titled **Users**, has three tabs: **Users**, **Roles** and **Audit log**. It needs the `manage_users` permission, which the Admin role holds.

The **Users** tab lists each person with **Role**, **Status** (Active or Suspended), **Last sign-in** and **Member since**. **Never signed in** counts active users who have not signed in yet. The **Roles** tab shows the role matrix, read only. The **Audit log** tab shows the 50 latest entries.

### How to invite a user

1. Click **Invite user**.
2. Enter the **Email** and, if you like, a **Name**.
3. Choose a **Role**, a **System** (or **All systems**) and a **Module (blank for all)**, then click **Add grant**. Add at least one grant.
4. Click **Send invitation**.

The person receives an email and chooses a password on the **Join Meridian** page.

### How to change a role or deactivate a user

1. Click the user's row, or the action menu and **Edit**.
2. Pick a new **Role**. Its description shows under the list.
3. To block sign-in, clear the **Active** check box. It reads "sign-in is blocked".
4. Click **Save**.

**Remove user** asks for a reason, then deletes the person. If they appear in audit or stewardship records, Meridian refuses and tells you to deactivate them instead.

## Roles and access

**Roles and access** (`/admin/roles`) controls what each role can do and where. It needs `manage_users`. Built-in roles are read only: clone one to change it. A grant can be limited to one system or module, so people get the least access that lets them work.

The tabs are **Roles**, **Users & scopes**, **Invite**, **Requests** and **History**.

### How to make a custom role

1. On **Roles**, open a role's action menu and choose **Clone**.
2. Pick the source in **Clone from**, type a **New role name** and click **Create clone**.
3. Click the new role, tick or clear permissions in the matrix, then click **Save permissions**. **Reset** discards your changes.

**Edit** renames a custom role; **Delete** removes it, and its holders lose its grants.

### How to scope a user and answer requests

1. On **Users & scopes**, click a user.
2. Under **Grants**, add or remove role grants by system and module. **Effective permissions** shows the result.
3. On **Requests**, each open request names the person, the permission and the scope. Click **Grant**, choose a role and click **Grant access**, or click **Decline**, give a reason and click **Decline request**.

People ask through the **Request access** link on a button their role does not allow. **History** lists every role, grant and request change.

## Audit log

**Audit log** records who did what. Admins, Managers and Auditors can open it. It has three tabs:

- **Audit log**: every change, with **When**, **Who**, **Action** and **Request**. Use **Export** for an `.xlsx` or `.csv` file.
- **AI audit**: every call to the language model, with its latency and outcome (**Rule answered**, **Answered**, **Failed** or why it was skipped).
- **User changes**: changes made to user accounts.

## Settings

**Settings** shows the **Deployment** (tenant, licence tier, licence status and language model) and an **Open licence** button. If the licence is not valid, a notice says so: analyses still run, but module entitlements may be restricted. Admins also see these sections:

- **Alert channels**: the same channels as Notifications, with **Send new critical findings immediately**.
- **Retention**: how long runs, reports and audit rows are kept.
- **Health checks**: the database, Redis, object storage, language model, licence server and migrations, each passing, warning or failing. **Check again** refreshes them, and **Fix** opens the page for a failing model or licence check.

Score weights, alert thresholds, currency, the cost model and scheduled report emails live on [Scoring and alerts](/rules/scoring), described in the [Rules](/docs?page=rules) chapter.

### How to set retention

1. Fill in **Keep runs for (days)**, **Keep reports for (days)** and **Keep audit rows for (days)**. Leave a field empty to keep for ever. Audit rows need at least 30 days.
2. Set **Keep latest per system** and leave **Keep the baseline run** on unless you mean otherwise.
3. Click **Save policy**.
4. Click **Preview what would be purged** to see which runs the policy selects. A preview deletes nothing.

Only archived runs are purged, never the baseline or the newest runs of each system. Golden records, rules, glossary terms and contracts are never touched. A new policy runs as a dry run first, as the notice above the fields says, and purges are enforced only once the server sets `MERIDIAN_PURGE_ENABLED`. The **Purge log** lists each dry run and purge.

## Notifications

**Notifications** lists outbound alert channels with **Type**, **Target**, **Digest**, **Board pack**, **Critical alerts** and **Status**. Admins can change them. Slack, Teams and webhook targets show only the host name. Alerts carry counts, rule IDs and links, never record values.

### How to add and test a channel

1. Click **Add channel**.
2. Choose the **Type**: Email, Slack, Teams or Webhook.
3. Enter the **Address**, or a **URL** that starts with `https://`. A webhook also takes a **Signing secret (16 to 256 characters)**.
4. Choose a **Digest**: Daily, Weekly or Off. For email, choose a **Board pack** cadence.
5. Click **Add channel**.
6. Open **Manage** on the row and choose **Send test**. You see "Test message delivered" or "The channel did not accept the test message".

Channels added here send new critical findings at once. To delete one, open **Manage**, choose **Remove**, then **Remove channel**.

### How to send the board pack by email

1. Find the email channel in the list.
2. In **Board pack**, choose **Board pack: weekly** or **Board pack: monthly**. **Board pack: off** stops it.

The channel then receives the board pack and the analyst workbook for the latest finished run, on Monday mornings or on the 1st of the month. Only email channels can take a board pack.

## Triage

**Triage** decides who gets new issues and how long they have. People with `manage_rules` (Admin, Steward) change teams, rules and SLA policies; the calendar needs `manage_settings`.

### How to route new issues

1. Under **Teams**, click **Add team**. Give it a **Name**, a **Strategy** (**Round robin** or **Least loaded**), a **Lead** and **Members**, then **Save**.
2. Under **Assignment rules**, click **Add rule**. Choose **Assign to**, pick severities, and list modules, check IDs, dimensions, company codes, plants or sales orgs, comma-separated. Click **Save**.
3. Use **Up** and **Down** to order the rules. The first match wins; anything unmatched goes to the fallback user.
4. Under **SLA policies**, click **Override** or **Add override** to set **Acknowledge minutes**, **Resolve minutes**, **At-risk %** and **Business hours only**.
5. Under **Working calendar**, set the **Timezone**, **Work days**, **Day starts**, **Day ends**, **Fallback user** and **Holidays**, then **Save calendar**.

## Field mapping

**Field mapping** tells Meridian which column in an imported file holds each standard field. It needs `manage_field_mappings`. A standard field with no customer column is skipped by every check that needs it, and **Unmapped** counts them.

1. Filter by **Object** or **Search**.
2. Type the file's column header in **Customer column**, and optionally a **Customer label** and **Notes**.
3. Click **Save** on the row.

**Reset all to defaults**, then **Reset**, returns the mappings to those Meridian ships with. With an object chosen, only that object is reset.

## AI settings

**AI settings** chooses the language model that writes narrative and remediation proposals. It needs `manage_llm`. The model never sees SAP data. It receives aggregated finding summaries only, and every score, count and rate comes from deterministic checks.

The providers map onto tiers: a cloud API such as **Anthropic (Claude)** or **Azure OpenAI** (tier 1), **Ollama Cloud** (tier 1.5), **Local Ollama** bundled with the installation (tier 2), and **Custom (BYOLLM)** for your own endpoint (tier 3). **OpenAI** and **Google Gemini** are also listed.

1. Choose the **Provider** and **Model**. Fill in **Endpoint URL** or **API key** when asked. A stored key is kept if you leave the field blank.
2. Set **Temperature**, **Max tokens** and **Request timeout**. Bundled Ollama needs a timeout of 120 seconds.
3. Click **Test connection**, then **Save settings**.

## Jobs, reference data and licence

- **Jobs** lists extractions, analyses, uploads and simulations with status, rows, times and any error. **Open** goes to where the result lives.
- **Reference data** shows the postal code and BIC lists held for each system. Upload them from the system's page.
- **Licence** shows the tier, status, seats, days remaining, renewal date, modules and features. Plan changes are made in Meridian HQ. Licence validation carries no SAP data.

These three are read only and appear for anyone who can open **Settings**.

## Exception billing

**Exception billing** (`/admin/billing`) shows resolved exceptions by billing tier for a **Month**, with the **Base fee** and **Total**. It is read only and needs `manage_settings`.

## Updating Meridian

Users with the Admin role see **Platform version** on the **Licence** page, with the version running. When a new version is out and the installation has its update sidecar, a dialog opens on its own.

1. Click **Update now**, or **View update** on the **Licence** page. **Remind me later** hides it for that version.
2. Read the warning: the update restarts Meridian for everyone. Check that no import, sync or export is running.
3. Click **Yes, update now**. The dialog shows each stage and reloads the page when done.

If the update fails, Meridian rolls back to the previous version and the dialog says so.

If the **Licence** page says the auto-update sidecar is not configured, an administrator of the server can run `sudo bash scripts/enable-auto-update.sh` once from the install directory, or update from the command line in that directory:

```
sudo bash scripts/update.sh
```

The script backs up the database, installs the new version, migrates and checks health. If a step fails it rolls back on its own. To return to the previous version later:

```
sudo bash scripts/update.sh --rollback
```

A rollback restores the application, not the database. When an automatic rollback follows a migration, the script prints the command that restores its backup.

## Good to know

- Keep a second administrator so access never rests with one person.
- Test every channel after you add it.
- Pages not in your licence do not appear in **More**.

## Related

- [Roles](/docs?page=roles)
- [Rules](/docs?page=rules)
- [Systems](/docs?page=systems)
- [Inbox](/docs?page=inbox)
- [Troubleshooting](/docs?page=troubleshooting)
