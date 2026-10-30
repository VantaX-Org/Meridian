# Walkthrough: administrator

You set the tenant up and keep it right: who signs in and with which roles, how scoring and alerts behave, the licence, the platform version and its health, and the configuration you move between tenants. Your start screen is the **Landscape**; **Administration** is in your account menu.

## Your first five steps

1. **Users**: invite people and give each a role; scope a role to one system or object from their grants.
2. **Single sign-on and sign-in page**: connect your identity provider, test it, then decide whether to require it.
3. **Settings**: check the dimension weights, score bands, cap rule and tolerance, cost model and retention.
4. **Stewardship**: name an owner per object and stewards per slice, **Check what applying does**, then **Apply**; close the **Gaps**.
5. **Platform and updates**: read the health checks and update the platform when a new version is available.

## Your jobs and where they are done

- **Invite users, set roles**: Administration, Users.
- **Custom roles and scoped grants**: Administration, Roles and permissions.
- **Single sign-on**: Administration, Single sign-on and Sign-in page.
- **API keys**: Administration, API keys.
- **Audit log and export**: Administration, Audit log.
- **Export and import the tenant configuration with a dry-run diff**: Administration, Configuration bundle.
- **View the product as a role (support)**: Administration, View as a role; the bar shows "Viewing as".
- **Import and export rules in bulk (YAML and Excel)**: Administration, Rules import and export.
- **Govern share links**: Administration, Share links, **Revoke**.
- **See everyone's out of office**: Administration, Out of office, **End it**.
- **Steward assignment template, apply with a dry-run diff, audit the gaps**: Administration, Stewardship.
- **Licence, platform update, health**: Administration, Licence; Platform and updates.
- **Tenant settings (scoring, cost, retention)**: Administration, Settings.
- **SCIM provisioning and group to role mapping**: Administration, Users, Provisioning (SCIM).
- **Theme and compliance record**: Administration, Settings, Appearance and Compliance.
- **Webhooks, digests, the default digest**: Administration, Webhooks, Digests, Default digest.
- **Diagnostics bundle for support**: Administration, Platform and updates, Support.
- **Your own training**: the administrator training guide, `docs/admin-training/meridian-administrator-training.pdf`.

## The numbers you set

- Dimension weights must add up to 100.
- The caps are fixed at 85 and 70; you set the tolerance: the failing share and the failing records that count as beyond.
- Score bands: target, warning and critical.

## When something is wrong

- **Someone cannot see a section**: compare their role with the matrix under Roles and permissions, or use View as a role.
- **Email is not delivered**: Health checks, Email delivery.
- **Your first sign-in asks for a new password**: the seeded account and any reset account must change it first: 12 characters or more, not the email name, not a common password.
- **Sign-in events**: the audit log records sign-in, failed sign-in, lockout, sign-out and password change; filter by action `auth.login` or `auth.login_failed`.
- **The licence shows fewer modules than expected**: modules come from the licence in Meridian HQ; **Check with Meridian HQ now**, then contact Meridian support.
- **Support**: open help, copy the diagnostics under **Contact support** and send it with your request. It holds no record values and no secrets.
