import apiClient from "./client";
import type { UploadResponse } from "@/types/api";

/* ─── Column matching types ─── */

export interface ColumnMapping {
  source_column: string;
  target_field: string | null;
  confidence: number;
  is_required: boolean;
  match_type: string;
}

export interface MatchResponse {
  detected_module: string;
  module_confidence: number;
  module_label: string;
  mappings: ColumnMapping[];
  unmapped_required: string[];
  available_modules: { value: string; label: string }[];
}

/**
 * Send column headers + sample rows to the backend for AI-powered module
 * detection and column-to-TABLE.FIELD mapping.
 */
export async function matchColumns(
  headers: string[],
  sampleRows: string[][],
  filename: string,
  moduleHint?: string
): Promise<MatchResponse> {
  const { data } = await apiClient.post<MatchResponse>(
    "/api/v1/upload/match",
    {
      headers,
      sample_rows: sampleRows,
      filename,
      module_hint: moduleHint ?? null,
    },
    { timeout: 120_000 } // 2 min — LLM column matching can be slow with local models
  );
  return data;
}

/* ─── File upload ─── */

export async function uploadFile(
  file: File,
  module: string,
  columnMapping: Record<string, string> | null,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("module", module);
  if (columnMapping) {
    form.append("column_mapping", JSON.stringify(columnMapping));
  }

  const { data } = await apiClient.post<UploadResponse>(
    "/api/v1/upload",
    form,
    {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 300_000, // 5 min for large uploads
      signal,
      onUploadProgress: (e) => {
        if (e.total) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    }
  );
  return data;
}

/* ─── Analysis progress polling ─── */

export interface AnalysisStatusProgress {
  current_step: string;
  step_number: number;
  total_steps: number;
  rows_processed: number;
  total_rows: number;
  percent_complete: number;
}

export interface AnalysisStatusResponse {
  task_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: AnalysisStatusProgress;
  result: {
    version_id: string;
    status: string;
    dqs_summary: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
  } | null;
  error: string | null;
  db_status: string;
}

/**
 * Fetch the current analysis status for a version. Returns rich progress info
 * from Redis, with a DB fallback — always completes instantly.
 */
export async function getAnalysisStatus(
  versionId: string,
): Promise<AnalysisStatusResponse> {
  const { data } = await apiClient.get<AnalysisStatusResponse>(
    `/api/v1/analysis/status/${versionId}`,
    { timeout: 15_000 },
  );
  return data;
}

export interface PollOptions {
  pollIntervalMs?: number;
  maxPollTimeMs?: number;
  signal?: AbortSignal;
  onError?: (err: unknown) => void;
}

/**
 * Poll the analysis status endpoint until the job reaches a terminal state.
 *
 * Key properties:
 *  - Transient network errors are swallowed and retried — a single failed poll
 *    will not crash the flow.
 *  - Respects an AbortSignal for clean teardown on unmount / cancel.
 *  - Uses a generous 30-minute ceiling so large jobs on slow hardware finish.
 */
export async function pollAnalysisStatus(
  versionId: string,
  onProgress: (data: AnalysisStatusResponse) => void,
  options: PollOptions = {},
): Promise<AnalysisStatusResponse> {
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const maxPollTimeMs = options.maxPollTimeMs ?? 30 * 60 * 1_000;
  const start = Date.now();
  let lastSeen: AnalysisStatusResponse | null = null;

  while (Date.now() - start < maxPollTimeMs) {
    if (options.signal?.aborted) {
      throw new DOMException("Polling aborted", "AbortError");
    }

    try {
      const data = await getAnalysisStatus(versionId);
      lastSeen = data;
      onProgress(data);
      if (data.status === "completed" || data.status === "failed") {
        return data;
      }
    } catch (err) {
      // Network blip or transient 5xx — retry on next tick.
      options.onError?.(err);
      console.warn("Analysis status poll failed, retrying...", err);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (lastSeen) {
    // Return last-known status rather than crashing — UI can decide how to
    // surface the timeout to the user.
    return {
      ...lastSeen,
      status: "failed",
      error: "Analysis timed out after 30 minutes",
    };
  }
  throw new Error("Analysis status polling timed out after 30 minutes");
}
