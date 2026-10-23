# Roles and access

Your role decides which pages you see in Meridian and what you can change on them. This chapter lists every role, what it allows, where each role lands after sign-in, and how an administrator grants access to one system or object only.

## How access works

- Every user has one main role. It applies to every system and every object.
- An administrator can add grants: a further role for all systems, for one system, for one object (module), or for one object on one system.
- What you can do is the sum of your main role and every grant that covers the page or record you are working on.
- Pages and buttons you cannot use are hidden. The menus never offer a page that would only refuse you.
- The server checks the same permissions on every request, so hiding a button is a convenience, not the protection.

## The roles

Meridian has persona roles, named after the people who use it, and older legacy roles kept for existing users. Each legacy role has exactly the rights of the persona role it maps to. The names below are the ones shown on the Roles and access page; the Users page shows the shorter legacy names in brackets.

### Platform admin

Also **Admin (legacy)**, shown as **Admin** on the Users page. Full access: users and roles, rules, field mapping, AI settings, notifications and other settings, the licence and platform updates, the audit log, and everything the other roles can do.

### Programme lead / CIO

Also **Manager (legacy)**, shown as **Manager**. Runs the programme. Can connect and edit SAP systems, extract, import files, run analysis, approve and apply fixes, assign work, export, edit master data, export process models and read the audit log. Cannot manage users, rules or settings.

### Data steward

Also **Steward (legacy)**, shown as **Steward**. Owns the data. Can import files, extract, run analysis, approve and apply fixes, assign work, export, edit master data, maintain rules, data contracts and the glossary, and review rules proposed by the AI. Cannot connect or edit systems, manage users or read the audit log.

### Data owner / approver

Also **Approver (legacy)**, shown as **Approver**. The four-eyes approver. Can read everything, approve fix batches, golden records and stewardship changes, sign off migration waves, and export. Cannot import, extract or analyse.

### Analyst

Can import files, extract, run analysis, including the AI-assisted analysis, and export results. Cannot approve anything.

### SAP Basis / integration admin

Everything the Analyst can do, plus connecting and editing SAP systems and their credentials, and maintaining field mappings.

### Auditor

Read-only access to everything, plus export and the audit log.

### Viewer

Read-only access to dashboards, objects, findings and reports. A viewer has no export; on report pages the export button becomes **Print**.

### Process analyst

Read-only access to everything, plus running process discovery and exporting as-is process models.

### AI reviewer (legacy)

Shown as **AI Reviewer**. Read-only access, plus reviewing and approving rules proposed from steward corrections, and giving feedback on findings.

## What each role sees

Every role can open **Home**, **Objects**, **Runs**, **Inbox**, **Insights** and **Systems**, and under **More** the Process, MDM and Rules pages. The rest depends on the role.

- **Fix** and **What-if** appear for roles that approve or apply fixes: Platform admin, Programme lead, Data steward and Data owner.
- **Inbox**, **Exceptions** appears for the same four roles.
- **Import file** and **Migration** appear for roles that import or analyse: Platform admin, Programme lead, Data steward, Analyst and SAP Basis.
- **Rules**, **Drafts** appears for roles that maintain rules: Platform admin and Data steward.
- **Users and audit** appears for Platform admin only.
- **Audit log** appears for Platform admin, Programme lead and Auditor.
- **Settings** appears for Platform admin, with every settings page, and for Data steward, with **Triage**, **Jobs**, **Reference data** and **Licence**.

Your licence can also switch pages off. A page your licence does not include is hidden for every role.

Tables follow the same rule. Roles that can change nothing, such as Viewer and Auditor, get no selection boxes and no bulk actions.

## Where each role lands

After sign-in, Meridian opens the Home page for your main role.

- Platform admin, Programme lead, Analyst, Auditor, Viewer and AI reviewer open the data lead view, `/home/lead`. So do the legacy Admin and Manager roles.
- Data steward and Data owner open the steward view, `/home/steward`. So do the legacy Steward and Approver roles.
- SAP Basis opens the Basis view, `/home/basis`.
- Process analyst opens the process owner view, `/home/process`.

Anyone can switch view with **View as** on Home: **Data lead**, **Steward**, **Basis** or **Process owner**. The view changes the page layout, not your rights.

## Scoped access

An administrator can give a role for one system, one object or both. For example, a person can be a Viewer everywhere and a Data steward for Material master on PRD ECC only.

- When any of your grants is scoped, the scope bar shows a pill such as "Scoped: PRD ECC, Material master". A "+2" at the end means two more scoped grants.
- A scoped grant counts only on pages and records of its system and object. Elsewhere your main role applies.
- If every grant you hold is scoped, lists of systems and runs show only the systems your grants cover.
- Rights over users, the licence, AI settings and the audit log always cover the whole installation. A scope does not apply to them.

## How to ask for access

Most buttons you cannot use are hidden. Four main actions stay visible but disabled, so you know they exist: **Extract**, **Approve**, **Write back** and **Sign off**. Hover over one to see the role it needs, for example "Needs SAP Basis on PRD ECC".

1. Select **Request access** beside the disabled button. If a change you start is refused because your grants do not cover it, the same dialog opens by itself.
2. Check the **Resource**, **Action** and **Scope** Meridian has filled in.
3. Write a **Reason**.
4. Select **Send request**. Meridian confirms with "Request sent to admins".

An administrator then grants or declines the request. See below.

## How an administrator manages users

User management needs the Platform admin role. Open **More**, then **Users and audit**. The page has three tabs.

- **Users** lists everyone with **Role**, **Status** (**Active** or **Suspended**), **Last sign-in** and **Member since**. A tile counts users who have **Never signed in**.
- **Roles** shows the **Role matrix**, which permissions each role holds, and **Who holds each role**.
- **Audit log** lists who did what and when, and exports it as Excel or CSV.

### How to invite a user

1. On **Users**, select **Invite user**.
2. Enter the **Email** and, if you like, the **Name**.
3. Add at least one grant: choose a **Role**, a **System** (or **All systems**) and a **Module** (leave it blank for all), then select **Add grant**.
4. Select **Send invitation**.

The first grant for all systems and all modules becomes the user's main role. Without one, the main role is Viewer. The user receives an email with a link to set a password.

### How to change or remove a user

1. On **Users**, select the user.
2. Change the **Role**, or clear **Active** to block sign-in.
3. Select **Save**.

To remove a user, select **Remove user**, give a reason and confirm. A user who is referenced by audit or stewardship records cannot be removed; clear **Active** instead.

## Roles and access

Grants, custom roles and access requests live on the Roles and access page. It is not in the menus; open it at [/admin/roles](/admin/roles). It needs the Platform admin role. Its tabs are:

- **Roles**: every built-in and custom role. Built-in roles are read-only. Select **Clone** to copy one into a custom role, then change its permissions in the grid of resources (such as systems, rules, fixes and reports) and actions (view, create, edit, approve, run, export and admin), and select **Save permissions**.
- **Users & scopes**: select a user to see their **Grants**, add or remove grants, and check their **Effective permissions** for any system and module.
- **Invite**: the same invitation as on the Users page.
- **Requests**: open access requests. Select **Grant**, choose a role and select **Grant access**; the grant is created at the requested scope. Or select **Decline** and give a reason.
- **History**: every change to roles, grants and requests, with the values before and after.

## Good to know

- Approving needs a second person. The person who created a fix batch cannot approve or export it, and a write-back request must be approved by someone other than the requester.
- A suspended user cannot sign in, and their history stays attributed to them.
- Permissions load right after sign-in. Until they arrive, buttons that change data stay hidden rather than flash and disappear.

## Related

- [Welcome to Meridian](/docs?page=welcome)
- [Administration](/docs?page=admin)
- [Fix](/docs?page=fix)
- [Inbox](/docs?page=inbox)
- [Glossary](/docs?page=glossary)
