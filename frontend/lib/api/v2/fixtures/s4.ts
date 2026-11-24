/** S/4HANA readiness fixture, shaped like GET /findings/s4-readiness?scope=current: one red, one amber, one green and one unmeasured area. */
export const NONE_S4 = Symbol("not an S/4 readiness path");

/** Each rule's message from its YAML pack, as rollup returns it in name. */
const NAMES: Record<string, string> = {
  "S4R-BP-KNVK-NAME": "S/4HANA readiness: contact person has no last name (KNVK.NAME1) - simplification item S4TWL Business Partner Approach, SAP Note 2265093",
  MM007: "Material group is required for reporting and procurement",
  "S4R-BP-KNA1-ADRNR": "S/4HANA readiness: active customer has no central address (KNA1.ADRNR) - simplification item S4TWL Business Partner Approach, SAP Note 2265093",
  "S4R-BP-DUP-TAX": "S/4HANA readiness: vendor has the same country and tax number as an unlinked customer and should become one Business Partner - simplification item Business Partner Approach (SAP Note 2265093)",
  MM003: "Material type is mandatory - determines procurement and storage behaviour",
  MM035: "Valuation class is mandatory for FI account determination",
  MM142: "Base unit of measure MEINS must reference a valid entry in T006",
};

const check = (check_id: string, module: string, impact: "blocking" | "warning", status: string, affected_count: number, pass_rate: number | null) =>
  ({ check_id, name: NAMES[check_id] ?? "", module, impact, status, affected_count, pass_rate });

const areas = [
  {
    area: "business_partner", label: "Business Partner / CVI", simplification_item: "Business Partner Approach (SAP Note 2265093)",
    rules: 9, evaluated: 9, failing: 3, failing_records: 1_876, blocking_failing: 2, warning_failing: 1, status: "red",
    checks: [
      check("S4R-BP-KNVK-NAME", "s4_readiness", "blocking", "red", 1_412, 71.8),
      check("MM007", "business_partner", "blocking", "red", 428, 88.4),
      check("S4R-BP-KNA1-ADRNR", "s4_readiness", "warning", "amber", 36, 99.1),
      check("S4R-BP-DUP-TAX", "s4_readiness", "warning", "green", 0, 100),
    ],
  },
  {
    area: "material", label: "Material master", simplification_item: "Material Number Field Length Extension",
    rules: 6, evaluated: 6, failing: 1, failing_records: 2_904, blocking_failing: 0, warning_failing: 1, status: "amber",
    checks: [check("MM003", "material_master", "warning", "amber", 2_904, 92.6), check("MM035", "material_master", "warning", "green", 0, 100)],
  },
  {
    area: "finance", label: "Universal Journal / General Ledger", simplification_item: "Data Model Changes in Financials - Universal Journal",
    rules: 4, evaluated: 4, failing: 0, failing_records: 0, blocking_failing: 0, warning_failing: 0, status: "green",
    checks: [check("MM142", "fi_gl", "blocking", "green", 0, 100)],
  },
  {
    area: "warehouse_ewm", label: "Warehouse Management to EWM", simplification_item: "Warehouse Management (LE-WM) in Compatibility Scope, replaced by SAP EWM",
    rules: 5, evaluated: 0, failing: 0, failing_records: 0, blocking_failing: 0, warning_failing: 0, status: "not_evaluated", checks: [],
  },
];

export function s4Read(path: string): unknown {
  if (path !== "/findings/s4-readiness") return NONE_S4;
  return {
    version_id: null, scope: "current", version_ids: ["v-12"], status: "red", ready: false, assessment: "incomplete",
    rules: 24, evaluated: 19, failing: 4, failing_records: 4_780, blocking_failing: 2, warning_failing: 2,
    blocking_rules: 6, blocking_evaluated: 4, blocking_unevaluated: 2, areas,
  };
}
