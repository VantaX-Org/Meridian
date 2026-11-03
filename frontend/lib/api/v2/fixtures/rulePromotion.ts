/**
 * Rule promotion fixture, shaped like api/routes/rule_promotion.py: switched-off generated rules in each bucket for two
 * objects. Apply enables the promote bucket, promote-anyway enables the named review rules, revert switches them off.
 * The ids and messages follow the generated packs; the numbers are made up and no record key names a person.
 */
import type { PromotionBucket, PromotionPreview, PromotionRule, PromotionModule } from "../rule-promotion";

export const NONE_RULE_PROMOTION = Symbol("not a rule promotion path");

const TH = { min_populated_pct: 20, max_failure_rate: 0.02, min_records: 100, drift_delta: 0.05 };
const refuse = (status: number, detail: unknown): never => {
  throw Object.assign(new Error(String(detail)), { status, response: { status, data: { detail } } });
};

const r = (id: string, field: string, field_text: string, check_class: string, message: string, bucket: PromotionBucket, reason: string, over: Partial<PromotionRule> = {}): PromotionRule => ({
  id, field, field_text, check_class, severity: "medium", message, reference_key: null, bucket, reason,
  failing: 0, total: 0, rate: null, populated_pct: null, sample_keys: [], promoted: false, ...over,
});

const seed = (): Record<string, PromotionRule[]> => ({
  material_master: [
    r("MM_GEN_MARA_BRGEW_NULL", "MARA.BRGEW", "Gross weight", "null_check", "MARA.BRGEW must be filled", "promote", "within_threshold", { failing: 12, total: 48210, rate: 0.000249, populated_pct: 96.4 }),
    r("MM_GEN_MARA_MTART_REF", "MARA.MTART", "Material type", "referential_check", "MARA.MTART must exist in T134", "promote", "within_threshold", { reference_key: "T134.MTART", failing: 0, total: 48210, rate: 0, populated_pct: 100 }),
    r("MM_GEN_MARA_MATKL_NULL", "MARA.MATKL", "Material group", "null_check", "MARA.MATKL must be filled", "review", "failure_rate_high", { failing: 3980, total: 48210, rate: 0.082555, populated_pct: 91.7, sample_keys: ["000000000010004211", "000000000010004390", "000000000010005018", "000000000010005377", "000000000010005402"] }),
    r("MM_GEN_MARA_SPART_REF", "MARA.SPART", "Division", "referential_check", "MARA.SPART must exist in TSPA", "needs_value_set", "no_value_set", { reference_key: "TSPA.SPART" }),
    r("MM_GEN_MARA_FERTH_NULL", "MARA.FERTH", "Production or inspection memo", "null_check", "MARA.FERTH must be filled", "skip_unused", "empty", { populated_pct: 0 }),
  ],
  sd_customer_master: [
    r("SD_GEN_KNA1_LAND1_NULL", "KNA1.LAND1", "Country key", "null_check", "KNA1.LAND1 must be filled", "promote", "within_threshold", { failing: 0, total: 12400, rate: 0, populated_pct: 100 }),
    r("SD_GEN_KNA1_KTOKD_REF", "KNA1.KTOKD", "Customer account group", "referential_check", "KNA1.KTOKD must exist in T077D", "needs_value_set", "no_value_set", { reference_key: "T077D.KTOKD" }),
    r("SD_GEN_KNA1_STCD1_NULL", "KNA1.STCD1", "Tax number 1", "null_check", "KNA1.STCD1 must be filled", "skip_unused", "sparse", { populated_pct: 8.2 }),
  ],
});

let state = seed();
const reasons: Record<string, string> = {};
export const resetRulePromotion = () => { state = seed(); };

const counts = (rows: PromotionRule[]) => Object.fromEntries((["promote", "review", "skip_unused", "needs_value_set"] as const).map((b) => [b, rows.filter((x) => !x.promoted && x.bucket === b).length])) as Record<PromotionBucket, number>;

function preview(module: string): PromotionPreview {
  const rows = state[module];
  if (!rows) return refuse(404, "No generated rules for this module.");
  const c = counts(rows);
  const promoted = rows.filter((x) => x.promoted);
  // One promoted rule has drifted: its failure rate rose over the rate it was promoted at.
  const drift = promoted.filter((x) => x.id === "MM_GEN_MARA_BRGEW_NULL").map((x) => ({
    id: x.id, baseline_rate: 0.000249, current_rate: 0.091, delta: 0.090751, failing: 4388, total: 48210, sample_keys: ["000000000010004211", "000000000010004390"],
  }));
  return {
    module, version_id: "v-fixture-2", thresholds: TH, counts: c, promoted: promoted.length, drift, rules: rows,
    narrative: `${module}: ${rows.length - promoted.length} generated rules evaluated. ${c.promote} ready to promote, ${c.review} need review (failure rate above threshold), ${c.needs_value_set} wait for a value set, ${c.skip_unused} skipped (field unused or not extracted).`,
  };
}

export function rulePromotionRead(path: string, params: Record<string, string | number | boolean | undefined>): unknown {
  if (path === "/rule-promotion/modules") {
    const modules: PromotionModule[] = Object.entries(state).map(([module, rows]) => ({
      module, generated: rows.length, promoted: rows.filter((x) => x.promoted).length, summary: counts(rows), evaluated_at: "2026-10-30T04:12:00+00:00",
    }));
    return { modules };
  }
  return path === "/rule-promotion/preview" ? preview(String(params.module ?? "")) : NONE_RULE_PROMOTION;
}

export function rulePromotionWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || !path.startsWith("/rule-promotion/")) return NONE_RULE_PROMOTION;
  const b = (body ?? {}) as { module?: string; rule_ids?: string[]; reason?: string };
  const rows = state[b.module ?? ""];
  if (!rows) return refuse(404, "No generated rules for this module.");
  if (path.endsWith("/apply")) {
    const hit = rows.filter((x) => !x.promoted && x.bucket === "promote");
    hit.forEach((x) => { x.promoted = true; });
    return { enabled: hit.map((x) => x.id), counts: counts(rows) };
  }
  if (path.endsWith("/promote-anyway")) {
    const ids = b.rule_ids ?? [];
    const bad = ids.filter((i) => rows.find((x) => x.id === i)?.bucket !== "review");
    if (bad.length) return refuse(422, { not_in_review: bad });
    if ((b.reason ?? "").trim().length < 5) return refuse(422, "A reason of at least 5 characters is needed.");
    rows.filter((x) => ids.includes(x.id)).forEach((x) => { x.promoted = true; reasons[x.id] = b.reason ?? ""; });
    return { enabled: ids };
  }
  if (path.endsWith("/revert")) {
    const ids = b.rule_ids ?? rows.filter((x) => x.promoted).map((x) => x.id);
    const done = rows.filter((x) => x.promoted && ids.includes(x.id));
    done.forEach((x) => { x.promoted = false; });
    return { reverted: done.map((x) => x.id) };
  }
  return NONE_RULE_PROMOTION;
}
