/**
 * Data mining fixture: the duplicates, outliers and relationships the mining tasks found on ECC production's latest
 * run, shaped like api/routes/mining.py. The patterns are grouped from the same rows the way the route groups them, so
 * the counts agree across the screen. A run request answers with a task id and remembers nothing, as the route does.
 */
import type { AnomalyItem, DuplicatePair, MiningOverview, MiningPattern, RelationshipItem, Severity } from "../mining";

export const NONE_MINING = Symbol("not a mining path");

const RUN = "d3229ded-0708-4967-9dfb-1b7f4fada953";
const AT = "2026-10-30T02:14:00+00:00";
const refuse = (status: number, detail: string): never => {
  throw Object.assign(new Error(detail), { status, response: { status, data: { detail } } });
};

// object, record a, record b, score, id field, matched fields
const DUPES: [string, string, string, number, string, string[]][] = [
  ["material_master", "000000000010004711", "000000000010009120", 0.98, "MATNR", ["MAKTX", "MEINS", "MATKL", "BRGEW"]],
  ["material_master", "000000000010004802", "000000000010004803", 0.96, "MATNR", ["MAKTX", "MEINS", "MATKL"]],
  ["material_master", "000000000010005130", "000000000010011774", 0.91, "MATNR", ["MAKTX", "MATKL", "GEWEI"]],
  ["material_master", "000000000010003391", "000000000010003392", 0.87, "MATNR", ["MAKTX", "MEINS"]],
  ["material_master", "000000000010006018", "000000000010012240", 0.72, "MATNR", ["MAKTX"]],
  ["business_partner", "0001000412", "0001003318", 0.97, "PARTNER", ["NAME_ORG1", "STREET", "CITY1", "TEL_NUMBER"]],
  ["business_partner", "0001000377", "0001002904", 0.89, "PARTNER", ["NAME_ORG1", "CITY1"]],
  ["business_partner", "0001001108", "0001001109", 0.66, "PARTNER", ["NAME_ORG1"]],
  ["sd_customer_master", "0000200318", "0000204411", 0.93, "KUNNR", ["NAME1", "ORT01", "STRAS"]],
];

// object, field, record, value, method, z score, lower, upper, severity
const OUTLIERS: [string, string, string, number, string, number | null, number | null, number | null, Severity][] = [
  ["material_master", "BRGEW", "000000000010007220", 48_000, "iqr", null, 0.1, 380, "critical"],
  ["material_master", "BRGEW", "000000000010007221", 12_500, "iqr", null, 0.1, 380, "high"],
  ["material_master", "NTGEW", "000000000010007220", 46_200, "iqr", null, 0.1, 350, "critical"],
  ["material_master", "PLIFZ", "000000000010002210", 999, "zscore", 8.4, null, null, "high"],
  ["material_master", "PLIFZ", "000000000010002388", 365, "zscore", 4.1, null, null, "medium"],
  ["material_master", "PLIFZ", "000000000010002512", 240, "zscore", 3.2, null, null, "low"],
  ["business_partner", "CREDIT_LIMIT", "0001000877", 250_000_000, "iqr", null, 0, 4_000_000, "critical"],
  ["sd_customer_master", "ANTLF", "0000201190", 99, "zscore", 6.7, null, null, "high"],
];

// object, field a, field b, type, strength
const LINKS: [string, string, string, string, number][] = [
  ["material_master", "BRGEW", "NTGEW", "correlation", 0.97],
  ["material_master", "MTART", "MEINS", "functional_dependency", 0.91],
  ["material_master", "MATKL", "SPART", "functional_dependency", 0.84],
  ["business_partner", "COUNTRY", "REGION", "functional_dependency", 0.99],
  ["sd_customer_master", "LAND1", "REGIO", "functional_dependency", 0.98],
  ["sd_customer_master", "KTOKD", "AKONT", "functional_dependency", 0.62],
];

const duplicates = (): DuplicatePair[] =>
  DUPES.map(([module_id, record_a, record_b, match_score, id_field, matched_fields], i) => ({
    id: `dup-${i + 1}`, version_id: RUN, module_id, record_a, record_b, match_score, id_field, matched_fields, detected_at: AT,
  }));

const anomalies = (): AnomalyItem[] =>
  OUTLIERS.map(([module_id, field_name, record_key, field_value, detection_method, z_score, lower_bound, upper_bound, severity], i) => ({
    id: `anom-${i + 1}`, version_id: RUN, module_id, field_name, field_value, record_index: 1_000 + i, record_key,
    detection_method, z_score, lower_bound, upper_bound, severity, detected_at: AT,
  }));

const relationships = (): RelationshipItem[] =>
  LINKS.map(([module_id, field_a, field_b, relationship_type, strength_score], i) => ({
    id: `rel-${i + 1}`, version_id: RUN, module_id, field_a, field_b, relationship_type, strength_score, detected_at: AT,
  }));

const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const scoreBand = (s: number): Severity => (s >= 0.95 ? "critical" : s >= 0.85 ? "high" : s >= 0.6 ? "medium" : "low");

/** Grouped the way the route groups: outliers by object and field, duplicates by object. */
function patterns(): MiningPattern[] {
  const out: MiningPattern[] = [];
  const byField = new Map<string, AnomalyItem[]>();
  for (const a of anomalies()) byField.set(`${a.module_id}:${a.field_name}`, [...(byField.get(`${a.module_id}:${a.field_name}`) ?? []), a]);
  for (const [key, rows] of byField) {
    const top = rows.reduce((m, r) => Math.max(m, RANK[r.severity]), 1);
    const conf = rows.reduce((s, r) => s + Math.min(Math.abs(r.z_score ?? 0) / 5, 1), 0) / rows.length;
    out.push({
      id: `anomaly:${key}`, name: `Anomalous values in ${rows[0].field_name}`, module: rows[0].module_id, pattern_type: "anomaly",
      severity: (Object.keys(RANK) as Severity[]).find((k) => RANK[k] === top) ?? "low", occurrences: rows.length,
      first_seen: AT, last_seen: AT, confidence: Math.round(conf * 1000) / 1000, trend: [], promoted_to_rule: false,
    });
  }
  const byObject = new Map<string, DuplicatePair[]>();
  for (const d of duplicates()) byObject.set(d.module_id, [...(byObject.get(d.module_id) ?? []), d]);
  for (const [module, rows] of byObject) {
    const avg = rows.reduce((s, r) => s + r.match_score, 0) / rows.length;
    out.push({
      id: `duplicate:${module}`, name: `Duplicate records in ${module}`, module, pattern_type: "duplicate", severity: scoreBand(avg),
      occurrences: rows.length, first_seen: AT, last_seen: AT, confidence: Math.round(avg * 1000) / 1000, trend: [], promoted_to_rule: false,
    });
  }
  return out.sort((a, b) => b.occurrences - a.occurrences);
}

function overview(): MiningOverview {
  const anomalyPatterns = new Set(OUTLIERS.map((o) => `${o[0]}:${o[1]}`)).size;
  const dupPatterns = new Set(DUPES.map((d) => d[0])).size;
  return {
    window_days: 30, total_patterns: anomalyPatterns + dupPatterns, new_anomalies: anomalyPatterns, stable_patterns: dupPatterns,
    coverage_pct: 20.0, runs_total: 4, cost_usd: 0,
  };
}

export function miningRead(path: string): unknown {
  if (path === "/mining/summary") return overview();
  if (path === "/mining/duplicates") return duplicates();
  if (path === "/mining/anomalies") return anomalies();
  if (path === "/mining/relationships") return relationships();
  if (path === "/mining/patterns") return { patterns: patterns() };
  return NONE_MINING;
}

export function miningWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || path !== "/mining/run") return NONE_MINING;
  const vid = (body as { version_id?: string } | null)?.version_id;
  if (vid !== RUN) refuse(404, "version not found");
  return { task_id: "mining-task-1", version_id: vid, include: ["dedup", "anomaly", "relationship"] };
}
