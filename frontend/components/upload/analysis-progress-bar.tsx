"use client";

import { AlertTriangle, CheckCircle, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export interface AnalysisProgress {
  current_step: string;
  step_number: number;
  total_steps: number;
  rows_processed: number;
  total_rows: number;
  percent_complete: number;
}

export interface AnalysisStatusData {
  task_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: AnalysisProgress;
  result?: unknown;
  error?: string | null;
  db_status?: string;
}

interface Props {
  data: AnalysisStatusData | null;
  elapsedSeconds: number;
  fileName?: string;
}

/**
 * Rich progress bar for long-running analysis jobs. Consumes the payload from
 * GET /api/v1/analysis/status/{version_id} and renders a step label, animated
 * bar, row counters, elapsed time, and a rough ETA.
 */
export function AnalysisProgressBar({ data, elapsedSeconds, fileName }: Props) {
  if (!data) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>Connecting to analysis service...</span>
        </div>
        <ProgressTrack value={0} state="queued" />
      </div>
    );
  }

  const { status, progress, error } = data;
  const isQueued = status === "queued";
  const isProcessing = status === "processing";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";

  const displayPercent = clamp(
    Math.round(progress.percent_complete || 0),
    isQueued ? 5 : 0,
    100,
  );

  const eta = estimateRemaining(elapsedSeconds, progress.percent_complete);

  const heading = isFailed
    ? "Analysis failed"
    : isCompleted
      ? "Analysis complete"
      : progress.current_step || (isQueued ? "Queued for analysis..." : "Processing...");

  const Icon = isCompleted
    ? CheckCircle
    : isFailed
      ? AlertTriangle
      : Loader2;

  const iconClass = isCompleted
    ? "text-green-600"
    : isFailed
      ? "text-red-600"
      : "animate-spin text-primary";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={cn("h-4 w-4 shrink-0", iconClass)} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{heading}</p>
            {fileName && (
              <p className="truncate text-xs text-muted-foreground">{fileName}</p>
            )}
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          Step {clamp(progress.step_number || 1, 1, progress.total_steps || 6)} /{" "}
          {progress.total_steps || 6}
        </span>
      </div>

      <ProgressTrack value={displayPercent} state={status} />

      <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>{displayPercent}%</span>
        {progress.total_rows > 0 ? (
          <span>
            {progress.rows_processed.toLocaleString()} /{" "}
            {progress.total_rows.toLocaleString()} rows
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
        <span>Elapsed: {formatTime(elapsedSeconds)}</span>
        {eta && (isProcessing || isQueued) && <span>{eta}</span>}
      </div>

      {isFailed && error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {(isProcessing || isQueued) && (
        <p className="text-xs text-muted-foreground">
          Analysis runs in the background — you can safely navigate away and
          return to this page later.
        </p>
      )}
    </div>
  );
}

/* ─── Internals ─── */

interface TrackProps {
  value: number;
  state: AnalysisStatusData["status"];
}

function ProgressTrack({ value, state }: TrackProps) {
  const fillColor =
    state === "failed"
      ? "bg-red-500"
      : state === "completed"
        ? "bg-green-500"
        : "bg-primary";

  const pulse = state === "queued" ? "animate-pulse" : "";

  return (
    <div className="relative h-3 w-full overflow-hidden rounded-full bg-black/[0.06]">
      <div
        className={cn(
          "h-full rounded-full shadow-[0_0_8px_rgba(0,212,170,0.30)] transition-[width] duration-500 ease-out",
          fillColor,
          pulse,
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function estimateRemaining(elapsed: number, percent: number): string | null {
  if (!percent || percent < 3 || elapsed < 5) return null;
  const totalEstimate = (elapsed / percent) * 100;
  const remaining = totalEstimate - elapsed;
  if (remaining < 5) return null;
  if (remaining < 60) return `~${Math.round(remaining)}s remaining`;
  return `~${Math.round(remaining / 60)}m remaining`;
}
