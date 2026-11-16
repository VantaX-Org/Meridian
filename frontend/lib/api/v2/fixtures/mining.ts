/**
 * Data mining fixture: the duplicates, outliers and relationships the mining tasks found on ECC production's latest
 * run, shaped like api/routes/mining.py. The patterns are grouped from the same rows the way the route groups them, so
 * the counts agree across the screen. A run request answers with a task id and remembers nothing, as the route does.
 */
import type {
  AnomalyItem, DuplicatePair, MiningGraph, MiningOverview, MiningPattern, MiningRunSummary, RelationshipItem, Severity,
} from "../mining";

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

// The dictionary texts the route attaches (api/routes/mining.py field_text); fields it does not know are left out.
const TEXTS: Record<string, Record<string, string>> = {
  material_master: { MAKTX: "Material description", MEINS: "Base unit of measure", MATKL: "Material group", BRGEW: "Gross weight", GEWEI: "Weight unit", NTGEW: "Net weight", PLIFZ: "Planned delivery time (days)", MTART: "Material type", SPART: "Division" },
  business_partner: { STREET: "Street and house number", CITY1: "City", COUNTRY: "Country key", REGION: "Region (state / province / canton)" },
  sd_customer_master: { NAME1: "Customer name 1", LAND1: "Country key", KTOKD: "Customer account group" },
};
const text = (module: string, field: string): string | null => TEXTS[module]?.[field] ?? null;

const duplicates = (): DuplicatePair[] =>
  DUPES.map(([module_id, record_a, record_b, match_score, id_field, matched_fields], i) => ({
    id: `dup-${i + 1}`, version_id: RUN, module_id, record_a, record_b, match_score, id_field, matched_fields, detected_at: AT,
    field_texts: Object.fromEntries(matched_fields.flatMap((f) => (text(module_id, f) ? [[f, text(module_id, f)!]] : []))),
  }));

const anomalies = (): AnomalyItem[] =>
  OUTLIERS.map(([module_id, field_name, record_key, field_value, detection_method, z_score, lower_bound, upper_bound, severity], i) => ({
    id: `anom-${i + 1}`, version_id: RUN, module_id, field_name, field_description: text(module_id, field_name), field_value, record_index: 1_000 + i, record_key,
    detection_method, z_score, lower_bound, upper_bound, severity, detected_at: AT,
  }));

const relationships = (): RelationshipItem[] =>
  LINKS.map(([module_id, field_a, field_b, relationship_type, strength_score], i) => ({
    id: `rel-${i + 1}`, version_id: RUN, module_id, field_a, field_b, relationship_type, strength_score, detected_at: AT,
    field_a_description: text(module_id, field_a), field_b_description: text(module_id, field_b),
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
    const z = rows.filter((r) => r.z_score != null);
    const conf = z.length ? z.reduce((s, r) => s + Math.min(Math.abs(r.z_score as number) / 5, 1), 0) / z.length : null;
    out.push({
      id: `anomaly:${key}`, name: `Anomalous values in ${rows[0].field_name}`, module: rows[0].module_id, pattern_type: "anomaly",
      severity: (Object.keys(RANK) as Severity[]).find((k) => RANK[k] === top) ?? "low", occurrences: rows.length,
      first_seen: AT, last_seen: AT, confidence: conf == null ? null : Math.round(conf * 1000) / 1000, trend: [], promoted_to_rule: false,
      field_description: rows[0].field_description,
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

function runSummary(vid: string): MiningRunSummary {
  if (vid !== RUN) refuse(404, "version not found");
  const per: MiningRunSummary["per_module"] = {};
  const bump = (m: string, k: "duplicates" | "anomalies" | "relationships") => {
    per[m] ??= { duplicates: 0, anomalies: 0, relationships: 0 };
    per[m][k] += 1;
  };
  DUPES.forEach((d) => bump(d[0], "duplicates"));
  OUTLIERS.forEach((o) => bump(o[0], "anomalies"));
  LINKS.forEach((l) => bump(l[0], "relationships"));
  const sum = (k: "duplicates" | "anomalies" | "relationships") => Object.values(per).reduce((n, m) => n + m[k], 0);
  return { version_id: vid, per_module: per, totals: { duplicates: sum("duplicates"), anomalies: sum("anomalies"), relationships: sum("relationships") } };
}

// Material master steps as process_mining.py projects them from the L1-L5 definitions (ids, names and t-codes are
// the generator's own for module material_master), with findings that touch the material fields.
type Act = [string, string, string, string, string, "green" | "amber" | "red", number, number, number | null];
const ACTS: Act[] = [
  ["PTP-PR-ME51N-01", "Requisition Item", "PTP-PR-ME51N", "Create Purchase Requisition", "ME51N", "amber", 286, 3, 0.93],
  ["PTP-PO-ME21N-01", "PO Header", "PTP-PO-ME21N", "Create Standard PO", "ME21N", "green", 0, 0, 1],
  ["PTP-PO-ME21N-02", "PO Line Items", "PTP-PO-ME21N", "Create Standard PO", "ME21N", "red", 1_180, 7, 0.74],
  ["PTP-GR-MIGO-01", "Goods Receipt Item", "PTP-GR-MIGO", "Post Goods Receipt", "MIGO", "amber", 412, 4, 0.88],
  ["PP-BOM-CS01-01", "BOM Header", "PP-BOM-CS01", "Create BOM", "CS01", "green", 18, 1, 0.99],
  ["PP-BOM-CS01-02", "BOM Items", "PP-BOM-CS01", "Create BOM", "CS01", "amber", 204, 2, 0.9],
];
const QUALITY = { green: 100, amber: 60, red: 25 } as const;

function graph(vid: string, module: string): MiningGraph {
  if (vid !== RUN || module !== "material_master") refuse(404, "no mining graph for this run and module");
  const activities = ACTS.map(([id, label, l4_id, l4_name, tcode, step_status, affected_records, finding_count, avg_pass_rate]) => ({
    id, label, l4_id, l4_name, tcode, step_status, affected_records, finding_count, avg_pass_rate,
  }));
  const weight = (id: string) => Math.max(activities.find((a) => a.id === id)?.affected_records ?? 0, 1);
  const transitions = [["PTP-PO-ME21N-01", "PTP-PO-ME21N-02"], ["PP-BOM-CS01-01", "PP-BOM-CS01-02"]].map(([from, to]) => ({ from, to, weight: weight(from) }));
  const l4s = [...new Set(ACTS.map((a) => a[2]))];
  const variants = l4s.map((l4) => {
    const acts = activities.filter((a) => a.l4_id === l4);
    const readiness = acts.some((a) => a.step_status === "red") ? "red" : acts.some((a) => a.step_status === "amber") ? "amber" : "green";
    return {
      id: l4, label: acts[0].l4_name, tcode: acts[0].tcode, activity_count: acts.length, coverage: Math.round(10_000 / l4s.length) / 10_000,
      readiness, quality: QUALITY[readiness], activity_ids: acts.map((a) => a.id),
    } satisfies MiningGraph["variants"][number];
  });
  return { version_id: vid, module, activities, transitions, variants, cases: [], cases_supported: false };
}

export function miningRead(path: string): unknown {
  let m = /^\/mining\/summary\/([^/]+)$/.exec(path);
  if (m) return runSummary(decodeURIComponent(m[1]));
  m = /^\/process\/mining\/graph\/([^/]+)\/([^/]+)$/.exec(path);
  if (m) return graph(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
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
