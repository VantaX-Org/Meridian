/**
 * Exceptions fixture: process and SAP transaction exceptions for ECC production, shaped like api/routes/exceptions.py.
 * Assign, escalate, resolve, comment and the rule switch change the rows in memory the way the route does.
 */
import type { ExceptionDetail, ExceptionRow, ExceptionRule } from "../exceptions";

export const NONE_EXCEPTIONS = Symbol("not an exceptions path");

const SLA_HOURS: Record<string, number> = { critical: 8, high: 24, medium: 72, low: 168 };
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const ahead = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

// type, category, severity, status, title, description, source reference, impact in ZAR, assignee, tier, hours since raised, hours to the SLA
const ROWS: [string, string, string, string, string, string, string | null, number | null, string | null, number, number, number][] = [
  ["sap_transaction", "posting_error", "critical", "open", "Goods receipt posted to a blocked material", "MIGO posting 5000412233 moved stock for material 10004711, which is blocked for procurement.", "MIGO 5000412233", 184_000, null, 1, 3, -1],
  ["sap_transaction", "duplicate_invoice", "high", "investigating", "Vendor invoice entered twice", "Invoice 9300218 from vendor 1000412 matches invoice 9300197 on amount, date and reference.", "MIRO 5105600881", 92_500, "u-an", 1, 6, 18],
  ["custom_business", "pricing", "high", "pending_approval", "Sales price below cost on 14 orders", "Order lines for spare parts carry a net price below the moving average price.", null, 41_200, "u-tm", 2, 20, 4],
  ["sap_transaction", "master_data", "medium", "open", "Purchase order raised on a vendor with no bank details", "PO 4500098812 for vendor 1000377 cannot be paid until the vendor has an IBAN.", "ME21N 4500098812", null, null, 1, 10, 62],
  ["custom_business", "process_gap", "medium", "investigating", "Three-way match skipped on service orders", "Service entry sheets are released without a goods receipt for 9 service orders.", null, 12_800, "u-me", 1, 30, 42],
  ["custom_business", "master_data", "low", "resolved", "Material created without a plant view", "Material 10009977 has no MARC record for plant 1100.", null, null, "u-an", 1, 90, 78],
  ["sap_transaction", "posting_error", "critical", "closed", "Cost centre posting to a locked cost centre", "Posting 100000218 hit cost centre 4100 after it was locked for the period.", "FB50 100000218", 7_400, "u-tm", 3, 140, 0],
];

let rows: ExceptionDetail[] | null = null;
let rules: ExceptionRule[] | null = null;

function state(): ExceptionDetail[] {
  if (rows) return rows;
  rows = ROWS.map(([type, category, severity, status, title, description, ref, zar, who, tier, raised, due], i) => ({
    id: `exc-${i + 1}`, type, category, severity, status, title, description,
    source_system: type === "sap_transaction" ? "ECC PRD 100" : null, source_reference: ref, affected_records: null,
    estimated_impact_zar: zar, assigned_to: who, escalation_tier: tier, sla_deadline: ahead(due),
    root_cause_category: status === "resolved" || status === "closed" ? "Missing master data" : null,
    resolution_type: status === "resolved" || status === "closed" ? "steward" : null,
    resolution_notes: status === "resolved" || status === "closed" ? "Plant view created and the posting reversed." : null,
    linked_finding_id: i === 0 ? "f-mm142" : null, created_at: ago(raised), resolved_at: status === "resolved" || status === "closed" ? ago(2) : null,
    comments: who ? [{ id: `c-${i}`, user_name: "A. Naidoo", text: "Looking into it with the plant controller.", created_at: ago(raised - 1) }] : [],
    linked_finding: i === 0 ? { id: "f-mm142", module: "material_master", check_id: "MM142", severity: "critical", dimension: "completeness", pass_rate: 97.4 } : null,
  }));
  return rows;
}

function ruleState(): ExceptionRule[] {
  rules ??= [
    { id: "xr-1", name: "Posting to a blocked material", description: "Raise when stock moves for a material blocked for procurement.", rule_type: "sap_transaction", object_type: "material_master", condition: "MARC.MMSTA in ('01','02')", severity: "critical", auto_assign_to: null, is_active: true },
    { id: "xr-2", name: "Duplicate vendor invoice", description: "Raise when two invoices from one vendor share amount, date and reference.", rule_type: "sap_transaction", object_type: "accounts_payable", condition: "same LIFNR, WRBTR, BLDAT, XBLNR", severity: "high", auto_assign_to: null, is_active: true },
    { id: "xr-3", name: "Price below cost", description: "Raise when a sales order line is priced below the moving average price.", rule_type: "custom_business", object_type: "sd_sales_orders", condition: "VBAP.NETPR < MBEW.VERPR", severity: "high", auto_assign_to: null, is_active: false },
  ];
  return rules;
}

export const resetExceptionsFixture = (): void => { rows = null; rules = null; };

const plain = (x: ExceptionDetail): ExceptionRow => { const r: Partial<ExceptionDetail> = { ...x }; delete r.comments; delete r.linked_finding; return r as ExceptionRow; };
const open = (s: string) => s === "open" || s === "investigating" || s === "pending_approval";

function refuse(detail: string, code = 400): never {
  throw Object.assign(new Error(detail), { status: code, response: { status: code, data: { detail } } });
}

const note = (x: ExceptionDetail, text: string, user_name = "system") =>
  x.comments.push({ id: `c-${x.comments.length + 9}`, user_name, text, created_at: new Date().toISOString() });

const find = (id: string) => state().find((x) => x.id === decodeURIComponent(id)) ?? refuse("Exception not found", 404);

export function exceptionsRead(path: string, params: Record<string, unknown>): unknown {
  if (path === "/exceptions") {
    const hit = state().filter((x) => (!params.status || x.status === params.status) && (!params.severity || x.severity === params.severity) && (!params.type || x.type === params.type));
    const page = Number(params.page ?? 1), per = Number(params.per_page ?? 25);
    const sorted = [...hit].sort((a, b) => String(a.sla_deadline).localeCompare(String(b.sla_deadline)));
    return { exceptions: sorted.slice((page - 1) * per, page * per).map(plain), total: hit.length, page, per_page: per };
  }
  if (path === "/exceptions/metrics") {
    const all = state();
    const count = (k: "type" | "severity") => all.filter((x) => open(x.status)).reduce<Record<string, number>>((m, x) => ({ ...m, [x[k]]: (m[x[k]] ?? 0) + 1 }), {});
    return {
      open_count: all.filter((x) => open(x.status)).length, resolved_count: all.filter((x) => !open(x.status)).length,
      avg_resolution_hours: 31.5, sla_compliance_pct: 66.7,
      overdue_count: all.filter((x) => open(x.status) && String(x.sla_deadline) < new Date().toISOString()).length,
      by_type: count("type"), by_severity: count("severity"),
    };
  }
  if (path === "/exceptions/sap-monitor") {
    const hit = state().filter((x) => x.type === "sap_transaction" && String(x.created_at) > ago(24)).map(plain);
    return { exceptions: hit, by_category: hit.reduce<Record<string, ExceptionRow[]>>((m, x) => ({ ...m, [x.category ?? "other"]: [...(m[x.category ?? "other"] ?? []), x] }), {}) };
  }
  if (path === "/exceptions/rules") return { rules: ruleState() };
  const one = /^\/exceptions\/(exc-[^/]+)$/.exec(path);
  if (one) return find(one[1]);
  return NONE_EXCEPTIONS;
}

export function exceptionsWrite(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  const rule = /^\/exceptions\/rules\/([^/]+)$/.exec(path);
  if (method === "PUT" && rule) {
    const r = ruleState().find((x) => x.id === rule[1]) ?? refuse("Rule not found", 404);
    if (typeof b.is_active === "boolean") r.is_active = b.is_active;
    return r;
  }
  const m = /^\/exceptions\/([^/]+)\/(assign|escalate|resolve|comment)$/.exec(path);
  if (!m) return NONE_EXCEPTIONS;
  const x = find(m[1]);
  if (m[2] === "assign") {
    x.assigned_to = String(b.user_id);
    if (x.status === "open") x.status = "investigating";
    note(x, `Assigned to ${String(b.user_name ?? "Unknown")}`);
    return { id: x.id, assigned_to: x.assigned_to };
  }
  if (m[2] === "escalate") {
    // As the route: one tier up to 4, and the SLA halves with each tier.
    x.escalation_tier = Math.min((x.escalation_tier ?? 1) + 1, 4);
    x.sla_deadline = ahead(Math.max(1, Math.floor((SLA_HOURS[x.severity] ?? 72) / 2 ** (x.escalation_tier - 1))));
    note(x, `Escalated to tier ${x.escalation_tier}: ${String(b.reason ?? "")}`);
    return { escalation_tier: x.escalation_tier, sla_deadline: x.sla_deadline };
  }
  if (m[2] === "resolve") {
    Object.assign(x, { status: "resolved", resolution_type: b.resolution_type, resolution_notes: b.resolution_notes, root_cause_category: b.root_cause_category, resolved_at: new Date().toISOString() });
    return { id: x.id, status: x.status };
  }
  note(x, String(b.text ?? ""), String(b.user_name ?? "system"));
  return { comments: x.comments };
}
