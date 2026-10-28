# Rules governance for administrators

Rules decide what counts as a defect, so they are the one part of Meridian an administrator should not change casually. Nearly everything shipped is fixed upstream: the tenant's real power is to switch a rule off, keep a noisy one out of the score for a while, and approve or reject the rules proposed from your own data.

## The rule ledger

Open the rules page. Every check an analysis can run is listed there, most failing records first, with its object, severity, pass rate, failing record count, last run and state. Filters cover object, view, severity, state, system type, check type, dimension, authority and table, and search matches the rule id, name, description and tags.

Turning a rule on or off is the only change the ledger accepts, and it needs the manage rules permission. There is no inline switch: because the change moves every later score, each toggle asks first and says what happens. Turning one off means the next analysis stops checking it and its failures no longer count; turning it on reverses both. The message afterwards offers undo, and that undo holds only if nobody has changed the rule since. A rule you switch off stays off until you switch it back, but a later push from HQ can overwrite the flag: the toggle is for immediate relief on a noisy rule between syncs, not permanent reconfiguration. Without the permission, the library is read-only and says so.

## What HQ controls

Severity is not yours to set. Each licence validation copies HQ's catalogue into the tenant: rule id, name, description, module, category, severity, enabled flag, conditions, thresholds and tags. Analysis reads that copy alongside the shipped rules, so a re-severity request goes to Meridian HQ, where the catalogue is maintained.

The one tenant-side route that rewrites a rule is a rule version: a partial override merged over the shipped definition. Versions are listed on the rule's own page with their state and who approved them, and moving a version between states is a page control. Writing one is still an API call rather than a button, under the manage rules permission. That is where the maker-checker sits: a draft goes to review under manage rules, and only a reviewer holding approve, or the AI reviewer permission, can activate it. The author cannot approve their own version, and the earlier active version retires as the new one takes effect, from the next analysis run. Where HQ's catalogue carries a severity for that rule, the catalogue's value is what the analysis uses, whatever the override says.

## Suppressions, and the difference from disabling

A suppression keeps a rule, or one record of it, out of the score until it expires. They are made from a finding rather than from the ledger, and the Suppressions tab lists them with scope, reason, expiry, who made it and an **End now** action for anyone with the approve permission. Ending one takes effect on the next run.

The difference is worth respecting. Disabling is a tenant decision about the rule; a suppression is a decision about a score, time-boxed and attributed, which is what makes it defensible in an audit. An expired suppression simply stops being read.

## Approving what your own data suggests

Learned rules are patterns your data follows for at least nine in ten records. Mining runs after each analysis and can be started by hand from the learned rules page. Approving one creates a live rule from the next run at the severity you pick; rejecting records the decision. Approving needs approve or the AI reviewer permission, and rejecting is also open to whoever maintains rules.

Rule drafts holds the proposals the AI makes from steward corrections, including match rules; someone with the AI review permission approves or rejects each with a reason. Drafted rules are dry-run against an analysed version before they are published.

Every shipped and generated rule is proven before it reaches you: the test suite gives each one a record it fails and a record it passes. A rule that cannot fail tests nothing, and one that cannot pass condemns every record. That proof runs in CI.

## Depth and scoring

The rules page carries a coverage table by object: rules total, how many are configuration-aware, how many apply by default, how many do not apply, and how many applicable rules pass. It is measured on a finished run, so it says nothing before the first one. Per object, that object's rules tab ranks its checks by failing records and drills through to the records.

Scoring is where the numbers are weighted. Dimension weights must sum to one before they save, and the page shows a reweighted preview of the latest run beside the current score, warning that the preview ignores caps. Caps are fixed: a critical rule failing beyond its tolerance caps that object at 85, two or more at 70. Saved weights apply from the next analysis run. The same page holds the alert thresholds, the per-object score floors and the costs that turn defects into money, where a feature with no price is left out of value at risk rather than guessed at.

## Next steps

- Write and dry-run a rule in [Authoring rules](/rules/drafts).
- Review what your data suggests at [Learned rules](/rules/learned).
- Set weights and alert thresholds at [Scoring](/rules/scoring).
