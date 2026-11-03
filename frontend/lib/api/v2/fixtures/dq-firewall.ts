/**
 * Fixture answers for the DQ firewall (`?fixture=1`): /dq-firewall/summary (GET) and /dq-firewall/validate (POST).
 * The fixture judges only Material master and only three rules, the real ones of checks/rules/ecc/material_master.yaml
 * (MM001, MM003, MM008, each critical and completeness: a blank material number, type or base unit).
 */
import type { FirewallFailure, FirewallSummary, FirewallVerdict } from "../dq-firewall";

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
  };
  return out;
}

export function dqFirewallWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || path !== "/dq-firewall/validate") return NONE_DQ_FIREWALL;
  const b = (body ?? {}) as { module?: string; records?: Record<string, unknown>[] };
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
      }));
      return { index, verdict: failures.length ? "block" : "pass", failures };
    }),
  };
  if (out.records.some((r) => r.verdict === "block")) out.verdict = "block";
  return out;
}
