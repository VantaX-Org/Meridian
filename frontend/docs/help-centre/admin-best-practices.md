# Administrator best practices

Nothing in Meridian needs a daily inspection. What it needs is a rhythm: one pass a week through the things that fail quietly, and a short order to check them in when something looks wrong.

Start with the licence, then health, then jobs, then what alerted, then the audit trail and the retention policy you set. Fifteen minutes, in that order.

## Licence, seats and version

The licence page shows tenant, tier, status, seats in use against the seats granted, days remaining, the renewal date, when the deployment last validated, and the language-model tier the licence entitles. Validate now asks Meridian HQ immediately instead of waiting for the six-hourly check. Renewals and extra seats are handled in Meridian HQ, not here, and the deployment keeps its data either way; a renewal appears after the next check. Watch the seat line, which warns as the grant runs out.

The same page shows the version running and, for a platform administrator, whether an update is available. Updating restarts Meridian for everyone and rolls back on its own if a step fails; the update script on the server takes a rollback argument too. Plan it like any other change window.

## Connections, and what the states mean

Health is a badge on each system: healthy, degraded, unreachable, sign-in refused, or not tested. Each carries a reason in words, with the raw check text behind it, and each system offers a connection test that names what it found. Sign-in refused is credentials. Unreachable is host, port or route. Degraded usually means a last read that partly failed.

Test the connection before you chase a score. A system whose credentials changed and was never re-tested reads exactly like a healthy one, and trusting a stale badge is the fastest way to lose an afternoon.

## Alerts worth wiring

Four events fire an outbound alert, and the code fires exactly those: an object's score falling further than your drop threshold, new critical rules failing, exception SLA breaches, and records failing again since the pinned baseline. Thresholds and per-object score floors sit on the scoring page; channels sit under notifications.

Set the drop threshold from what your own runs actually do, not from a round number: too tight and every delta extract wakes the channel, too loose and a genuine collapse arrives in Friday's digest. Put critical findings on immediate delivery and everything else on a digest, and send a test when you add a channel. Alerts carry counts, rule ids and links, never record values, which is what makes them safe on a shared channel.

## The audit trail

Every change made through the API is recorded, so the audit log answers who, what, when and from where, with the request behind it when you expand a row. There are three views: the full log, the calls made to the language model with their outcome, and user changes alone. Filter by person, date window or the kind of change, and export as CSV or XLSX with those filters applied, which is what an auditor asks for.

Read the AI view as a health signal too. A run of failures or skipped calls means narrative is silently absent from reports, and the log tells you before your lead does.

## Pricing, so the money is yours

Two panels carry the cost model. Under settings you price risk and return: the currency, the monthly subscription, the unit cost of each business-impact defect type with its factor and mitigated share, and the impact of each configuration finding type. Under scoring you price the record: cost per blocked record by severity, and a value per blocked record for each SAP feature you want in value at risk.

Only your own numbers appear. A feature with no value is left out of value at risk rather than given an invented one, and without a subscription the return states the cost avoided with no multiple attached. Changing the currency relabels amounts; it does not convert them, so restate them.

## Retention and backups

Retention is a policy plus a nightly task: how long runs, reports and audit rows are kept, how many runs per system are always kept, and whether the pinned baseline is protected. Only archived runs are ever purged, and golden records, rules, glossary terms and contracts are never touched. Preview before you save, watch the purge log, and remember that real deletes begin only after a week of dry runs under the current policy. A whole-tenant deletion is a separate, deliberately slow operation, and it returns a certificate.

Backups are your own: this deployment keeps its state in named volumes for the database and for object storage. Snapshot both on one schedule, keep a copy off the host, and restore one to prove it works before you need it.

## When something looks wrong

Check in this order, and stop as soon as an answer appears.

1. Jobs: is a run failed, and what does its error sentence say? Read the cause, fix it, retry the job.
2. System health: is the connection in the state its last test reported, and has the configuration been loaded since the SAP change?
3. Audit: did someone change a rule, a grant or a threshold at the moment the number moved?

Most surprises end at step three.

## Next steps

- Read entitlements and version at [Licence](/admin/licence).
- Manage connections and tests at [Systems](/systems).
- Set channels and retention at [Settings](/admin/settings).
