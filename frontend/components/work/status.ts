import type { PillTone } from "@/design";
import type { WorkStatus, WorkSuggestion } from "@/lib/api/work";

/** The one work-status vocabulary every screen uses (api/services/worklist.py STATUSES). */
export const STATUS: Record<WorkStatus, { label: string; tone: PillTone; hint: string }> = {
  to_fix: { label: "To fix", tone: "at-risk", hint: "Nobody has decided a value yet" },
  proposed: { label: "Fix proposed", tone: "info", hint: "A value waits in a draft fix batch for a second person to approve" },
  approved: { label: "Approved", tone: "info", hint: "Approved, waiting to be exported for the SAP load" },
  sent: { label: "Sent to SAP", tone: "info", hint: "Exported for the SAP load; the next run confirms the fix" },
  not_an_issue: { label: "Not an issue", tone: "neutral", hint: "Signed off as an exception" },
  fixed: { label: "Fixed", tone: "go", hint: "A later run showed the record passing" },
};

export const STATUS_ORDER: WorkStatus[] = ["to_fix", "proposed", "approved", "sent", "not_an_issue", "fixed"];

export const SOURCE: Record<WorkSuggestion["source"], string> = {
  rule: "Rule fix, checked against the rule",
  value_map: "The rule's fix for this value",
  cleaning: "Cleaning engine",
};

/** "Overdue" / "Due today" / null for an SLA due date. */
export function dueLabel(due: string | null, now: number = Date.now()): { label: string; tone: PillTone } | null {
  if (!due) return null;
  const t = Date.parse(due);
  if (Number.isNaN(t)) return null;
  if (t < now) return { label: "Overdue", tone: "no-go" };
  if (t < now + 86_400_000) return { label: "Due today", tone: "at-risk" };
  return null;
}
