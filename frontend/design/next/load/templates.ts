/**
 * The migration templates as a table of sheets. Every number comes from the workbook's own columns (the coverage the
 * server read), never from a field list of ours: a column with no source field is "absent in source", not a guess.
 */
import type { TargetTemplate, TemplateCoverage } from "@/lib/api/v2/migration";

export type SheetStatus = "ready" | "decision" | "not-started";
export interface MissingColumn { header: string; id: string; label: string; mandatory: boolean }
export interface TemplateRow {
  name: string;
  table: string | null;
  columns: number;
  filled: number;
  missing: MissingColumn[];
  status: SheetStatus;
}

/** A sheet is ready when every column has a source field, needs a decision when some do not, not started when none do and nothing was filled yet. */
export function rowsOf(cov: TemplateCoverage | null | undefined, filledBefore: boolean): TemplateRow[] {
  return (cov?.sheets ?? []).map((s) => {
    const missing = s.unmapped;
    const status: SheetStatus = s.matched === 0 && !filledBefore ? "not-started" : missing.length > 0 ? "decision" : "ready";
    return { name: s.name, table: s.table, columns: s.columns, filled: s.matched, missing, status };
  });
}

/** The next sheet to fill: the first that is not ready, or null when all are. */
export const nextSheet = (rows: TemplateRow[]): TemplateRow | null => rows.find((r) => r.status !== "ready") ?? null;

export const filledBefore = (t: TargetTemplate) => t.last_fill_at !== null;

/** A proposal is only made when the server resolved a field; an empty id means the source has no such field. */
export const proposal = (c: MissingColumn): string | null => (c.id ? c.id : null);
export const mappingKey = (sheet: string, header: string) => `${sheet}::${header}`;
