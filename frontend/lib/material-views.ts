/**
 * Material 360 vocabulary: the MM01 view-status letters (DDIC domain PSTAT_D, as held in MARA.VPSTA and
 * MARC.PSTAT) and the matrix rows they belong to. The rule-to-view map is the API's
 * (checks/views/material_master.yaml); these are display names only.
 */
import type { MaterialLevel } from "@/lib/api/materials";

export type MatrixViewId =
  | "basic_data" | "classification" | "sales" | "purchasing" | "mrp" | "work_scheduling" | "storage" | "quality" | "accounting";

export const PSTAT_VIEWS: Readonly<Record<string, { view: MatrixViewId; label: string }>> = {
  K: { view: "basic_data", label: "Basic data" },
  C: { view: "classification", label: "Classification" },
  V: { view: "sales", label: "Sales" },
  E: { view: "purchasing", label: "Purchasing" },
  D: { view: "mrp", label: "MRP data" },
  P: { view: "mrp", label: "MRP forecast" },
  A: { view: "work_scheduling", label: "Work scheduling" },
  L: { view: "storage", label: "Storage" },
  S: { view: "storage", label: "Warehouse management" },
  X: { view: "storage", label: "Storage, plant stocks" },
  Z: { view: "storage", label: "Storage, storage location stocks" },
  Q: { view: "quality", label: "Quality management" },
  B: { view: "accounting", label: "Accounting" },
  G: { view: "accounting", label: "Costing" },
};

/** The matrix cap: more levels than this and the page asks for a plant filter. */
export const MAX_LEVELS = 12;

const KIND: Record<string, string> = {
  client: "Client", plant: "Plant", sales: "Sales org", valuation: "Valuation area", sloc: "Storage location", warehouse: "Warehouse",
};

/** "plant:1000" to "Plant 1000"; "sales:2000/10" to "Sales org 2000, channel 10". */
export function levelLabel(id: string): string {
  const [kind, code = ""] = id.split(":");
  if (kind === "client") return "Client";
  if (kind === "sales") {
    const [org, ch] = code.split("/");
    return ch ? `${KIND.sales} ${org}, channel ${ch}` : `${KIND.sales} ${org}`;
  }
  if (kind === "sloc") return `${KIND.sloc} ${code.replace("/", " ")}`;
  return `${KIND[kind] ?? kind} ${code}`;
}

/** Columns the matrix shows, and the sentence that explains a cut. */
export function matrixColumns(levels: readonly MaterialLevel[], total: number): { shown: MaterialLevel[]; note: string | null } {
  const shown = levels.slice(0, MAX_LEVELS);
  return { shown, note: total > shown.length ? `${shown.length} of ${total} levels; filter by plant to see the rest` : null };
}

/** Failing, passing and not evaluated, summed over the views: always the enabled rule count. */
export function sumRuleCounts(by: ReadonlyArray<{ failing: readonly unknown[]; passing_count: number; not_evaluated: readonly unknown[] }>) {
  const failing = by.reduce((n, v) => n + v.failing.length, 0);
  const passing = by.reduce((n, v) => n + v.passing_count, 0);
  const notEvaluated = by.reduce((n, v) => n + v.not_evaluated.length, 0);
  return { failing, passing, notEvaluated, total: failing + passing + notEvaluated };
}

/** Link to Material 360 for a material_master record key such as `MATNR=000000000000000101|WERKS=1000`. */
export function materialHref(module: string, recordKey: string | null | undefined): string | null {
  if (module !== "material_master" || !recordKey) return null;
  const m = /(?:^|\|)MATNR=([^|]+)/.exec(recordKey);
  return m ? `/analyse/material/${encodeURIComponent(m[1])}` : null;
}

/**
 * The 13 material master maintenance views (MM01/MM02), each with the tables its rules anchor on.
 * Mirrors checks/views/material_master.yaml; the API holds the authoritative rule-to-view assignment.
 */
export interface MmView {
  id: string;
  label: string;
  tables: readonly string[];
  transaction?: string;
}

export const MM_VIEWS: readonly MmView[] = [
  { id: "basic_data", label: "Basic data and descriptions", tables: ["MARA", "MAKT", "MEAN", "MARC"], transaction: "MM02" },
  { id: "classification", label: "Classification", tables: ["KLAH", "CABN", "AUSP", "KSSK", "INOB", "CAWN"], transaction: "CL20N" },
  { id: "sales", label: "Sales", tables: ["MVKE", "MLAN", "MARC"], transaction: "MM02" },
  { id: "purchasing", label: "Purchasing and foreign trade", tables: ["MARC", "MARA", "EINE", "EINA"], transaction: "MM02" },
  { id: "mrp", label: "MRP", tables: ["MARC", "MDMA"], transaction: "MM02" },
  { id: "work_scheduling", label: "Work scheduling and production", tables: ["MARC", "MKAL", "MAST", "MAPL"], transaction: "MM02" },
  { id: "storage", label: "Storage and warehouse", tables: ["MARD", "MLGN", "MLGT"], transaction: "MM02" },
  { id: "quality", label: "Quality (MM view level)", tables: ["QMAT", "MARC"], transaction: "MM02" },
  { id: "accounting", label: "Accounting and costing", tables: ["MBEW", "CKMLHD"], transaction: "MM02" },
  { id: "batch", label: "Batch management", tables: ["MCH1"], transaction: "MSC2N" },
  { id: "units", label: "Units of measure", tables: ["MARM", "MEAN"], transaction: "MM02" },
  { id: "supersession", label: "Supersession and discontinuation", tables: ["MARC", "STPO", "MBEW"], transaction: "MM02" },
  { id: "lifecycle", label: "Lifecycle and cross-level", tables: ["MARC", "MARD", "MARA", "MLGN", "MLGT"], transaction: "MM02" },
];
