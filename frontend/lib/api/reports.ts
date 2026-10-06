import apiClient from "./client";

export function getReportDownloadUrl(versionId: string): string {
  return `/api/v1/reports/${versionId}/download`;
}

export function getReportJsonExportUrl(versionId: string): string {
  return `/api/v1/reports/${versionId}/export.json`;
}

/* Deterministic run reports (PDF, rendered on request). */
export function getAnalysisReportUrl(versionId: string): string {
  return `/api/v1/reports/analysis/${versionId}.pdf`;
}

export function getExtractionReportUrl(versionId: string): string {
  return `/api/v1/reports/extraction/${versionId}.pdf`;
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
