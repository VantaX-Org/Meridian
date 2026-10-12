import apiClient from "./client";

export function getReportDownloadUrl(versionId: string): string {
  return `/api/v1/reports/${versionId}/download`;
}

export function getReportJsonExportUrl(versionId: string): string {
  return `/api/v1/reports/${versionId}/export.json`;
}

/** The home page's executive summary PDF for the latest run. */
export function getExecutiveReportUrl(versionId: string): string {
  return `/api/v1/reports/executive/${versionId}.pdf`;
}

/* Deterministic run reports (PDF, rendered on request). */
export function getAnalysisReportUrl(versionId: string): string {
  return `/api/v1/reports/analysis/${versionId}.pdf`;
}

export function getExtractionReportUrl(versionId: string): string {
  return `/api/v1/reports/extraction/${versionId}.pdf`;
}

/** One object's rules and fields for one run, rendered on request. */
export function getObjectReportUrl(versionId: string, module: string): string {
  return `/api/v1/reports/object/${versionId}/${encodeURIComponent(module)}.pdf`;
}

/** One record's fix sheet for one run, rendered on request. */
export function getRecordReportUrl(versionId: string, matnr: string): string {
  return `/api/v1/reports/record/${versionId}/${encodeURIComponent(matnr)}.pdf`;
}

/** Without a version: cleaning and fixes across the whole organisation. */
export function getCleaningReportUrl(versionId?: string): string {
  return versionId ? `/api/v1/reports/cleaning.pdf?version_id=${versionId}` : "/api/v1/reports/cleaning.pdf";
}

/** v1 defaults to the pinned baseline, else the previous run of the same system. */
export function getComparisonReportUrl(v2: string, v1?: string): string {
  const q = new URLSearchParams({ v2, ...(v1 ? { v1 } : {}) });
  return `/api/v1/reports/compare.pdf?${q.toString()}`;
}

/** One entry of the report catalogue. `url` is null while a required input is missing or no run is chosen. */
export interface CatalogueEntry {
  id: string;
  name: string;
  format: "PDF" | "XLSX" | "JSON";
  about: string;
  sections: string[];
  page_estimate: number;
  requires: string[];
  url: string | null;
  last_built_at: string | null;
}

export async function getReportCatalogue(params: { version_id?: string; module?: string; compare?: string }): Promise<CatalogueEntry[]> {
  const { data } = await apiClient.get<CatalogueEntry[]>("/api/v1/reports/catalogue", { params });
  return data;
}

/** The analyst workbook for one run, optionally for one module and against an earlier run. */
export function getWorkbookUrl(versionId: string, opts?: { module?: string; compare?: string }): string {
  const q = new URLSearchParams();
  if (opts?.module) q.set("module", opts.module);
  if (opts?.compare) q.set("compare", opts.compare);
  const qs = q.toString();
  return `/api/v1/reports/${versionId}/workbook.xlsx${qs ? `?${qs}` : ""}`;
}

/** The board pack. Deltas are against `compare` only. */
export function getBoardReportUrl(versionId: string, compare?: string): string {
  return `/api/v1/reports/board/${versionId}.pdf${compare ? `?compare=${compare}` : ""}`;
}

export async function pollVersionStatus(
  versionId: string,
  onUpdate: (status: string) => void,
  timeoutMs: number = 600_000
): Promise<string> {
  const start = Date.now();
  const TERMINAL = new Set([
    "complete",
    "agents_complete",
    "failed",
    "agents_failed",
    "ai_enriching",
    "ai_enriched",
  ]);

  while (Date.now() - start < timeoutMs) {
    const { data } = await apiClient.get<{ status: string }>(
      `/api/v1/versions/${versionId}/status`
    );
    onUpdate(data.status);
    if (TERMINAL.has(data.status)) {
      return data.status;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error("Polling timed out");
}
