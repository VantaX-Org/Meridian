/** Field profile fixture, shaped like api/routes/field_profiles.py, and POST /rules/mined from api/routes/rules.py. */
import type { Dependency, FieldStats, Profile, Severity } from "../profile";

export const NONE_PROFILE = Symbol("not a field profile path");

const S = (p: Partial<FieldStats> & Pick<FieldStats, "blank" | "distinct">): FieldStats => ({
  rows: 4120, table_rows: 4120, sampled: false, blank_pct: Math.round((p.blank / 4120) * 10000) / 100,
  min_length: null, max_length: null, ddic_type: null, ddic_length: null, description: null, numeric: null, dates: null,
  shapes: [], shape_count: 0, masked: false, mask_reason: null, top_values: null, ...p,
});

const TABLES: Profile["tables"] = [
  {
    table: "MARA", rows: 4120, table_rows: 4120, sampled: false,
    fields: [
      { field: "MATNR", stats: S({ blank: 0, distinct: 4120, min_length: 18, max_length: 18, ddic_type: "CHAR", ddic_length: 40, description: "Material number", shapes: [{ shape: "9(18)", count: 4120, share: 1 }], shape_count: 1, masked: true, mask_reason: "not_code_like" }) },
      { field: "MTART", stats: S({ blank: 0, distinct: 4, min_length: 4, max_length: 4, ddic_type: "CHAR", ddic_length: 4, description: "Material type", top_values: [{ value: "ERSA", count: 2210 }, { value: "FERT", count: 1180 }, { value: "HALB", count: 610 }, { value: "ROH", count: 120 }] }) },
      { field: "MBRSH", stats: S({ blank: 37, distinct: 3, min_length: 1, max_length: 1, ddic_type: "CHAR", ddic_length: 1, description: "Industry sector", top_values: [{ value: "M", count: 3901 }, { value: "C", count: 160 }, { value: "A", count: 22 }] }) },
      { field: "MATKL", stats: S({ blank: 412, distinct: 63, min_length: 3, max_length: 9, ddic_type: "CHAR", ddic_length: 9, description: "Material group", top_values: [{ value: "Z-PARTS", count: 1730 }, { value: "Z-HYD", count: 540 }, { value: "Z-ELEC", count: 388 }] }) },
      { field: "MEINS", stats: S({ blank: 0, distinct: 6, min_length: 2, max_length: 3, ddic_type: "UNIT", ddic_length: 3, description: "Base unit of measure", top_values: [{ value: "EA", count: 3620 }, { value: "L", count: 280 }, { value: "KG", count: 190 }] }) },
      { field: "BRGEW", stats: S({ blank: 1290, distinct: 811, ddic_type: "QUAN", ddic_length: 13, description: "Gross weight", numeric: { min: 0, max: 18450, mean: 42.7, non_numeric: 0 }, masked: true, mask_reason: "not_code_like" }) },
      { field: "ERSDA", stats: S({ blank: 0, distinct: 2902, min_length: 8, max_length: 8, ddic_type: "DATS", ddic_length: 8, description: "Created on", dates: { min: "2009-03-02", max: "2026-06-18", invalid: 0 }, masked: true, mask_reason: "not_code_like" }) },
    ],
  },
  {
    table: "MAKT", rows: 4098, table_rows: 4098, sampled: false,
    fields: [
      { field: "MAKTX", stats: S({ rows: 4098, table_rows: 4098, blank: 14, distinct: 3711, min_length: 3, max_length: 40, ddic_type: "CHAR", ddic_length: 40, description: "Material description", masked: true, mask_reason: "not_code_like" }) },
      { field: "SPRAS", stats: S({ rows: 4098, table_rows: 4098, blank: 0, distinct: 1, min_length: 1, max_length: 1, ddic_type: "LANG", ddic_length: 1, description: "Language key", top_values: [{ value: "E", count: 4098 }] }) },
    ],
  },
];

const DEPS = (): Dependency[] => [
  { table: "MARA", determinant: "MARA.MTART", dependent: "MARA.MBRSH", support: 0.9925, rows: 4083, violations: 31, sample_keys: ["MATNR=000000000000000232", "MATNR=000000000000000611", "MATNR=000000000000001044"], accepted: false },
  { table: "MARA", determinant: "MARA.MATKL", dependent: "MARA.MEINS", support: 0.981, rows: 3708, violations: 70, sample_keys: ["MATNR=000000000000000087", "MATNR=000000000000000940"], accepted: false },
  { table: "MARA", determinant: "MARA.MTART", dependent: "MARA.MEINS", support: 0.9702, rows: 4120, violations: 123, sample_keys: ["MATNR=000000000000000019"], accepted: true },
];

let deps: Dependency[] | null = null;
const state = (): Dependency[] => (deps ??= DEPS());
export const resetProfileFixture = (): void => { deps = null; };

const PROFILE = /^\/versions\/([^/]+)\/profile$/;

export function profileRead(path: string, params: Record<string, unknown>): unknown {
  const m = PROFILE.exec(path);
  if (!m) return NONE_PROFILE;
  const object = typeof params.object === "string" ? params.object : "material_master";
  const mine = object === "material_master";
  return { version_id: decodeURIComponent(m[1]), object, objects: ["material_master"], tables: mine ? TABLES : [], dependencies: mine ? state().map((d) => ({ ...d })) : [] } satisfies Profile;
}

export function profileWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || path !== "/rules/mined") return NONE_PROFILE;
  const b = body as { module: string; determinant: string; dependent: string; severity: Severity };
  const d = b.module === "material_master" ? state().find((x) => x.determinant === b.determinant && x.dependent === b.dependent) : undefined;
  if (!d) throw Object.assign(new Error("No such mined dependency"), { status: 404, response: { status: 404, data: { detail: "No such mined dependency" } } });
  d.accepted = true;
  return { id: "r-mined-1", name: `HR-1A2B3C4D: ${b.determinant} determines ${b.dependent}`, module: b.module, severity: b.severity, enabled: true };
}
