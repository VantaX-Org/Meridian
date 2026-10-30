import type { ModuleCoverage, Rule } from "@/lib/api/v2/rulelib";

/** One row of the rules library: a rule of the tenant, with what the list endpoint does not carry filled in when known. */
export interface LibRow {
  /** The row id of the rule (PATCH /rules/{id}). */
  id: string;
  /** The SAP-facing code before the colon of the name, such as MM142. */
  checkId: string;
  message: string;
  module: string;
  category: string;
  severity: string;
  enabled: boolean;
  source: Rule["source"];
  passRate: number | null;
  failing: number | null;
  suppressed: boolean;
  /** From GET /rules/coverage/{module}; null until that module has been read. */
  dimension: string | null;
  checkClass: string | null;
}

/** "MM142: Base unit not valid" is check id MM142 and message "Base unit not valid"; a name with no colon is all message. */
export function splitName(name: string): { checkId: string; message: string } {
  const at = name.indexOf(":");
  if (at <= 0) return { checkId: name.trim(), message: name.trim() };
  return { checkId: name.slice(0, at).trim(), message: name.slice(at + 1).trim() };
}

export function toRows(rules: readonly Rule[], suppressed: ReadonlySet<string>, coverage: ReadonlyMap<string, ModuleCoverage>): LibRow[] {
  const meta = new Map<string, { dimension: string | null; checkClass: string | null }>();
  for (const cov of coverage.values()) for (const v of cov.views) for (const r of v.rules) meta.set(`${cov.module}:${r.check_id}`, { dimension: r.dimension, checkClass: r.check_class });
  return rules.map((r) => {
    const { checkId, message } = splitName(r.name);
    const m = meta.get(`${r.module}:${checkId}`);
    return {
      id: r.id, checkId, message, module: r.module, category: r.category, severity: r.severity, enabled: r.enabled, source: r.source,
      passRate: r.last_pass_rate ?? null, failing: r.last_affected_count ?? null, suppressed: suppressed.has(checkId), dimension: m?.dimension ?? null, checkClass: m?.checkClass ?? null,
    };
  });
}

export type StateFilter = "" | "enabled" | "disabled" | "suppressed" | "custom";

export interface LibFilters {
  search: string;
  module: string;
  severity: string;
  dimension: string;
  checkClass: string;
  state: StateFilter;
}

export const NO_FILTERS: LibFilters = { search: "", module: "", severity: "", dimension: "", checkClass: "", state: "" };

export const activeFilterCount = (f: LibFilters): number => Object.values(f).filter(Boolean).length;

export function filterRows(rows: readonly LibRow[], f: LibFilters): LibRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !`${r.checkId} ${r.message} ${r.module}`.toLowerCase().includes(q)) return false;
    if (f.module && r.module !== f.module) return false;
    if (f.severity && r.severity !== f.severity) return false;
    if (f.dimension && r.dimension !== f.dimension) return false;
    if (f.checkClass && r.checkClass !== f.checkClass) return false;
    if (f.state === "enabled" && !r.enabled) return false;
    if (f.state === "disabled" && r.enabled) return false;
    if (f.state === "suppressed" && !r.suppressed) return false;
    if (f.state === "custom" && r.source === "yaml") return false;
    return true;
  });
}

const RANK = ["critical", "high", "medium", "low", "info"];
/** Worst severity first, then the most failing records, then the code. */
export function rankRows(rows: readonly LibRow[]): LibRow[] {
  return [...rows].sort((a, b) => RANK.indexOf(a.severity) - RANK.indexOf(b.severity) || (b.failing ?? -1) - (a.failing ?? -1) || a.checkId.localeCompare(b.checkId));
}
