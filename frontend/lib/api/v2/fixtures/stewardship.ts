/**
 * Stewardship queue fixture (api/routes/stewardship.py): one in-memory queue that the list, the metrics and the
 * assign, resolve, escalate and bulk-approve writes share, so a write shows in the next read.
 */
import type { StewardItem } from "../stewardship";

export const NONE_STEWARD = Symbol("not a stewardship path");

const H = 3_600_000;
const ago = (h: number) => new Date(Date.now() - h * H).toISOString();

// id, type, domain, priority, assigned, status, sla hours, created hours ago, AI recommendation, confidence, check, module, title
const ROWS: [string, string, string, number, string | null, string, number, number, string | null, number | null, string, string, string][] = [
  ["sq-01", "finding", "material_master", 1, "u-an", "open", 24, 30, "approve", 0.94, "MM022", "material_master", "Material group is blank"],
  ["sq-02", "finding", "material_master", 2, null, "open", 48, 6, "approve", 0.91, "MM031", "material_master", "Base unit of measure is blank"],
  ["sq-03", "duplicate", "customer_master", 2, "u-tm", "in_progress", 72, 20, "merge", 0.88, "CM-DUP-01", "customer_master", "Possible duplicate customers on name and VAT number"],
  ["sq-04", "finding", "customer_master", 1, null, "open", 24, 40, "approve", 0.72, "CM-PAY-TERMS", "customer_master", "Payment terms are blank"],
  ["sq-05", "contract_breach", "successfactors", 3, "u-pk", "escalated", 48, 80, null, null, "SF-EMP-05", "successfactors", "Hire date after termination date"],
  ["sq-06", "finding", "successfactors", 2, null, "open", 48, 10, "reject", 0.66, "SF-POS-02", "successfactors", "Position has no cost centre"],
  ["sq-07", "golden_record", "material_master", 3, "u-me", "in_progress", 96, 50, "approve", 0.97, "MM-GR-01", "material_master", "Golden record survivorship conflict on plant view"],
  ["sq-08", "finding", "material_master", 1, null, "open", 24, 2, "approve", 0.86, "MM045", "material_master", "Valuation class missing for valuated material type"],
  ["sq-09", "finding", "customer_master", 2, "u-an", "resolved", 48, 100, "approve", 0.9, "CM-CO-CODE", "customer_master", "Company code is inactive"],
  ["sq-10", "duplicate", "material_master", 3, null, "rejected", 72, 120, "merge", 0.55, "MM-DUP-03", "material_master", "Possible duplicate materials on description"],
];

let items: StewardItem[] | null = null;

function state(): StewardItem[] {
  items ??= ROWS.map(([id, item_type, domain, priority, assigned_to, status, sla_hours, h, ai_recommendation, ai_confidence, check, module, title]) => {
    const due = Date.now() - h * H + sla_hours * H;
    const open = ["open", "in_progress", "escalated"].includes(status);
    return {
      id, tenant_id: "t-demo", item_type, source_id: `src-${id}`, domain, priority, due_at: new Date(due).toISOString(), assigned_to, status, sla_hours,
      created_at: ago(h), updated_at: ago(Math.max(0, h - 1)), ai_recommendation, ai_confidence,
      sla_state: !open ? null : due < Date.now() ? "breached" : due - Date.now() < 6 * H ? "at_risk" : "on_track",
      source_title: title, source_check_id: check, source_module: module,
    };
  });
  return items;
}

export function resetStewardFixture() { items = null; }

const OPEN = ["open", "in_progress", "escalated"];

function metrics() {
  const all = state();
  const count = (key: (i: StewardItem) => string) => all.reduce<Record<string, number>>((m, i) => ({ ...m, [key(i)]: (m[key(i)] ?? 0) + 1 }), {});
  const open = all.filter((i) => OPEN.includes(i.status));
  const overdue = open.filter((i) => i.due_at && Date.parse(i.due_at) < Date.now()).length;
  const done = all.filter((i) => !OPEN.includes(i.status));
  const onTime = done.filter((i) => !i.due_at || Date.parse(i.updated_at) <= Date.parse(i.due_at)).length;
  return {
    items_by_type: count((i) => i.item_type),
    items_by_status: count((i) => i.status),
    avg_resolution_hours_by_type: { finding: 18.5, duplicate: 30.2 },
    backlog_total: open.length,
    overdue_count: overdue,
    sla_compliance_rate: done.length ? Math.round((onTime / done.length) * 1000) / 10 : 100,
    ai_acceptance_rate: 82.4,
    steward_breakdown: Object.entries(all.reduce<Record<string, StewardItem[]>>((m, i) => (i.assigned_to ? { ...m, [i.assigned_to]: [...(m[i.assigned_to] ?? []), i] } : m), {})).map(([user_id, items]) => ({
      user_id,
      name: user_id,
      open: items.filter((i) => OPEN.includes(i.status)).length,
      resolved: items.filter((i) => !OPEN.includes(i.status)).length,
      overdue: items.filter((i) => OPEN.includes(i.status) && i.due_at && Date.parse(i.due_at) < Date.now()).length,
    })),
  };
}

export function stewardRead(path: string, params: Record<string, unknown> = {}): unknown {
  if (path === "/stewardship/metrics") return metrics();
  if (path !== "/stewardship") return NONE_STEWARD;
  const status = String(params.status ?? "open");
  const rows = state().filter((i) => (status === "all" || i.status === status)
    && (!params.item_type || i.item_type === params.item_type)
    && (!params.domain || i.domain === params.domain)
    && (!params.assigned_to || i.assigned_to === params.assigned_to));
  const offset = Number(params.offset ?? 0);
  const limit = Number(params.limit ?? 50);
  return { items: rows.slice(offset, offset + limit), total: rows.length };
}

export function stewardWrite(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  if (method === "POST" && path === "/stewardship/bulk-approve") {
    const min = Number(b.min_confidence ?? 0.85);
    const hit = state().filter((i) => (b.item_ids as string[]).includes(i.id) && OPEN.includes(i.status) && (i.ai_confidence ?? 0) >= min);
    for (const i of hit) Object.assign(i, { status: "resolved", sla_state: null, updated_at: new Date().toISOString() });
    return { approved: hit.length, history_rows_created: hit.length };
  }
  const m = /^\/stewardship\/([^/]+)\/(assign|resolve|escalate)$/.exec(path);
  if (method !== "PUT" || !m) return NONE_STEWARD;
  const item = state().find((i) => i.id === decodeURIComponent(m[1]));
  if (!item) return NONE_STEWARD;
  const now = new Date().toISOString();
  if (m[2] === "assign") {
    Object.assign(item, { assigned_to: (b.user_id as string | null) ?? null, status: b.user_id ? "in_progress" : "open", updated_at: now });
    return { id: item.id, status: item.status, assigned_to: item.assigned_to };
  }
  if (m[2] === "escalate") {
    Object.assign(item, { status: "escalated", updated_at: now });
    return { id: item.id, status: item.status };
  }
  Object.assign(item, { status: b.action === "reject" ? "rejected" : "resolved", sla_state: null, updated_at: now });
  return { id: item.id, status: item.status, action: b.action };
}
