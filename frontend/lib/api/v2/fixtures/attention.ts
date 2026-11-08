/**
 * Action centre fixture: the ranked list api/services/attention.py builds for an admin on ECC production, with the
 * route's kind and system filters. Titles and details are the service's own English sentences.
 */
import type { AttentionItem } from "../attention";

export const NONE_ATTENTION = Symbol("not an attention path");

const ECC = { system_id: "sys-ecc-prd", system_name: "ECC production" };
const SF = { system_id: "sys-sf", system_name: "SuccessFactors" };

const ITEMS: AttentionItem[] = [
  { id: "approvals:-:-", kind: "approvals", tier: 1, severity: "critical", title: "14 fixes wait for your approval", detail: "The oldest has waited 3 days.", href: "/work?filter=approvals", action_label: "Review approvals", count: 14, object: null, system_id: null, system_name: null, module: null, since: "2026-10-28T08:00:00+00:00", required_action: "approve" },
  { id: "connection:sys-sf:-", kind: "connection", tier: 1, severity: "high", title: "SuccessFactors cannot be reached", detail: "The last health check failed: the OAuth token was refused.", href: "/s/sys-sf", action_label: "Open system", count: 1, object: null, ...SF, module: null, since: "2026-10-31T05:30:00+00:00", required_action: "manage_systems" },
  { id: "regression:sys-ecc-prd:material_master", kind: "regression", tier: 2, severity: "critical", title: "412 material records fail again", detail: "They passed at the previous run.", href: "/work?module=material_master&st=to_fix", action_label: "Review records", count: 412, object: "material_master", ...ECC, module: "material_master", since: "2026-10-30T02:10:00+00:00", required_action: "apply" },
  { id: "fitness_drop:sys-ecc-prd:-", kind: "fitness_drop", tier: 2, severity: "high", title: "Procure to pay fitness fell 6 points", detail: "Purchase orders now skip the release step more often.", href: "/process", action_label: "Open process", count: 1, object: null, ...ECC, module: null, since: "2026-10-29T02:10:00+00:00", required_action: "run_process_discovery" },
  { id: "stale_object:sys-ecc-prd:business_partner", kind: "stale_object", tier: 3, severity: "medium", title: "Business partner was last checked 9 days ago", detail: "Its schedule runs weekly.", href: "/o/sys-ecc-prd/business_partner/runs", action_label: "Re-check now", count: 1, object: "business_partner", ...ECC, module: "business_partner", since: "2026-10-22T02:10:00+00:00", required_action: "trigger_sync" },
  { id: "job_failed:-:-", kind: "job_failed", tier: 3, severity: "medium", title: "2 jobs failed today", detail: "The latest failed 40 minutes ago.", href: "/runs?view=jobs", action_label: "Open job", count: 2, object: null, system_id: null, system_name: null, module: null, since: "2026-10-31T07:20:00+00:00", required_action: "trigger_sync" },
  { id: "sla_breach:-:-", kind: "sla_breach", tier: 4, severity: "high", title: "6 stewardship items are overdue", detail: "They passed their due date. Assign or resolve them.", href: "/work?due=overdue", action_label: "Open overdue items", count: 6, object: null, system_id: null, system_name: null, module: null, since: "2026-10-26T17:00:00+00:00", required_action: "assign" },
  { id: "rule_review:-:-", kind: "rule_review", tier: 4, severity: "low", title: "5 rules wait for review", detail: "Drafts and learned rules need a decision before they run.", href: "/rules?view=drafts", action_label: "Review rules", count: 5, object: null, system_id: null, system_name: null, module: null, since: "2026-10-27T09:00:00+00:00", required_action: "review_ai_rules" },
  { id: "config_drift:sys-ecc-prd:-", kind: "config_drift", tier: 4, severity: "medium", title: "3 configuration settings changed", detail: "Compared with the previous run.", href: "/s/sys-ecc-prd?tab=changes", action_label: "Review changes", count: 3, object: null, ...ECC, module: null, since: "2026-10-30T02:10:00+00:00", required_action: "manage_systems" },
  { id: "invites_pending:-:-", kind: "invites_pending", tier: 5, severity: "low", title: "2 invitations are not accepted", detail: "Sent more than 7 days ago.", href: "/admin/users", action_label: "Review invitations", count: 2, object: null, system_id: null, system_name: null, module: null, since: "2026-10-20T10:00:00+00:00", required_action: "manage_users" },
];

export function attentionRead(path: string, params: Record<string, unknown>): unknown {
  if (path !== "/attention") return NONE_ATTENTION;
  const kinds = params.kinds ? new Set(String(params.kinds).split(",")) : null;
  const items = ITEMS.filter((i) => (!kinds || kinds.has(i.kind)) && (!params.system_id || i.system_id === params.system_id));
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of items) counts[i.severity as keyof typeof counts] += 1;
  return { items: items.slice(0, Number(params.limit ?? 50)), generated_at: "2026-10-31T08:00:00+00:00", counts };
}
