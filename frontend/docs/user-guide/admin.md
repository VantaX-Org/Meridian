# Admin

Admin is for the people who run Meridian for the organisation. You only see the pages your role allows.

## People and access

- **Users** lists everyone who can sign in, their role and whether they have ever signed in. Invite people by e-mail and give each the least access that lets them work.
- **Roles** shows the built-in roles, which are read-only. Clone one to change it. A role can be granted at a system or an object, so people only see what they are responsible for. This is called its scope.
- **Audit log** records who changed what and when, including AI decisions and role changes.

## Settings

- **Settings** holds tenant-wide options such as scoring weights and thresholds.
- **Notifications** sets the channels that receive alerts: e-mail, Slack, Teams or a webhook. Choose a digest, and whether critical findings are sent at once.
- **AI settings** chooses the language model provider. The model only ever sees aggregated findings, never raw SAP records.
- **Field mapping** and **Reference data** hold the mappings and lookup lists your rules use.

## Operations

- **Jobs** lists running and past background jobs.
- **Triage** manages the assignment rules that route findings to teams, and how long each team has to respond.
- **Licence** shows your seats, modules and tier. Licence checks are the only thing that leaves your environment, and they contain no SAP data.
- **Billing** shows exception billing for the month.

## Good habits

Review the audit log after a role change. Test a notification channel after you add it. Keep a second administrator so access is never held by one person.
