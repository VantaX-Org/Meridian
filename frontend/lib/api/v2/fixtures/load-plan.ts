/**
 * Load plan fixture, shaped like api/routes/load_plan.py on the bundled S/4HANA dictionary. The edges, fields, check
 * tables and texts are the ones the route derives for these six objects; the run states are synthetic.
 */
import type { LoadEdge, LoadObject, LoadPlan, LoadPrerequisite } from "../load-plan";

export const NONE_LOAD_PLAN = Symbol("not a load plan path");

const pre = (table: string, text: string, fields: string[]): LoadPrerequisite => ({ table, text, kind: "unclassified", fields });

const OBJECTS: LoadObject[] = [
  {
    module: "fi_gl", label: "G/L accounts", anchor: "SKA1", anchor_text: "G/L Account Master (Chart of Accounts)", step: 1, group: [],
    status: "no_go", blocking: 3, run_id: "run-gl-7", blocked_by: [],
    prerequisites: [pre("T001S", "Accounting Clerks", ["SKB1.BUSAB"]), pre("T004F", "Field status definition groups", ["SKB1.FSTAG"]), pre("T012", "House Banks", ["SKB1.HBKID"])],
  },
  {
    module: "business_partner", label: "Business partners", anchor: "BUT000", anchor_text: "BP: General data I", step: 1, group: [],
    status: "go", blocking: 0, run_id: "run-bp-4", blocked_by: [],
    prerequisites: [pre("T002", "Language Keys (Component BC-I18)", ["BUT000.BU_LANGU"]), pre("T005", "Countries", ["BUT000.NATIO"]), pre("TB001", "BP groupings", ["BUT000.BU_GROUP"])],
  },
  {
    module: "accounts_payable", label: "Suppliers", anchor: "LFA1", anchor_text: "Vendor Master (General Section)", step: 2, group: [],
    status: "go", blocking: 0, run_id: "run-ap-5", blocked_by: ["fi_gl"],
    prerequisites: [pre("T001S", "Accounting Clerks", ["LFB1.BUSAB"]), pre("T001W", "Plants/Branches", ["LFA1.WERKS"]), pre("T005", "Countries", ["LFA1.LAND1"])],
  },
  {
    module: "sd_customer_master", label: "Customers", anchor: "KNA1", anchor_text: "General Data in Customer Master", step: 3, group: [],
    status: "not_run", blocking: 0, run_id: null, blocked_by: ["fi_gl"],
    prerequisites: [pre("T002", "Language Keys (Component BC-I18)", ["KNA1.SPRAS"]), pre("T005", "Countries", ["KNA1.LAND1"]), pre("T005S", "Taxes: Region (Province) Key", ["KNA1.REGIO"])],
  },
  {
    module: "material_master", label: "Materials", anchor: "MARA", anchor_text: "General Material Data", step: 3, group: [],
    status: "no_go", blocking: 12, run_id: "run-mm-9", blocked_by: [],
    prerequisites: [pre("T001L", "Storage Locations", ["MARC.LGFSB"]), pre("T001W", "Plants/Branches", ["MARC.VRBWK"]), pre("T006", "Units of Measurement", ["MARA.BSTME"])],
  },
  {
    module: "mm_purchasing", label: "Purchasing", anchor: "EKKO", anchor_text: "Purchasing Document Header", step: 4, group: [],
    status: "not_run", blocking: 0, run_id: null, blocked_by: [],
    prerequisites: [pre("T001", "Company Codes", ["EKKO.BUKRS"]), pre("T006", "Units of Measurement", ["EINA.MEINS"]), pre("T023", "Material Groups", ["EINA.MATKL"])],
  },
];

const ev = (field: string, text: string, check_table: string, check_table_text: string, reason: string | null = null) =>
  ({ field, text, check_table, check_table_text, required: reason !== null, reason });

const EDGES: LoadEdge[] = [
  { before: "accounts_payable", after: "material_master", kind: "reference", deferred: false, evidence: [ev("MARA.MFRNR", "Manufacturer number", "LFA1", "Vendor Master (General Section)")] },
  { before: "accounts_payable", after: "mm_purchasing", kind: "reference", deferred: false, evidence: [ev("EINA.LIFNR", "Vendor's account number", "LFA1", "Vendor Master (General Section)"), ev("EKKO.LIFNR", "Vendor's account number", "LFA1", "Vendor Master (General Section)"), ev("EKKO.LIFRE", "Different Invoicing Party", "LFA1", "Vendor Master (General Section)")] },
  { before: "accounts_payable", after: "sd_customer_master", kind: "reference", deferred: false, evidence: [ev("KNA1.LIFNR", "Account Number of Vendor or Creditor", "LFA1", "Vendor Master (General Section)")] },
  { before: "fi_gl", after: "accounts_payable", kind: "required", deferred: false, evidence: [ev("LFB1.AKONT", "Reconciliation Account in General Ledger", "SKB1", "G/L account master (company code)", "Reconciliation account is required for supplier company-code data")] },
  { before: "fi_gl", after: "sd_customer_master", kind: "required", deferred: false, evidence: [ev("KNB1.AKONT", "Reconciliation Account in General Ledger", "SKB1", "G/L account master (company code)", "Reconciliation account is required for customer company-code data")] },
  { before: "material_master", after: "mm_purchasing", kind: "reference", deferred: false, evidence: [ev("EINA.MATNR", "Material Number", "MARA", "General Material Data")] },
];

export function loadPlanRead(path: string, params: Record<string, unknown>): unknown {
  if (path !== "/migration/load-plan") return NONE_LOAD_PLAN;
  const wanted = String(params.modules ?? "").split(",").filter(Boolean);
  const objects = wanted.length ? OBJECTS.filter((o) => wanted.includes(o.module)) : OBJECTS;
  const keep = new Set(objects.map((o) => o.module));
  return {
    release: "s4hana",
    objects,
    edges: EDGES.filter((e) => keep.has(e.before) && keep.has(e.after)),
    unknown: wanted.filter((m) => !OBJECTS.some((o) => o.module === m)),
    steps: Math.max(0, ...objects.map((o) => o.step)),
  } satisfies LoadPlan;
}
