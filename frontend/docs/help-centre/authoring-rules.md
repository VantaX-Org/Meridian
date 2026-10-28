# Rules: tune, author, learn

Rules are the fixed tests your scores are built from. When a score looks wrong, the cause is usually a rule that is wrong for your configuration rather than data that is wrong for the business. Tuning is normal work: a rule pack ships wide, and your job is to narrow it to what is true here.

## Read a rule before you judge it

Open a rule to see its last pass rate, its description, the fields and tables it reads, its severity, dimension and grain, its owner and its versions. The message and instruction you meet in a record panel come from this page, so if stewards cannot tell what to do with a finding, the fix belongs here.

Check three things when a rule seems wrong. Its basis: which records it actually ran over. Its applicability: whether the field is required, optional, suppressed or absent in your configuration. Its grain: one purchase order with five bad lines is one failing document and five failing lines, and the pass rate means different things at each.

## Disable, or suppress with an expiry

A rule that flags a field your configuration never uses is not strict, it is wrong. Switch it off, or open it and disable it. The change takes effect from the next run; past runs keep their results, so an old report does not quietly alter itself. Do this in the open: say which rule, on which system, and why. A disabled rule nobody can explain is how an audit finding appears two years later.

Suppressions are the softer tool and the one to try first. A suppression keeps a rule, or a single record, out of the score until a date, with the reason and who made it. Use one when the rule is right but the fix is scheduled: a bank key a migration will correct in November, a plant that closes next quarter. The date matters. Set it for when the fix lands, not for a comfortable review cycle, and look at the list when suppressions expire. A rule suppressed twice in a row is a rule your configuration does not support, and it should be rewritten or disabled rather than suppressed a third time.

The two are not the same decision. Disabling changes what the rule pack asserts about your landscape. Suppressing defers a known defect, with an owner and a date. Suppression needs the approve permission, and it should need a name too.

## Dry-run before you publish

Never publish a rule on the strength of how it reads. Choose a finished run and dry-run against it: Meridian applies the draft to the stored records and reports how many it checked, how many failed, and samples of the failures with values masked. The rule becomes active only after a clean dry run, and applies from the next run onwards.

The honest test is a dry run against your latest data, for a blunt reason: the newest run holds the records you would actually flag tomorrow. A dry run against an old run measures defects that may already be cleaned, so a rule that fails nothing there may fail nine thousand records now. If a rule's failure count changes more than threefold between two recent runs of the same scope, ask which run is the exception before you trust either.

Expect a first dry run to over-report. That is the point: the number tells you which condition to add, not whether the idea is sound. Publishing and writing need the manage-rules permission, and the author of a rule version cannot approve it.

## Drafts in words, and rules learned from your data

Where drafts are held, you can describe a check in ordinary language and generate a draft rule. The model sees field metadata and aggregate statistics: table and field names, data dictionary attributes, counts, lengths, formats. It never sees a record value, and what it produces is a draft, labelled as generated, that you review, dry-run and publish yourself. Treat it as a first attempt by a junior analyst who knows the schema and nothing about your business: usually structurally right, occasionally asserting something your configuration does not do.

Meridian can also read your own data for regularities it did not assume. A learned rule is a pattern your records follow consistently, such as a field effectively decided by another field, or a value combination nobody uses. Each comes with its support: how much of the data follows it. Approve one and it becomes an active rule at medium severity; reject it and it is gone.

A pattern at very high support is a house convention worth checking against the business. Sometimes it is the real rule. Sometimes it is a defect everyone has learned to live with, which is exactly the case where a new rule makes noise and a configuration change is the answer. Check the records it would fail before you approve, and re-check after the next run rather than assuming it landed well.

## Proofs: a rule must fail something

Every shipped rule carries a proof: a record that makes it fail, and a record that makes it pass. Conditional rules carry both branches, one where the condition holds and one where the rule is skipped.

The reason is uncomfortable but sound. A rule that has never failed anything is not evidence of clean data; it is evidence the rule cannot see the data. Requiring each rule to fail something and pass something catches the three mistakes that make a rule pack quietly useless: a field name that does not exist, a condition that never matches, and a check that fires on every record and gets switched off within a week.

When you review a rule of your own, ask the same two questions before publishing: what record does this catch, and what record does this let through? If a dry run cannot answer both, the rule is not ready.

## Next steps

- Tune what applies at [Rules](/rules).
- Write and dry-run a draft at [Rule drafts](/rules/drafts).
- Review patterns from your own data at [Learned rules](/rules/learned).
