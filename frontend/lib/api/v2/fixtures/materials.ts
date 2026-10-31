/**
 * Material 360 fixture: one ECC finished part at two plants, shaped like api/routes/materials.py. Any other material
 * is refused with 404, as the route refuses a material that is not in MARA.
 */
import type { CellState, Duplicates, Material360, MaterialFindings, Supersession } from "../materials";

export const NONE_MATERIALS = Symbol("not a materials path");

const M = "000000000010004711";

function refuse(detail: string, code = 404): never {
  throw Object.assign(new Error(detail), { status: code, response: { status: code, data: { detail } } });
}

const LEVELS: Material360["levels"] = [
  { id: "client", kind: "client" },
  { id: "plant:1000", kind: "plant", plant: "1000" },
  { id: "plant:2000", kind: "plant", plant: "2000" },
  { id: "sales:1000/10", kind: "sales" },
  { id: "valuation:1000", kind: "valuation" },
  { id: "sloc:1000/0001", kind: "sloc", plant: "1000" },
];

// One letter per level above: o ok, m missing, a not applicable, n the level does not carry the view.
const MATRIX: [string, string, boolean | null, string][] = [
  ["basic_data", "Basic data", true, "onnnnn"],
  ["classification", "Classification", false, "annnnn"],
  ["sales", "Sales", true, "nnnonn"],
  ["purchasing", "Purchasing", true, "nomnnn"],
  ["mrp", "MRP", true, "noonnn"],
  ["work_scheduling", "Work scheduling", false, "naannn"],
  ["storage", "Storage", true, "nomnno"],
  ["quality", "Quality", null, "naannn"],
  ["accounting", "Accounting", true, "nnnnmn"],
];
const STATE: Record<string, CellState> = { o: "ok", m: "missing", a: "na", n: "none" };

const material = (): Material360 => ({
  matnr: M, description: "Hydraulic pump seal kit", language: "EN",
  mara: { MATNR: M, MTART: "FERT", MATKL: "P-SEAL", MEINS: "EA", BRGEW: "1.2", NTGEW: "1.1" },
  marc: [{ WERKS: "1000", DISMM: "PD" }, { WERKS: "2000", DISMM: "ND" }],
  mbew: [{ BWKEY: "1000", BKLAS: "" }],
  mvke: [{ VKORG: "1000", VTWEG: "10" }],
  mard: [{ WERKS: "1000", LGORT: "0001" }],
  labels: { MTART: "Finished product", MATKL: "Seals and gaskets", MEINS: "Each" },
  expected_known: true,
  levels: LEVELS, levels_total: LEVELS.length,
  views: MATRIX.map(([view, label, expected, s]) => ({
    view, label, expected, cells: LEVELS.map((l, i) => ({ level: l.id, state: STATE[s[i]] })),
  })),
  phasing: { plants: 2, phasing_out: 1, with_followup: 1, plant: "1000", ausdt: "2026-12-31", nfmat: "000000000010004799", followup_description: "Hydraulic pump seal kit, revised" },
  version_id: "run-30",
});

const findings = (): MaterialFindings => ({
  matnr: M, version_id: "run-30", rules_total: 214,
  by_view: [
    { view: "accounting", label: "Accounting", rules: 31, passing_count: 30, not_evaluated: [], failing: [
      { check_id: "MM142", message: "Valuation class is blank for a valuated material type", severity: "critical", field: "MBEW.BKLAS", level: "valuation:1000", actual_value: null, record_key: M, issue_id: "issue-1", issue_status: "open" },
    ] },
    { view: "mrp", label: "MRP", rules: 44, passing_count: 42, not_evaluated: [], failing: [
      { check_id: "MM549", message: "Follow-up material has MRP type ND, so it is not planned", severity: "high", field: "MARC.DISMM", level: "plant:1000", actual_value: "ND", record_key: `${M}/1000`, issue_id: null, issue_status: null },
      { check_id: "MM061", message: "MRP type is set but no MRP controller is assigned", severity: "high", field: "MARC.DISPO", level: "plant:1000", actual_value: null, record_key: `${M}/1000`, issue_id: null, issue_status: null },
    ] },
    { view: "basic_data", label: "Basic data", rules: 87, passing_count: 87, not_evaluated: [], failing: [] },
    { view: "quality", label: "Quality", rules: 12, passing_count: 0, not_evaluated: ["QMAT"], failing: [] },
  ],
});

const supersession = (): Supersession => ({
  matnr: M,
  plants: [{
    werks: "1000", kzaus: "1", ausdt: "2026-12-31", links: 1, loop_at: null, dead_end: true, truncated: false, depth: 3,
    chain: [
      { matnr: M, maktx: "Hydraulic pump seal kit", this: true, dismm: "PD", mmsta: null, kzaus: "1", ausdt: "2026-12-31", nfmat: "000000000010004799", flags: [] },
      { matnr: "000000000010004799", maktx: "Hydraulic pump seal kit, revised", this: false, dismm: "ND", mmsta: null, kzaus: "1", ausdt: null, nfmat: null, flags: ["MM549", "MM550"] },
    ],
  }],
  bom_usage: [{ stlnr: "00004512", posnr: "0020", werks: "1000", nfeag: null, nfgrp: null, flags: ["MM560"] }],
});

const duplicates = (): Duplicates => ({
  matnr: M, algorithm: "token_sort_ratio", threshold: 85, source: "MARA",
  items: [
    { matnr: "000000000010004712", maktx: "HYDRAULIC PUMP SEAL KIT", mtart: "FERT", matkl: "P-SEAL", meins: "EA", ean11: null, matches_on: ["Description 87 %"], score: 87 },
    { matnr: "000000000010006640", maktx: "Seal kit, hydraulic pump", mtart: "HAWA", matkl: "P-SEAL", meins: "EA", ean11: "4006381333931", matches_on: ["EAN same"], score: 100 },
  ],
});

export function materialsRead(path: string): unknown {
  const m = /^\/materials\/([^/]+)(\/findings|\/supersession|\/duplicates)?$/.exec(path);
  if (!m) return NONE_MATERIALS;
  const key = decodeURIComponent(m[1]).trim();
  // The route normalises the number: leading zeros may be left off.
  if (key.padStart(18, "0") !== M) refuse("Material not found");
  if (m[2] === "/findings") return findings();
  if (m[2] === "/supersession") return supersession();
  if (m[2] === "/duplicates") return duplicates();
  return material();
}
