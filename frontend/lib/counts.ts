/**
 * The canonical count vocabulary. Every tile label, column header, badge and sentence in the product that names one
 * of these numbers takes its words from `COUNT_DEFS`, and the user guide glossary lists the same words
 * (`countsGlossarySection`, checked by lib/__tests__/counts.test.ts), so a number is never called two things.
 *
 * `label` is the one name. `hint` is the one-sentence definition, safe to print under a tile or in a tooltip. `unit`
 * is the singular noun the number counts, for sentences and chart units: `plural(n, COUNT_DEFS.x.unit)`.
 *
 * The matching SQL for each key sits in the docstring of the API that serves it (api/routes/work.py, objects.py,
 * shell.py, attention.py); the comment on each key below names that source.
 */

export type CountKey =
  | "score"
  | "verdict"
  | "failing_rules"
  | "blocking_rules"
  | "rule_failures"
  | "records_to_fix"
  | "critical_records"
  | "suggested"
  | "overdue_records"
  | "approvals_waiting"
  | "inbox_open"
  | "sla_breached"
  | "objects_below_target"
  | "new_failing"
  | "recovered"
  | "newly_failing_rules"
  | "recovered_rules";

export interface CountDef {
  /** The name on every tile, column header and badge. Sentence case. */
  label: string;
  /** One sentence: what the number is. */
  hint: string;
  /** The singular noun counted, for "3 rule failures" style sentences. */
  unit: string;
}

export const COUNT_DEFS: Readonly<Record<CountKey, CountDef>> = {
  /** Source: `dqs_summary` of the object or run (api/services/scoring.py), 0 to 100, held down by the cap when a critical rule fails. */
  score: {
    label: "Score",
    hint: "The data quality score of the object or run, from 0 to 100, held down when a critical rule fails.",
    unit: "point",
  },
  /** Source: the tenant's score bands (`thresholds`, GET /settings/thresholds) applied to `score`. */
  verdict: {
    label: "Verdict",
    hint: "Go, At risk or No-go, from the score and your score bands.",
    unit: "verdict",
  },
  /** Source: rules with `affected_count > 0` in the object's run (`objects.failing_checks`). */
  failing_rules: {
    label: "Failing rules",
    hint: "Rules that failed on at least one record in the run.",
    unit: "failing rule",
  },
  /** Source: failing rules of severity critical or high (`BLOCKING_SEVERITIES` in api/services/severity.py). Never "blocking findings" in copy. */
  blocking_rules: {
    label: "Critical and high failing rules",
    hint: "Failing rules of critical or high severity, the ones that stand in the way of a Go verdict.",
    unit: "critical or high failing rule",
  },
  /** Source: the sum of `affected_count` over failing rules (`objects.affected_records`). A record failing two rules is counted twice. */
  rule_failures: {
    label: "Rule failures",
    hint: "Failing records summed over every failing rule: a record failing two rules counts twice.",
    unit: "rule failure",
  },
  /** Source: distinct `work_records` with `status = 'to_fix'` for the runs in scope (GET /work/summary; shell counts `fix`). The Fix pill badge. Never substituted by proposals: with no work list the badge is hidden. */
  records_to_fix: {
    label: "Records to fix",
    hint: "Distinct records in the work list that still need a decision, however many rules they fail.",
    unit: "record",
  },
  /** Source: records to fix whose worst failing rule is critical (work summary `critical`). */
  critical_records: {
    label: "Critical records",
    hint: "Records to fix whose worst failing rule is critical.",
    unit: "critical record",
  },
  /** Source: records to fix that carry a proposed value (`sugg=1` on the work list; work summary `proposed`). Replaces "cleaning proposals" in copy. */
  suggested: {
    label: "With a suggested value",
    hint: "Records to fix that already carry a suggested value you can accept.",
    unit: "record",
  },
  /** Source: records to fix past their due date (work summary `overdue`). */
  overdue_records: {
    label: "Overdue records",
    hint: "Records to fix that are past their due date.",
    unit: "overdue record",
  },
  /** Source: `remediation_batches` in draft with at least one accepted item, plus `golden_writeback_requests` pending approval. One number, one page (/inbox?kind=approvals). */
  approvals_waiting: {
    label: "Approvals waiting",
    hint: "Fix batches and SAP write-backs that wait for a second person to approve.",
    unit: "approval",
  },
  /** Source: `stewardship_queue` rows with status open, in progress or escalated (shell counts `inbox`). */
  inbox_open: {
    label: "Open inbox items",
    hint: "Inbox items that are open, in progress or escalated.",
    unit: "open inbox item",
  },
  /** Source: open inbox items with `due_at < now()` (sla_state breached). */
  sla_breached: {
    label: "Overdue inbox items",
    hint: "Open inbox items that are past their due time.",
    unit: "overdue inbox item",
  },
  /** Source: objects whose verdict is At risk or No-go (`isBelowTarget` in lib/home-metrics.ts). */
  objects_below_target: {
    label: "Objects below target",
    hint: "Objects whose verdict is At risk or No-go.",
    unit: "object below target",
  },
  /** Source: records failing in this run that passed in the baseline run (compare DIFF `new`). */
  new_failing: {
    label: "New failing records",
    hint: "Records that fail in this run and passed in the baseline.",
    unit: "new failing record",
  },
  /** Source: records that failed in the baseline run and pass now (compare DIFF `resolved`). */
  recovered: {
    label: "Recovered records",
    hint: "Records that failed in the baseline and pass now.",
    unit: "recovered record",
  },
  /** Source: rules with failures now and none (or absent while the rule ran) in the baseline run. */
  newly_failing_rules: {
    label: "Newly failing rules",
    hint: "Rules that fail now and did not fail in the baseline.",
    unit: "newly failing rule",
  },
  /** Source: the reverse of newly failing rules: failed in the baseline, none now. */
  recovered_rules: {
    label: "Recovered rules",
    hint: "Rules that failed in the baseline and have no failures now.",
    unit: "recovered rule",
  },
};

export const COUNT_KEYS = Object.keys(COUNT_DEFS) as CountKey[];

/** Heading of the glossary section generated from `COUNT_DEFS`. */
export const COUNTS_GLOSSARY_HEADING = "Numbers on screen";

/**
 * The glossary.md section for these counts: a heading, a lead-in and one entry per key in `COUNT_DEFS` order. The
 * file is checked against this text by lib/__tests__/counts.test.ts (run with UPDATE_GLOSSARY=1 to rewrite it).
 */
export function countsGlossarySection(): string {
  const entries = COUNT_KEYS.map((k) => `### ${COUNT_DEFS[k].label}\n\n${COUNT_DEFS[k].hint}`);
  return [
    `## ${COUNTS_GLOSSARY_HEADING}`,
    "Every number Meridian shows has one name and one meaning, listed here in the order they appear in the product.",
    ...entries,
  ].join("\n\n");
}
