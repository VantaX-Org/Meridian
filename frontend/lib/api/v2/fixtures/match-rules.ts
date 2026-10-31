/**
 * Match rules fixture: the tenant's match rules for business partners, materials and customers, shaped like
 * api/routes/match_rules.py. Writes change the list for the session. A simulation answers a fixed split of the
 * pending pairs per object, and nothing for an object without an active rule, as the route does.
 */
import type { MatchRule, MatchRuleInput, MatchSimulation } from "../match-rules";

export const NONE_MATCH = Symbol("not a match rules path");

const TENANT = "komatsu";
const refuse = (status: number, detail: string): never => {
  throw Object.assign(new Error(detail), { status, response: { status, data: { detail } } });
};

// domain, field, type, weight, threshold, active
const SEED: [string, string, MatchRule["match_type"], number, number, boolean][] = [
  ["business_partner", "NAME_ORG1", "fuzzy", 40, 0.85, true],
  ["business_partner", "TAXNUM", "exact", 30, 1, true],
  ["business_partner", "STREET", "fuzzy", 15, 0.8, true],
  ["business_partner", "CITY1", "phonetic", 10, 0.9, true],
  ["business_partner", "TEL_NUMBER", "exact", 5, 1, false],
  ["material_master", "MAKTX", "semantic", 50, 0.88, true],
  ["material_master", "MFRPN", "exact", 30, 1, true],
  ["material_master", "BRGEW", "numeric_range", 20, 0.95, true],
  ["sd_customer_master", "NAME1", "fuzzy", 60, 0.85, true],
  ["sd_customer_master", "STCD1", "exact", 40, 1, true],
];

let rules: MatchRule[] | null = null;
let next = 0;
const list = (): MatchRule[] =>
  (rules ??= SEED.map(([domain, field, match_type, weight, threshold, active], i) => ({ id: `mr-${i + 1}`, tenant_id: TENANT, domain, field, match_type, weight, threshold, active })));

const SPLIT: Record<string, MatchSimulation> = {
  business_partner: { total_pairs: 100, auto_merge_count: 12, auto_dismiss_count: 41, queue_count: 47 },
  material_master: { total_pairs: 100, auto_merge_count: 23, auto_dismiss_count: 30, queue_count: 47 },
  sd_customer_master: { total_pairs: 38, auto_merge_count: 6, auto_dismiss_count: 19, queue_count: 13 },
};

const sorted = () => [...list()].sort((a, b) => a.domain.localeCompare(b.domain) || b.weight - a.weight);

export function matchRead(path: string): unknown {
  if (path !== "/match-rules") return NONE_MATCH;
  const all = sorted();
  return { rules: all, total: all.length };
}

export function matchWrite(method: string, path: string, body: unknown): unknown {
  if (!path.startsWith("/match-rules")) return NONE_MATCH;
  const b = (body ?? {}) as Partial<MatchRuleInput> & { domain?: string };
  if (method === "POST" && path === "/match-rules/simulate") {
    const live = list().some((r) => r.domain === b.domain && r.active);
    return live ? SPLIT[b.domain ?? ""] ?? { total_pairs: 0, auto_merge_count: 0, auto_dismiss_count: 0, queue_count: 0 } : { total_pairs: 0, auto_merge_count: 0, auto_dismiss_count: 0, queue_count: 0 };
  }
  if (method === "POST" && path === "/match-rules") {
    const r: MatchRule = { id: `mr-new-${++next}`, tenant_id: TENANT, domain: b.domain ?? "", field: b.field ?? "", match_type: b.match_type ?? "exact", weight: b.weight ?? 50, threshold: b.threshold ?? 0.8, active: b.active ?? true };
    list().push(r);
    return r;
  }
  const id = decodeURIComponent(path.slice("/match-rules/".length));
  const at = list().findIndex((r) => r.id === id);
  if (method === "PUT") {
    if (at < 0) refuse(404, "Match rule not found");
    if (!Object.keys(b).length) refuse(400, "No fields to update");
    rules![at] = { ...rules![at], ...b };
    return rules![at];
  }
  if (method === "DELETE") {
    if (at < 0) refuse(404, "Match rule not found");
    rules!.splice(at, 1);
    return { deleted: true };
  }
  return NONE_MATCH;
}
