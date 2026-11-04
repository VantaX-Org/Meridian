/**
 * Fixture answers for the DQ firewall (`?fixture=1`): /dq-firewall/summary (GET) and /dq-firewall/validate (POST).
 * The fixture judges only Material master and only three rules, the real ones of checks/rules/ecc/material_master.yaml
 * (MM001, MM003, MM008, each critical and completeness: a blank material number, type or base unit).
 */
import type { FirewallDay, FirewallFailure, FirewallSummary, FirewallVerdict } from "../dq-firewall";

export const NONE_DQ_FIREWALL = Symbol("no-dq-firewall-fixture");

class Refused extends Error {
  response: { status: number; data: { detail: string } };
  constructor(status: number, detail: string) {
    super(detail);
    this.response = { status, data: { detail } };
  }
}

const RULES: { id: string; field: string; message: string }[] = [
  { id: "MM001", field: "MARA.MATNR", message: "Material number is mandatory - primary key for all material transactions" },
  { id: "MM003", field: "MARA.MTART", message: "Material type is mandatory - determines procurement and storage behaviour" },
  { id: "MM008", field: "MARA.MEINS", message: "Base unit of measure is mandatory for all materials" },
];

// Seven days to 2026-10-20. The earliest days predate the warned count, so warned and passed are null there.
const DAYS: FirewallDay[] = [
  { day: "2026-10-14", checked: 22, blocked: 3, warned: null, passed: null },
  { day: "2026-10-15", checked: 31, blocked: 4, warned: null, passed: null },
  { day: "2026-10-16", checked: 38, blocked: 6, warned: 7, passed: 25 },
  { day: "2026-10-17", checked: 12, blocked: 1, warned: 3, passed: 8 },
  { day: "2026-10-18", checked: 0, blocked: 0, warned: 0, passed: 0 },
  { day: "2026-10-19", checked: 66, blocked: 11, warned: 14, passed: 41 },
  { day: "2026-10-20", checked: 80, blocked: 14, warned: 19, passed: 47 },
];

let calls = 3;

export function resetDqFirewallFixture(): void {
  calls = 3;
}

export function dqFirewallRead(path: string): unknown {
  if (path !== "/dq-firewall/summary") return NONE_DQ_FIREWALL;
  const out: FirewallSummary = {
    modules: ["employee_central", "material_master", "sd_customer_master"],
    max_records: 100,
    block_severity: "critical",
    calls_24h: calls,
    calls_7d: calls + 11,
    last_call_at: "2026-10-20T07:42:00Z",
    days: DAYS,
    top_rules: RULES.map((r, i) => ({ rule_id: r.id, description: r.message, blocked: [14, 9, 4][i] })),
    by_module: [
      { module: "material_master", checked: 168, blocked: 27, warned: 31, passed: 110 },
      { module: "sd_customer_master", checked: 58, blocked: 9, warned: 12, passed: 37 },
      { module: "employee_central", checked: 23, blocked: 3, warned: null, passed: null },
    ],
  };
  return out;
}

export function dqFirewallWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || path !== "/dq-firewall/validate") return NONE_DQ_FIREWALL;
  const b = (body ?? {}) as { module?: string; records?: Record<string, unknown>[]; suggest?: boolean };
  if (b.module !== "material_master") throw new Refused(422, `Unknown module '${String(b.module ?? "").slice(0, 60)}'.`);
  const records = b.records ?? [];
  if (records.length < 1 || records.length > 100) throw new Refused(422, "Send 1 to 100 records.");
  calls += 1;
  const out: FirewallVerdict = {
    verdict: "pass",
    block_severity: "critical",
    module: "material_master",
    rules_run: RULES.length,
    records: records.map((r, index) => {
      const failures: FirewallFailure[] = RULES.filter((x) => String(r[x.field] ?? "").trim() === "").map((x) => ({
        rule_id: x.id,
        description: x.message,
        field: x.field,
        severity: "critical",
        dimension: "completeness",
        reason: `${x.field} is blank.`,
        // Only the material type has a grounded suggestion in the fixture: the values its rule accepts.
        ...(b.suggest && x.id === "MM003"
          ? { suggestion: { kind: "allowed_values" as const, field: x.field, rule_id: x.id, source: "rule MM003 allowed values", verified: true, allowed_values: [{ code: "ROH", text: "Raw materials" }, { code: "FERT", text: "Finished product" }, { code: "HALB", text: "Semifinished product" }], truncated: false } }
          : {}),
      }));
      return { index, verdict: failures.length ? "block" : "pass", failures };
    }),
  };
  if (out.records.some((r) => r.verdict === "block")) out.verdict = "block";
  return out;
}
