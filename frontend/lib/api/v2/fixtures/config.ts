/**
 * Config intelligence fixture: one config run on the ECC system, shaped like api/services/config_intelligence.
 * The inventory is the source; the licence utilisation and the health scores are derived from it and from the
 * findings with the formulas of api/routes/config_intelligence.py and alignment_validator.calculate_chs, so the
 * panels agree with each other the way the real answers do.
 */
import type { AlignmentFinding, ConfigElement, ProcessHealth, ProcessStep } from "@/lib/api/config-intelligence";

export const NONE_CONFIG = Symbol("not a config path");

const RUN = "d3229ded-0708-4967-9dfb-1b7f4fada953";
const FIRST = "2025-11-03T06:00:00Z";
const LAST = "2026-10-30T22:00:00Z";

// module, element_type, reference table, [value, transactions] ...
const RAW: [string, string, string, [string, number][]][] = [
  ["FI", "company_code", "T001", [["1000", 182_406], ["2000", 41_220], ["3000", 0]]],
  ["FI", "document_type", "T003", [["SA", 61_884], ["KR", 48_112], ["DR", 39_450], ["AB", 12_030], ["ZK", 0]]],
  ["FI", "payment_method", "T042Z", [["T", 22_104], ["C", 3_118], ["E", 0]]],
  ["FI", "house_bank", "T012", [["FNB01", 19_870], ["SBK01", 5_352], ["ABS01", 0]]],
  ["FI", "number_range", "NRIV", [["KR: 5100000000-5100948211 (948212 docs, 94.8% util)", 948_212], ["SA: 0100000000-0100618840 (618841 docs, 61.9% util)", 618_841]]],
  ["MM", "plant", "T001W", [["1000", 96_550], ["1100", 31_904], ["1200", 7_480], ["9000", 0]]],
  ["MM", "storage_location", "T001L", [["0001", 71_022], ["0002", 18_430], ["0099", 0]]],
  ["MM", "purchasing_org", "T024E", [["1000", 44_318], ["2000", 0]]],
  ["MM", "po_document_type", "T161", [["NB", 40_116], ["FO", 4_202], ["ZNB", 0]]],
  ["MM", "material_type", "T134", [["ROH", 52_904], ["ERSA", 38_115], ["HAWA", 6_220], ["ZSPR", 0]]],
  ["MM", "movement_type", "T156", [["101", 39_880], ["261", 28_406], ["201", 9_710], ["311", 4_118], ["Z61", 0]]],
  ["SD", "sales_org", "TVKO", [["1000", 28_602], ["2000", 1_104]]],
  ["SD", "sales_order_type", "TVAK", [["OR", 24_470], ["ZOR", 3_910], ["RE", 1_326], ["ZSO", 0]]],
  ["SD", "billing_type", "TVFK", [["F2", 23_118], ["G2", 1_402], ["ZF2", 0]]],
  ["SD", "shipping_point", "TVST", [["1000", 22_960], ["1100", 0]]],
  ["PM", "maintenance_plant", "T001W", [["1000", 3_410], ["1100", 980]]],
  ["PM", "pm_order_type", "T003O", [["PM01", 2_806], ["PM02", 1_584], ["PM03", 0]]],
  ["PM", "notification_type", "TQ80", [["M1", 2_204], ["M2", 1_118]]],
  ["PP", "mrp_controller", "T399D", [["001", 4]]],
  ["PP", "task_list_type", "PLKO", [["N", 3], ["Q", 0]]],
];

const INVENTORY: ConfigElement[] = RAW.flatMap(([module, element_type, table, values]) =>
  values.map(([element_value, n]) => ({
    module,
    element_type,
    element_value,
    transaction_count: n,
    first_seen: n ? FIRST : null,
    last_seen: n ? LAST : null,
    status: n ? "active" : "dormant",
    sap_reference_table: table,
  })),
);

const step = (step_number: number, step_name: string, sap_table: string, volume: number, exception_count: number, avg_days_to_next_step: number | null): ProcessStep => ({
  step_number,
  step_name,
  sap_table,
  detected: volume > 0,
  volume,
  exception_count,
  avg_days_to_next_step,
});

const PROCESSES: ProcessHealth[] = [
  {
    process_id: "PTP",
    process_name: "Procure-to-Pay",
    status: "active",
    completeness_score: 100,
    steps: [
      step(1, "Purchase Requisition", "EBAN", 38_204, 412, 2.1),
      step(2, "Purchase Order", "EKKO", 44_318, 690, 6.4),
      step(3, "Goods Receipt", "MSEG", 39_880, 1_204, 3.2),
      step(4, "Invoice Receipt", "RSEG", 37_116, 4_870, 9.8),
      step(5, "GR/IR Clearing", "BSEG", 35_402, 1_022, 1.4),
      step(6, "AP Posting", "BKPF", 48_112, 318, 12.6),
      step(7, "Payment Run", "REGUH", 22_104, 86, null),
    ],
    exception_rate: 3.0,
    bottleneck_step: "Invoice Receipt",
    total_volume: 265_136,
    avg_cycle_days: 35.5,
  },
  {
    process_id: "OTC",
    process_name: "Order-to-Cash",
    status: "active",
    completeness_score: 100,
    steps: [
      step(1, "Sales Order", "VBAK", 28_380, 204, 1.8),
      step(2, "Delivery", "LIKP", 26_904, 588, 1.1),
      step(3, "Goods Issue (PGI)", "LIPS", 26_102, 140, 0.9),
      step(4, "Billing", "VBRK", 24_520, 96, 0.2),
      step(5, "Accounting (AR)", "BKPF", 24_506, 31, 41.3),
      step(6, "Payment Receipt", "BSEG", 19_880, 2_406, null),
    ],
    exception_rate: 2.2,
    bottleneck_step: "Payment Receipt",
    total_volume: 150_292,
    avg_cycle_days: 45.3,
  },
  {
    process_id: "RTR",
    process_name: "Record-to-Report",
    status: "partial",
    completeness_score: 66.7,
    steps: [
      step(1, "Journal Entry", "BKPF", 61_884, 220, 3.0),
      step(2, "Cost Allocation", "COBK", 8_406, 64, 5.5),
      step(3, "Accruals/Deferrals", "BKPF", 0, 0, null),
      step(4, "Period Close", "BKPF", 12, 0, 4.0),
      step(5, "Reconciliation", "BSEG", 0, 0, null),
      step(6, "Reporting", "BKPF", 12, 0, null),
    ],
    exception_rate: 0.4,
    bottleneck_step: null,
    total_volume: 70_314,
    avg_cycle_days: 12.5,
  },
  {
    process_id: "MTO",
    process_name: "Maintain-to-Operate",
    status: "active",
    completeness_score: 100,
    steps: [
      step(1, "Notification", "QMEL", 3_322, 118, 2.6),
      step(2, "Maintenance Order", "AUFK", 4_390, 402, 8.9),
      step(3, "Confirmation", "AFRU", 3_904, 61, 1.2),
      step(4, "Technical Completion", "AUFK", 3_610, 22, null),
    ],
    exception_rate: 3.8,
    bottleneck_step: "Maintenance Order",
    total_volume: 15_226,
    avg_cycle_days: 12.7,
  },
  {
    process_id: "PTP_MFG",
    process_name: "Plan-to-Produce",
    status: "inactive",
    completeness_score: 0,
    steps: [
      step(1, "Demand Planning", "PBIM", 0, 0, null),
      step(2, "MRP Run", "PLAF", 0, 0, null),
      step(3, "Production Order", "AFKO", 0, 0, null),
      step(4, "Material Staging", "RESB", 0, 0, null),
      step(5, "Confirmation", "AFRU", 0, 0, null),
      step(6, "GR from Production", "MSEG", 0, 0, null),
    ],
    exception_rate: 0,
    bottleneck_step: null,
    total_volume: 0,
    avg_cycle_days: null,
  },
];

// Unit prices of the demo tenant's cost model (ZAR).
const finding = (f: Omit<AlignmentFinding, "remediation"> & { remediation?: string }): AlignmentFinding => ({ remediation: "", ...f });
const dormantBy = (module: string, type: string) => INVENTORY.filter((e) => e.module === module && e.element_type === type && e.status === "dormant").map((e) => e.element_value);
const ghost = (module: string, type: string, values = dormantBy(module, type)): AlignmentFinding =>
  finding({
    check_id: `GHOST-${module}-${type}`,
    module,
    category: "ghost",
    severity: values.length > 10 ? "medium" : "low",
    title: `${values.length} unused ${type} configurations`,
    description: `${values.length} ${type} configurations in module ${module} have zero transactions`,
    affected_elements: values,
    remediation: `Review and deactivate unused ${type} entries in ${module}`,
    estimated_impact_zar: values.length * 150,
  });

const FINDINGS: AlignmentFinding[] = [
  finding({
    check_id: "NUMBER_RANGE-FI-KR: 5100000000-51000",
    module: "FI",
    category: "number_range",
    severity: "high",
    title: "Number range 94% consumed in FI",
    description: "Number range 'KR: 5100000000-5100948211 (948212 docs, 94.8% util)' is 94% consumed — risk of system stop if exhausted",
    affected_elements: ["KR: 5100000000-5100948211 (948212 docs, 94.8% util)"],
    remediation: "Extend the number range interval in FBN1 before it is exhausted",
    estimated_impact_zar: 250_000,
  }),
  finding({
    check_id: "BOTTLENECK-PTP",
    module: "PTP",
    category: "bottleneck",
    severity: "high",
    title: "Bottleneck at Invoice Receipt in Procure-to-Pay",
    description: "Procure-to-Pay process has a bottleneck at Invoice Receipt with 3.0% exception rate",
    affected_elements: ["Invoice Receipt"],
    remediation: "Investigate and resolve bottleneck at Invoice Receipt",
    estimated_impact_zar: 4_870 * 45,
  }),
  finding({
    check_id: "BOTTLENECK-OTC",
    module: "OTC",
    category: "bottleneck",
    severity: "medium",
    title: "Bottleneck at Payment Receipt in Order-to-Cash",
    description: "Order-to-Cash process has a bottleneck at Payment Receipt with 2.2% exception rate",
    affected_elements: ["Payment Receipt"],
    remediation: "Investigate and resolve bottleneck at Payment Receipt",
    estimated_impact_zar: 2_406 * 45,
  }),
  finding({
    check_id: "SHADOW-RTR",
    module: "RTR",
    category: "shadow",
    severity: "medium",
    title: "Record-to-Report process incomplete (2 steps missing)",
    description: "Record-to-Report is missing steps: Accruals/Deferrals, Reconciliation",
    affected_elements: ["Accruals/Deferrals", "Reconciliation"],
    remediation: "Review and implement missing process steps",
    estimated_impact_zar: 2 * 25_000,
  }),
  finding({
    check_id: "CONFLICT-VENDOR-BANK",
    module: "FI",
    category: "conflict",
    severity: "critical",
    title: "Vendors share bank accounts",
    description: "14 bank accounts are held by more than one vendor (38 vendors); a duplicate payment or fraud risk",
    affected_elements: ["LFBK"],
    remediation: "Review shared bank details and block the duplicates in FK02",
    estimated_impact_zar: 14 * 18_000,
  }),
  finding({
    check_id: "ORG_GAP-PLANT-PURCH",
    module: "MM",
    category: "org_gap",
    severity: "medium",
    title: "Plant without a purchasing organisation",
    description: "Plant 1200 posts goods movements but is assigned to no purchasing organisation",
    affected_elements: ["1200"],
    remediation: "Assign plant 1200 to a purchasing organisation (OX17)",
    estimated_impact_zar: 30_000,
  }),
  finding({
    check_id: "MISMATCH-CUSTOMER-SALES-AREA",
    module: "SD",
    category: "mismatch",
    severity: "medium",
    title: "Orders in sales areas the customer is not extended to",
    description: "212 sales orders were posted for customers with no KNVV entry in the order's sales area",
    affected_elements: ["1000/10/00", "2000/10/00"],
    remediation: "Extend the customers to the sales areas they buy in (VD01)",
    estimated_impact_zar: 212 * 120,
  }),
  finding({
    check_id: "LICENCE_WASTE-PP",
    module: "PP",
    category: "licence_waste",
    severity: "medium",
    title: "Module PP has minimal usage (7 transactions)",
    description: "Module PP has only 7 transactions — potential licence waste",
    remediation: "Review whether module PP licence is still needed",
    affected_elements: [],
    estimated_impact_zar: 180_000,
  }),
  ghost("MM", "plant"),
  ghost("MM", "material_type"),
  ghost("FI", "document_type"),
  ghost("FI", "company_code"),
  ghost("SD", "sales_order_type"),
  ghost("PM", "pm_order_type"),
];

function healthScores() {
  const by = new Map<string, AlignmentFinding[]>();
  for (const f of FINDINGS) by.set(f.module, [...(by.get(f.module) ?? []), f]);
  return [...by].map(([module, fs]) => {
    const n = (s: AlignmentFinding["severity"]) => fs.filter((f) => f.severity === s).length;
    const [c, h, m, l] = [n("critical"), n("high"), n("medium"), n("low")];
    return { module, chs: Math.max(0, Math.round(100 - (c * 3 + h * 2 + m + l * 0.5))), critical_count: c, high_count: h, medium_count: m, low_count: l };
  });
}

function licence() {
  const mods = [...new Set(INVENTORY.map((e) => e.module))].sort();
  return mods.map((module) => {
    const es = INVENTORY.filter((e) => e.module === module);
    const pct = Math.round((es.filter((e) => e.transaction_count > 0).length / es.length) * 1000) / 10;
    return {
      module,
      total_config_elements: es.length,
      total_transactions: es.reduce((s, e) => s + e.transaction_count, 0),
      utilisation_pct: pct,
      status: pct > 50 ? "active" : pct > 20 ? "underutilised" : "minimal",
    };
  });
}

const MATCHES = [
  { module: "material_master", check_id: "MM-BASE-UOM", record_key: "100-0001", field: "MEINS", actual_value: "KGM", std_rule_expectation: "Base unit is a unit of measure in use", config_evidence: "KGM is not maintained as a unit of measure in this system", recommended_action: "Maintain the unit of measure, or correct the material", sap_tcode: "CUNI", classification: "config_deviation", fix_priority: 1 },
  { module: "material_master", check_id: "MM-TYPE-DEF", record_key: "100-0002", field: "MTART", actual_value: "ZSPR", std_rule_expectation: "Material type is one in use", config_evidence: "ZSPR carries no transactions in the period read", recommended_action: "Review whether the type is still wanted", sap_tcode: "OMS2", classification: "ambiguous", fix_priority: 2 },
  { module: "customer_master", check_id: "CM-PAY-TERMS", record_key: "200-0007", field: "ZTERM", actual_value: "", std_rule_expectation: "Payment terms are filled", config_evidence: "The account group requires payment terms", recommended_action: "Fill the payment terms on the record", sap_tcode: "XD02", classification: "data_error", fix_priority: 1 },
  { module: "customer_master", check_id: "CM-CO-CODE", record_key: "200-0011", field: "BUKRS", actual_value: "3000", std_rule_expectation: "Company code is active", config_evidence: "Company code 3000 carries no transactions", recommended_action: "Move the record to an active company code", sap_tcode: "XD02", classification: "data_error", fix_priority: 2 },
] as const;

export function configMatchRead(path: string, params: Record<string, unknown> = {}): unknown {
  const m = /^\/versions\/([^/]+)\/config-matches(\/summary)?$/.exec(path);
  if (!m) return NONE_CONFIG;
  if (m[2]) return { data_errors: 2, config_deviations: 1, ambiguous: 1, modules_with_deviations: ["material_master"] };
  const items = MATCHES.filter((x) => !params.classification || x.classification === params.classification);
  return { items, total: items.length, limit: 500, offset: 0 };
}

export function configDownload(path: string): { name: string; text: string } | null {
  const m = /^\/versions\/([^/]+)\/config-matches\/export$/.exec(path);
  return m ? { name: `config-${m[1].slice(0, 8)}.xlsx`, text: "Fixture stand-in for the configuration matches workbook." } : null;
}

export function configRead(path: string): unknown {
  if (!path.startsWith("/config/") || path === "/config/drift") return NONE_CONFIG;
  switch (path) {
    case "/config/health-score":
      return { run_id: RUN, scores: healthScores() };
    case "/config/inventory":
      return { run_id: RUN, total: INVENTORY.length, elements: INVENTORY };
    case "/config/processes":
      return { run_id: RUN, processes: PROCESSES };
    case "/config/alignment":
      return { run_id: RUN, total: FINDINGS.length, findings: FINDINGS, currency: "ZAR" };
    case "/config/licence-utilisation":
      return { run_id: RUN, modules: licence() };
  }
  return NONE_CONFIG;
}

export function configWrite(method: string, path: string): unknown {
  if (method === "POST" && path === "/config/discover/latest") return { queued: true, version_id: RUN };
  return NONE_CONFIG;
}
