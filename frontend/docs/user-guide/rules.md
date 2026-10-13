# Rules

Rules are the checks Meridian runs. Every number in a score comes from a deterministic rule, written as data, never from a guess.

## The rule list

Rules lists every check with its object, severity, dimension and current state. Filter by state to find disabled rules or rules that have not run yet. Open a rule to see its description, its pass rate over runs, where its field comes from, and the systems it applies to.

## Applicability

When a system's configuration is loaded, each rule is marked as one of four things: applies, does not apply, applies by default, or not available. A rule that does not apply is left out of the score rather than counted as a pass, so unused fields do not skew your result. The reason is shown with the rule.

## Grain and exclusions

A rule is evaluated at a grain, such as a header, a line item or a document, so a failure is counted at the right level. A rule can also exclude a population, such as records already flagged for deletion. Excluded records are neither passes nor failures.

## Other rule pages

- **Contracts** state the quality an object must reach. After each run a contract is marked met or breached.
- **Drafts** hold rules being written before they are published.
- **Data dictionary** describes the SAP fields the rules read.
- **Scoring and alerts** sets the dimension weights and the thresholds for Go and At risk.

## Learned rules

Meridian can suggest rules from the fixes your stewards make. A suggestion takes effect only after a person approves it.

## Changing a rule

Disabling or tuning a rule changes the next run, not past ones, and is written to the audit log.
