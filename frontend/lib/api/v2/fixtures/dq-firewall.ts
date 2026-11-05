/**
 * Fixture answers for the DQ firewall (`?fixture=1`): /dq-firewall/summary (GET) and /dq-firewall/validate (POST).
 * The fixture judges only Material master and only three rules, the real ones of checks/rules/ecc/material_master.yaml
 * (MM001, MM003, MM008, each critical and completeness: a blank material number, type or base unit).
 */
import type { DuplicateMatch, FirewallDay, FirewallFailure, FirewallSummary, FirewallVerdict, GateRequest } from "../dq-firewall";

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

// Requests the gate opened in this session, newest first, keyed by candidate content (the real key is an HMAC of it).
const SEED: GateRequest[] = [
  { id: "00000000-0000-4000-8000-000000000a01", object: "material", title: "Entry gate: new material, 2 rule failure(s)", status: "in_approval", created_at: "2026-10-19T09:12:00Z" },
];
let opened: { key: string; req: GateRequest }[] = [];

export function resetDqFirewallFixture(): void {
  calls = 3;
  opened = [];
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
    requests: [...opened.map((o) => o.req), ...SEED],
    holds: {
      held: 1 + opened.filter((o) => o.req.status === "in_approval").length,
      released: 6,
      rejected: 2,
      written: 4,
      oldest_held_hours: 31.5,
      median_decision_hours: 5.2,
      latest: [...opened.map((o) => o.req), ...SEED],
    },
    by_module: [
      { module: "material_master", checked: 168, blocked: 27, warned: 31, passed: 110 },
      { module: "sd_customer_master", checked: 58, blocked: 9, warned: 12, passed: 37 },
      { module: "employee_central", checked: 23, blocked: 3, warned: null, passed: null },
    ],
  };
  return out;
}

const THRESHOLDS = { auto_merge: 0.95, review_floor: 0.3 };
const norm = (v: unknown) => String(v ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();

/**
 * Duplicate search answers, by manufacturer part number (MARA.MFRPN, normalised): XQ7731ZK is a duplicate of record
 * 100042 and 100077 (a lesser one); TYPO1 finds record 100090 by the typo-tolerant pass; XQ7731ZL is one character off XQ7731ZK and finds record 100042 by near value; SHORT1 did not run it; BULK1 hits the candidate cap; NOPOP says nothing was searched. Synthetic keys only.
 */
function addDuplicates(out: FirewallVerdict, records: Record<string, unknown>[]): void {
  if (records.some((r) => norm(r["MARA.MFRPN"]) === "NOPOP")) {
    out.duplicate_search = { searched: false, reason: "no_population", cap: 50, thresholds: THRESHOLDS };
    return;
  }
  out.duplicate_search = { searched: true, reason: null, cap: 50, thresholds: THRESHOLDS, rules: 3, skipped_semantic: 0, fuzzy: { available: true, reason: null, min_key_length: 6, similarity: 0.5 }, near: { available: true, reason: null, min_key_length: 5, max_key_length: 40 } };
  out.records.forEach((rec, i) => {
    const part = norm(records[i]?.["MARA.MFRPN"]);
    const matches: DuplicateMatch[] = part === "XQ7731ZK"
      ? [
          { key: "100042", found_by: "exact", score: 0.97, band: "auto_merge", threshold: 0.95, fields: [
            { field: "MARA.MFRPN", comparator: "part_number", similarity: 1, weight: 60, threshold: 0.9, met: true },
            { field: "MAKT.MAKTX", comparator: "desc_tokens", similarity: 0.92, weight: 40, threshold: 0.6, met: true },
          ] },
          { key: "100077", found_by: "exact", score: 0.62, band: "steward_review", threshold: 0.95, fields: [
            { field: "MARA.MFRPN", comparator: "part_number", similarity: 1, weight: 60, threshold: 0.9, met: true },
            { field: "MAKT.MAKTX", comparator: "desc_tokens", similarity: 0.05, weight: 40, threshold: 0.6, met: false },
          ] },
        ]
      : part === "TYPO1"
        ? [{ key: "100090", found_by: "similar", score: 0.71, band: "steward_review", threshold: 0.95, fields: [
            { field: "MAKT.MAKTX", comparator: "desc_tokens", similarity: 0.71, weight: 40, threshold: 0.6, met: true },
          ] }]
        : part === "XQ7731ZL"
          ? [{ key: "100042", found_by: "near", found_field: "MARA.MFRPN", score: 0.4, band: "steward_review", threshold: 0.95, fields: [
              { field: "MARA.MFRPN", comparator: "part_number", similarity: 0, weight: 60, threshold: 0.9, met: false },
              { field: "MAKT.MAKTX", comparator: "desc_tokens", similarity: 1, weight: 40, threshold: 0.6, met: true },
            ] }]
          : [];
    rec.duplicates = {
      verdict: matches.some((m) => m.score >= m.threshold || m.found_by === "near") ? "warn" : "pass",
      searched: part !== "",
      scored: part === "BULK1" ? 50 : matches.length,
      truncated: part === "BULK1",
      matches,
      fuzzy: part === "SHORT1" ? { ran: false, reason: "key_too_short" } : { ran: true, reason: null },
      near: part === "SHORT1" ? { ran: false, reason: "key_length" } : { ran: true, reason: null },
    };
  });
}

/** A flagged record opens one request; the same content again returns it. A clean pass opens nothing. */
function routeToSteward(out: FirewallVerdict, records: Record<string, unknown>[]): void {
  out.records.forEach((rec, i) => {
    if (!rec.failures.length && rec.duplicates?.verdict !== "warn") return;
    const key = JSON.stringify(records[i], Object.keys(records[i] ?? {}).sort());
    const found = opened.find((o) => o.key === key);
    if (found) {
      rec.steward_request = { request_id: found.req.id, status: found.req.status, existing: true };
      return;
    }
    const req: GateRequest = {
      id: `00000000-0000-4000-8000-${String(opened.length + 1).padStart(12, "0")}`,
      object: "material",
      title: `Entry gate: new material, ${rec.failures.length} rule failure(s)`,
      status: "in_approval",
      created_at: "2026-10-20T07:50:00Z",
    };
    opened = [{ key, req }, ...opened];
    rec.steward_request = { request_id: req.id, status: req.status, existing: false };
  });
}

/**
 * Hold answers. Content seen before returns its request. A record with ENTRY-APPROVED as its material number counts as
 * approved and released; ENTRY-REJECTED as rejected; ENTRY-WRITTEN as written with a synthetic SAP key.
 */
function applyHold(out: FirewallVerdict, mode: "blocked" | "flagged", records: Record<string, unknown>[]): void {
  out.records.forEach((rec, i) => {
    const warned = rec.verdict === "pass" && (rec.failures.length > 0 || rec.duplicates?.verdict === "warn");
    if (!(rec.verdict === "block" || (mode === "flagged" && warned))) return;
    const sr = rec.steward_request;
    const matnr = String(records[i]?.["MARA.MATNR"] ?? "");
    if (matnr === "ENTRY-APPROVED") rec.hold = { state: "released", request_id: sr?.request_id ?? null };
    else if (matnr === "ENTRY-REJECTED") rec.hold = { state: "rejected", request_id: sr?.request_id ?? null };
    else if (matnr === "ENTRY-WRITTEN") rec.hold = { state: "written", request_id: sr?.request_id ?? null, sap_key: "4711" };
    else rec.hold = sr?.request_id ? { state: "held", request_id: sr.request_id } : { state: "not_held", request_id: null, reason: sr?.reason ?? "not_opened" };
  });
  const stops = (r: FirewallVerdict["records"][number]) => (r.hold ? r.hold.state !== "released" && (r.hold.state !== "not_held" || r.verdict === "block") : r.verdict === "block");
  out.save = out.records.some(stops) ? "stop" : "go";
}

export function dqFirewallWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || path !== "/dq-firewall/validate") return NONE_DQ_FIREWALL;
  const b = (body ?? {}) as { module?: string; records?: Record<string, unknown>[]; suggest?: boolean; duplicates?: boolean; route_to_steward?: boolean; hold?: "off" | "blocked" | "flagged" };
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
  if (b.duplicates) addDuplicates(out, records);
  if (b.route_to_steward || (b.hold && b.hold !== "off")) routeToSteward(out, records);
  if (b.hold && b.hold !== "off") applyHold(out, b.hold, records);
  return out;
}
