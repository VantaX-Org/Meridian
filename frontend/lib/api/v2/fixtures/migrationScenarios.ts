/**
 * Migration scenario fixture, shaped like GET /rules/migration-scenarios (api/routes/rule_depth.py): the four scenarios
 * with counts, and for a chosen scenario a short list of rules from two objects. The ids, fields and messages follow
 * shipped rules; the counts are made up and no record key names a person.
 */
import type { MigrationCounts, MigrationRelevance, MigrationScenario, MigrationScenarioId, MigrationScenarioRule, MigrationScenarios } from "../rulelib";

export const NONE_MIGRATION_SCENARIOS = Symbol("not a migration scenarios path");

const c = (required: number, recommended: number, not_applicable = 0): MigrationCounts => ({ required, recommended, not_applicable });
const sc = (id: MigrationScenarioId, description: string, counts: MigrationCounts, blocking: number, mm: MigrationCounts, sd: MigrationCounts): MigrationScenario => ({
  id, description, counts, blocking, modules: { material_master: mm, sd_customer_master: sd },
});

const SCENARIOS: MigrationScenario[] = [
  sc("new_implementation", "Greenfield: a fresh S/4HANA system loaded through the migration cockpit, with no history carried over.", c(34, 61, 2), 6, c(22, 30, 2), c(12, 31)),
  sc("system_conversion", "Brownfield: the existing ECC system is converted in place and must pass the conversion pre-checks.", c(49, 48), 6, c(30, 24), c(19, 24)),
  sc("selective_transition", "Chosen objects and organisational units are copied into S/4HANA while the rest stays behind.", c(46, 51), 6, c(28, 26), c(18, 25)),
  sc("carve_out", "One company code or business unit is extracted into its own S/4HANA system.", c(33, 62, 2), 5, c(22, 30, 2), c(11, 32)),
];

const MAT = "The material number length and material master structure change, and material data is moved in every path.";
const ML = "The material ledger is mandatory in S/4HANA, so valuation data must be complete before conversion.";
const BP = "Customers and vendors become business partners in every path, so customer-vendor integration data must be consistent.";
const DEF = "No S/4HANA-specific impact is recorded for this rule, so it is general data quality for the move.";
const BLOCK_CONV = "Flagged as a migration blocker, so the conversion pre-checks fail until it is fixed.";
const BLOCK_SEL = "Flagged as a migration blocker, so the copied objects fail to load until it is fixed.";

const rule = (id: string, module: string, field: string, message: string, s4_area: string | null, relevance: MigrationRelevance, rationale: string, s4_impact: string | null = null): MigrationScenarioRule => ({
  id, module, field, message, s4_area, s4_impact, impact_note: null, relevance, rationale,
});
const MM_MTART = (rel: MigrationRelevance, why: string, impact: string | null = null) => rule("MM_GEN_MARA_MTART_REF", "material_master", "MARA.MTART", "MARA.MTART must exist in T134", "material", rel, why, impact);
const MM_BKLAS = (rel: MigrationRelevance) => rule("MM_GEN_MBEW_BKLAS_NULL", "material_master", "MBEW.BKLAS", "MBEW.BKLAS must be filled", "material_ledger", rel, ML);
const SD_LAND1 = rule("SD_GEN_KNA1_LAND1_NULL", "sd_customer_master", "KNA1.LAND1", "KNA1.LAND1 must be filled", "business_partner", "required", BP);
const MM_FERTH = rule("MM_GEN_MARA_FERTH_NULL", "material_master", "MARA.FERTH", "MARA.FERTH must be filled", null, "recommended", DEF);

const RULES: Record<MigrationScenarioId, MigrationScenarioRule[]> = {
  new_implementation: [MM_MTART("required", MAT), MM_BKLAS("recommended"), SD_LAND1, MM_FERTH],
  system_conversion: [MM_MTART("required", BLOCK_CONV, "blocking"), MM_BKLAS("required"), SD_LAND1, MM_FERTH],
  selective_transition: [MM_MTART("required", BLOCK_SEL, "blocking"), MM_BKLAS("required"), SD_LAND1, MM_FERTH],
  carve_out: [MM_MTART("required", MAT), MM_BKLAS("recommended"), SD_LAND1, MM_FERTH],
};

export function migrationScenariosRead(path: string, params?: Record<string, unknown>): MigrationScenarios | typeof NONE_MIGRATION_SCENARIOS {
  if (path !== "/rules/migration-scenarios") return NONE_MIGRATION_SCENARIOS;
  const id = params?.scenario as MigrationScenarioId | undefined;
  const rel = params?.relevance as MigrationRelevance | undefined;
  if (!id) return { scenarios: SCENARIOS, rules: null };
  if (!(id in RULES)) throw Object.assign(new Error("scenario"), { status: 422, response: { status: 422, data: { detail: "scenario" } } });
  return { scenarios: SCENARIOS, rules: RULES[id].filter((r) => !rel || r.relevance === rel) };
}
