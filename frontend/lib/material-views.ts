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
