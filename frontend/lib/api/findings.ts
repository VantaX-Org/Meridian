import apiClient from "./client";
import type { FindingList, FindingReportContext } from "@/types/api";

export async function getFindings(params: {
  version_id?: string;
  module?: string;
  severity?: string;
  dimension?: string;
  check_id?: string;
  limit?: number;
  offset?: number;
}): Promise<FindingList> {
  const { data } = await apiClient.get<FindingList>("/api/v1/findings", {
    params,
  });
  return data;
}

export async function getFindingReportContext(
  findingId: string,
): Promise<FindingReportContext> {
  const { data } = await apiClient.get<FindingReportContext>(
    `/api/v1/findings/${findingId}/report-context`,
  );
  return data;
}

/** GET /api/v1/findings/aggregate — server-side totals + composite DQS (see api/routes/findings.py). */
export interface FindingsAggregate {
  version_ids: string[];
  total: number;
  affected_records: number;
  severity: { critical: number; high: number; medium: number; low: number };
  by_module: { module: string; findings: number; affected: number; critical: number; high: number; medium: number;
    low: number; avg_pass_rate: number | null }[];
  by_dimension: { dimension: string; findings: number; avg_pass_rate: number | null }[];
  dqs: { composite: number | null; dimension_scores: Record<string, number>; modules: Record<string, number>; capped?: boolean };
  previous_dqs: number | null;
}

export async function getFindingsAggregate(versionId?: string): Promise<FindingsAggregate> {
  const { data } = await apiClient.get<FindingsAggregate>("/api/v1/findings/aggregate", {
    params: versionId ? { version_id: versionId } : undefined,
  });
  return data;
}

/** Same weighting as the backend composite: module scores weighted by their check count. */
export function compositeDqs(summary: Record<string, { composite_score: number; total_checks?: number }> | null | undefined): number | null {
  const mods = Object.values(summary ?? {}).filter((m) => typeof m?.composite_score === "number");
  if (!mods.length) return null;
  const w = mods.map((m) => Math.max(1, m.total_checks ?? 1));
  const total = w.reduce((a, b) => a + b, 0);
  return Math.round((mods.reduce((a, m, i) => a + m.composite_score * w[i], 0) / total) * 100) / 100;
}

/** A user's named filter set for one page, stored server-side. */
export interface SavedView {
  id: string;
  name: string;
  filters: Record<string, string>;
  created_at: string;
}

export async function listSavedViews(route: string): Promise<SavedView[]> {
  const { data } = await apiClient.get<{ views: SavedView[] }>("/api/v1/saved-views", { params: { route } });
  return data.views;
}

/** Create, or overwrite by name. */
export async function saveNamedView(route: string, name: string, filters: Record<string, string>): Promise<SavedView> {
  const { data } = await apiClient.post<SavedView>("/api/v1/saved-views", { route, name, filters });
  return data;
}

export async function deleteSavedView(id: string): Promise<void> {
  await apiClient.delete(`/api/v1/saved-views/${id}`);
}
