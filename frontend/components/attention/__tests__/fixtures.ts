import type { AttentionItem, AttentionList } from "@/lib/api/attention";

/** One to-do item with sensible defaults; override what the test is about. */
export const item = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  id: "connection:s1",
  kind: "connection",
  tier: 1,
  severity: "critical",
  title: "KSA PRD cannot be reached",
  detail: "The last health check failed with a connection refused",
  href: "/systems/s1",
  action_label: "Open system",
  count: 1,
  object: null,
  system_id: "s1",
  system_name: "KSA PRD",
  module: null,
  since: new Date(Date.now() - 2 * 3600_000).toISOString(),
  required_action: "manage_systems",
  ...over,
});

export const SAMPLE: AttentionItem[] = [
  item(),
  item({ id: "regression:s1:material_master", kind: "regression", tier: 2, severity: "high", title: "4 rules regressed on Material master", detail: "2,310 records newly fail", href: "/fix?module=material_master&st=to_fix", action_label: "Review", count: 4, module: "material_master", object: "Material master" }),
  item({ id: "stale:s1:fi_gl", kind: "stale_object", tier: 3, severity: "high", title: "FI general ledger has not been checked on schedule", detail: "Last run 3 days ago", href: "/objects/fi_gl#monitor", action_label: "Re-check", module: "fi_gl", object: "FI general ledger" }),
  item({ id: "approvals:mm", kind: "approvals", tier: 1, severity: "high", title: "2 fix batches wait for your approval", detail: "Requested by another person", href: "/inbox?kind=approvals", action_label: "Approve", count: 2, system_id: null, system_name: null, module: "material_master", object: "Material master" }),
  item({ id: "overdue:mm", kind: "overdue_records", tier: 4, severity: "medium", title: "310 records are overdue", detail: "Past their due date", href: "/fix?due=overdue", action_label: "Open", count: 310, module: "material_master", object: "Material master" }),
  item({ id: "rules:review", kind: "rule_review", tier: 4, severity: "low", title: "3 proposed rules wait for review", detail: "Written from corrections", href: "/rules/drafts?tab=ai", action_label: "Review", count: 3, system_id: null, system_name: null, module: null }),
];

export const listOf = (items: AttentionItem[]): AttentionList => ({
  items,
  generated_at: "2026-10-28T14:32:00Z",
  counts: {
    critical: items.filter((i) => i.severity === "critical").length,
    high: items.filter((i) => i.severity === "high").length,
    medium: items.filter((i) => i.severity === "medium").length,
    low: items.filter((i) => i.severity === "low").length,
  },
});
