# Creating and managing users

Users are the licence, the queue and the audit trail all at once. Every name on the users page is a seat, a set of grants, and the attribution on every decision that person has made. The page needs the manage users permission; add people deliberately, give them the narrowest role that lets them work, and take access away the day someone leaves.

## Invite the person

Open the users page and start an invitation. You enter the email address, optionally a name, and choose one role: that role applies to every system. Under an expandable section you can add further grants for a single system or a single object instead, and you need at least one grant of either kind before the invitation can go.

The invitation is an email with a link. The person sets their own password on the join page; you never see it and you cannot set it for them. The link is single use and lasts seven days. There is no resend button anywhere on the users page, and the address cannot be invited twice while it is listed, so a lost or expired link is usually fixed by removing the entry and inviting again, which works only while nothing else refers to that account.

The users list shows how many people there are and how many have never signed in. That second number is your follow-up list.

## Roles, and what each one is for

Roles come as grants, not as a field you can type into. Changing someone's role means adding or removing grants under [Roles and access](/admin/roles); the users page refuses a direct role edit and sends you there.

- **Data steward** (and the older steward name) applies values, works the fix list, maintains rules and can take or release records. Stewards land on fix work.
- **Data owner / approver** is the second pair of eyes: approve and export only. They cannot type values or take records, so they land on approvals.
- **Analyst** extracts, runs analyses and exports, but holds no apply or approve, so fix work stays hidden.
- **SAP Basis** adds system connections, credentials and field mapping to the analyst's set.
- **Programme lead / CIO** (and the older manager name) runs the programme: systems, analysis, approvals, assignment and the audit log.
- **Platform admin** (and the older admin name) is everything, including users, roles, settings, the licence and updates.
- **Auditor** reads everything, exports, and opens the audit log. **Viewer** reads only, with no export.
- **Process analyst** reads everything, runs discovery and exports as-is process models.
- **AI reviewer** is the legacy reviewer role, kept for its approval rights over proposed rules.

Older role names still work for accounts that carry them, and each keeps the rights of the modern role above. New grants are given as the modern roles.

## Custom roles and the role matrix

Built-in roles are read-only. Clone one, name the copy, then tick or clear permissions in its matrix and save. A custom role can be granted for one system or one object only, which is how you give a colleague stewardship of a single plant without making them a steward everywhere. Deleting a custom role takes the access away from everyone who holds it, at every scope it was granted for; their other roles stay.

On the same page you can see a person's effective permissions per system, decide access requests people have raised, and read a history of role, grant and request changes.

The view-as switch on any home page previews the layout of another role: the arrangement changes, your permissions do not. Use it to check what a new starter will actually see before you call them.

## Passwords, sessions and leaving

Passwords are short to type and long to guess: twelve characters is the only written rule, and the local policy is deliberately simple. If your organisation enforces something stricter, connect your identity provider and leave local authentication out of the path.

A forced change on first sign-in applies to the seeded bootstrap administrator account, not to invited people. Invited people choose their own password when they accept, so nothing is set on their behalf.

Changing a password signs out every other session that account holds and replaces the current one. That is the point: a stolen session dies with the old password. Password resets behave the same way.

## Suspension, removal and the last admin

Untick Active to block sign-in. A suspension ends that person's live sessions immediately, keeps their name on past work, and is reversible. Removing a user deletes the row, and it asks you to type the email address first. Removal fails when the person is referenced by audit or stewardship records, which is common after any real work: suspend instead.

You cannot change your own access, and an administrator cannot demote, suspend or remove the last active admin of the tenant. Make a second person an admin before you touch the first.

Seats are counted on the licence page, which compares active users against the grant. Adding seats is done in Meridian HQ; nothing in the app buys them.

## Next steps

- Set what each role may do in [Roles and access](/admin/roles).
- Check seats and entitlements in [Licence](/admin/licence).
- Review who changed what in [Audit log](/admin/audit).
