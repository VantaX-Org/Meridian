/**
 * Anomaly-to-rule fixture: a proposal for each fixture outlier, shaped like api/routes/aletheia_anomaly_rules.py. The
 * rule is the template's bound on the qualified field; the hit count is the outliers of that field plus two more the
 * bound also catches. Fields with no known table get no proposal, as the route answers an unqualified field.
 */
import type { AnomalyItem } from "../mining";
import type { AnomalyRuleProposal, FieldShift } from "../anomaly-rules";
import { miningRead } from "./mining";

export const NONE_ANOMALY_RULES = Symbol("not an anomaly rule path");

const TABLE: Record<string, Record<string, string>> = {
  material_master: { BRGEW: "MARA", NTGEW: "MARA", PLIFZ: "MARC" },
  sd_customer_master: { ANTLF: "KNVV" },
};
const POPULATION = 48_210;
const refuse = (status: number, detail: string): never => {
  throw Object.assign(new Error(detail), { status, response: { status, data: { detail } } });
};

function propose(id: string): AnomalyRuleProposal {
  const all = miningRead("/mining/anomalies") as AnomalyItem[];
  const a = all.find((x) => x.id === id);
  if (!a) return refuse(404, "Anomaly not found");
  const count = all.filter((x) => x.module_id === a.module_id && x.field_name === a.field_name).length;
  const table = TABLE[a.module_id]?.[a.field_name];
  const field = table ? `${table}.${a.field_name}` : a.field_name;
  const grounding = {
    kind: "outlier" as const, module: a.module_id, field, field_description: a.field_description ?? null,
    statistic: { method: a.detection_method, z_score: a.z_score ?? null, lower: a.lower_bound ?? null, upper: a.upper_bound ?? null },
    anomaly_count: count, rule_hits: null as number | null, population: null as number | null, ai_sent: [] as string[],
  };
  const lo = a.lower_bound, hi = a.upper_bound;
  if (!table || (lo == null && hi == null)) {
    return {
      rule_yaml: null, valid: false, source: "llm", version_id: null,
      errors: ["No template fits this anomaly and AI drafting is unavailable."],
      dry_run: { evaluated: false, reason: "no rule proposed" }, grounding, confidence: null,
    };
  }
  const parts = [...(lo != null ? [`(\`${field}\` < ${lo})`] : []), ...(hi != null ? [`(\`${field}\` > ${hi})`] : [])];
  const hits = count + 2;
  return {
    rule_yaml: [
      `id: ANOM_OUT_${field.replace(".", "_")}`, `field: ${field}`, `severity: ${a.severity}`, "check_class: cross_field_check",
      "dimension: accuracy", `fail_when: ${parts.join(" | ")}`, "require_populated: true",
      `message: ${field} outside the usual range`, "",
    ].join("\n"),
    valid: true, errors: [], source: "template", version_id: a.version_id,
    dry_run: { evaluated: true, hits, population: POPULATION, pass_rate: Math.round((1 - hits / POPULATION) * 10_000) / 100 },
    grounding: { ...grounding, rule_hits: hits, population: POPULATION },
    confidence: { basis: "template", level: "high" },
  };
}

const counts = (rows: number, blank: number, distinct: number) => ({ rows, blank, blank_pct: Math.round((blank / rows) * 10_000) / 100, distinct });
const SHIFTS: FieldShift[] = [
  {
    id: "shift-1", version_id: "v-fixture-2", prev_version_id: "v-fixture-1", run_number: 12, prev_run_number: 11,
    module: "material_master", field: "MARA.BRGEW", field_description: "Gross weight", kind: "null_spike", severity: "critical",
    current: counts(48_210, 31_400, 9_120), previous: counts(47_980, 2_150, 9_870), codes: [], detected_at: "2026-10-30 04:12:00",
  },
  {
    id: "shift-2", version_id: "v-fixture-2", prev_version_id: "v-fixture-1", run_number: 12, prev_run_number: 11,
    module: "material_master", field: "MARA.MTART", field_description: "Material type", kind: "unexpected_code", severity: "high",
    current: counts(48_210, 0, 6), previous: counts(47_980, 0, 5), codes: [{ value: "HALB", count: 3_420 }], detected_at: "2026-10-30 04:12:00",
  },
  {
    id: "shift-3", version_id: "v-fixture-4", prev_version_id: "v-fixture-3", run_number: 8, prev_run_number: 7,
    module: "sd_customer_master", field: "KNVV.VKORG", field_description: "Sales organization", kind: "unexpected_code", severity: "medium",
    current: counts(12_400, 0, 4), previous: counts(12_390, 0, 3), codes: [{ value: "1000", count: 35 }], detected_at: "2026-10-29 03:40:00",
  },
];

export function anomalyRulesRead(path: string): unknown {
  return path === "/aletheia/anomaly-rules/shifts" ? SHIFTS : NONE_ANOMALY_RULES;
}

export function anomalyRulesWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST") return NONE_ANOMALY_RULES;
  if (path === "/aletheia/anomaly-rules/propose") return propose((body as { anomaly_id?: string } | null)?.anomaly_id ?? "");
  if (path === "/rule-authoring/drafts") {
    // The workbench fixture reads rule_yaml as JSON; block YAML saves are answered here and not kept in its list.
    try {
      JSON.parse(String((body as { rule_yaml?: string } | null)?.rule_yaml));
    } catch {
      return { id: "draft-anomaly-1", status: "draft", rule: {} };
    }
  }
  return NONE_ANOMALY_RULES;
}
