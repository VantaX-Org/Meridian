/**
 * Load simulation fixture, shaped like GET /migration/runs/{id}/load-simulation on the bundled S/4HANA dictionary.
 * Fields, check tables and texts are the dictionary's; the record keys, values and counts are synthetic.
 */
import type { LoadSimulation } from "../load-simulation";

export const NONE_LOAD_SIMULATION = Symbol("not a load simulation path");

const SIM: LoadSimulation = {
  run_id: "mig-0002", release: "s4hana", target_connected: true,
  totals: { records: 48_210, would_load: 42_139, would_fail: 6_071, provisional: 1_327 },
  objects: [
    { module: "material_master", label: "Material master", records: 31_500, would_load: 27_184, would_fail: 4_316, provisional: 0, tables: ["MAKT", "MARA"], structural: 1, messages: 4 },
    { module: "business_partner", label: "Business partner", records: 16_710, would_load: 14_955, would_fail: 1_755, provisional: 1_327, tables: ["ADRC", "BUT000"], structural: 0, messages: 2 },
  ],
  groups: [
    { module: "material_master", dest_table: "MARA", field: "ZZOLD", gap_type: "obsolete_target", rule: null, severity: "critical", records: 0, findings: 1, structural: true, provisional: false, message: "Field MARA-ZZOLD does not exist in the target", field_text: null, check_table: null, values: [], samples: [] },
    { module: "material_master", dest_table: "MARA", field: "MTART", gap_type: "value_unmapped", rule: null, severity: "critical", records: 2_904, findings: 3_120, structural: false, provisional: false, message: "No value mapping for 'ZROH' in field MARA-MTART (+1 more values)", field_text: "Material type", check_table: null, values: [{ value: "ZROH", records: 2_293 }, { value: "ZFRT", records: 611 }], samples: ["000000000010004711", "000000000010004712", "000000000010004713"] },
    { module: "business_partner", dest_table: "BUT000", field: "PARTNER", gap_type: "key_collision", rule: null, severity: "critical", records: 428, findings: 428, structural: false, provisional: false, message: "Duplicate key BUT000-PARTNER in the load file", field_text: "Business Partner Number", check_table: null, values: [], samples: ["0000100234", "0000100235"] },
    { module: "material_master", dest_table: "MAKT", field: "MAKTX", gap_type: "length_truncation", rule: null, severity: "high", records: 1_412, findings: 1_412, structural: false, provisional: false, message: "Field MAKT-MAKTX too long: CHAR 40", field_text: "Material description", check_table: null, values: [], samples: ["000000000010009001", "000000000010009002"] },
    { module: "material_master", dest_table: "MARA", field: "MEINS", gap_type: "check_table_value", rule: null, severity: "high", records: 96, findings: 96, structural: false, provisional: false, message: "Value 'STK' not allowed for field MARA-MEINS (check table T006)", field_text: "Base Unit of Measure", check_table: "T006", values: [{ value: "STK", records: 96 }], samples: ["000000000010007001"] },
    { module: "business_partner", dest_table: "ADRC", field: "COUNTRY", gap_type: "check_table_value", rule: null, severity: "medium", records: 1_327, findings: 1_327, structural: false, provisional: true, message: "Value 'UK' not allowed for field ADRC-COUNTRY (check table T005) (+1 more values)", field_text: "Country Key", check_table: "T005", values: [{ value: "UK", records: 1_310 }, { value: "EL", records: 17 }], samples: ["0000100871", "0000100872", "0000100873"] },
  ],
  transports: [
    { module: "material_master", check_table: "T006", check_table_text: "Units of Measurement", field: "MARA-MEINS", field_text: "Base Unit of Measure", provisional: false, records: 96, values: [{ value: "STK", records: 96 }] },
    { module: "business_partner", check_table: "T005", check_table_text: "Countries", field: "ADRC-COUNTRY", field_text: "Country Key", provisional: true, records: 1_327, values: [{ value: "UK", records: 1_310 }, { value: "EL", records: 17 }] },
  ],
};

export function loadSimulationRead(path: string): unknown {
  const m = /^\/migration\/runs\/([^/]+)\/load-simulation$/.exec(path);
  if (!m) return NONE_LOAD_SIMULATION;
  if (m[1] === SIM.run_id) return SIM;
  return { ...SIM, run_id: m[1], objects: [], groups: [], transports: [], totals: { records: 0, would_load: 0, would_fail: 0, provisional: 0 } } satisfies LoadSimulation;
}
