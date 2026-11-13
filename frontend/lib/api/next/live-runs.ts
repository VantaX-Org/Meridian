/**
 * Live progress of in-flight runs (api/routes/jobs.py, api/services/run_progress.py).
 *   GET /jobs/active/progress   queued and running jobs, plus those finished in the last two minutes
 *   GET /jobs/{id}/progress     one job, also after it finished
 * A percent is present only where done and total are both known; null means indeterminate, never zero.
 */
import { useQuery } from "@tanstack/react-query";
import { v2Get } from "@/lib/api/v2/client";
import type { JobKind, JobStageStatus, JobStatus } from "@/types/jobs";

export type LiveState = JobStatus | "stalled";

export interface LiveStep {
  unit: "rows" | "tables" | "rules" | null;
  done: number;
  total: number | null;
  pct: number | null;
  rows?: number;
}

export interface LivePart {
  name: string;
  state: "queued" | "running" | "failed" | "done";
  status: string;
  done: number;
  total: number | null;
  pct: number | null;
}

export interface RunProgress {
  id: string;
  kind: JobKind;
  label: string;
  status: JobStatus;
  state: LiveState;
  pct: number | null;
  determinate: boolean;
  stage: string | null;
  stage_index: number | null;
  stage_count: number;
  stages: { id: string; label: string; status: JobStageStatus }[];
  step: LiveStep;
  parts: LivePart[];
  rows: number;
  rows_per_min: number | null;
  elapsed_s: number;
  idle_s: number;
  eta_s: number | null;
  eta_is_estimate: boolean;
  message: string;
  error: string | null;
  started_at: number | null;
  updated_at: number | null;
  finished_at: number | null;
  queue_position: number | null;
  system_id: string | null;
  version_id: string | null;
  modules: string[];
}

export const getActiveProgress = () => v2Get<{ runs: RunProgress[] }>("/jobs/active/progress");
export const getRunProgress = (id: string) => v2Get<RunProgress>(`/jobs/${encodeURIComponent(id)}/progress`);

export const LIVE_RUNS_KEY = ["live-runs"] as const;
const FAST = 3_000;
const IDLE = 15_000;
const SAMPLES = 30;
const ACTIVE = new Set(["queued", "running"]);

/** Rows per minute between consecutive observed samples, oldest first. Samples at the same server time count once. */
export function ratesOf(samples: readonly { t: number; rows: number }[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt > 0) out.push(Math.max(0, ((samples[i].rows - samples[i - 1].rows) * 60) / dt));
  }
  return out;
}

// Samples this tab observed, per run. Filled when a poll lands (not during render); runs that left the list are dropped.
const samples = new Map<string, { t: number; rows: number }[]>();

async function fetchLive(): Promise<{ runs: RunProgress[]; rates: Map<string, number[]> }> {
  const { runs } = await getActiveProgress();
  const rates = new Map<string, number[]>();
  const seen = new Set(runs.map((r) => r.id));
  for (const id of [...samples.keys()]) if (!seen.has(id)) samples.delete(id);
  for (const r of runs) {
    const list = samples.get(r.id) ?? [];
    const t = r.updated_at ?? 0;
    if (t && (!list.length || list[list.length - 1].t < t)) list.push({ t, rows: r.rows });
    samples.set(r.id, list.slice(-SAMPLES));
    rates.set(r.id, ratesOf(samples.get(r.id) ?? []));
  }
  return { runs, rates };
}

const NO_RUNS: RunProgress[] = [];
const NO_RATES = new Map<string, number[]>();

/**
 * The live runs, polled every 3 s while any is active and every 15 s otherwise. react-query stops the interval while
 * the tab is hidden and refetches on focus. Each run carries the rows-per-minute series observed by this tab.
 */
export function useLiveRuns() {
  const q = useQuery({
    queryKey: LIVE_RUNS_KEY,
    queryFn: fetchLive,
    refetchInterval: (query) => ((query.state.data?.runs ?? []).some((r) => ACTIVE.has(r.status)) ? FAST : IDLE),
    refetchIntervalInBackground: false,
    retry: false,
  });
  return { ...q, runs: q.data?.runs ?? NO_RUNS, rates: q.data?.rates ?? NO_RATES };
}
