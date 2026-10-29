import { labelOf } from "@/lib/format";
import type { Job, JobKind } from "@/types/jobs";

/** Present participle, for the job line: "Extracting Material master 42%". */
const DOING: Record<JobKind, string> = {
  extraction: "Extracting",
  config_sync: "Loading configuration of",
  config_load: "Loading configuration of",
  analysis: "Analysing",
  upload: "Checking the upload of",
  simulation: "Simulating fixes for",
  process_discovery: "Discovering processes in",
};

/** Noun, for tables and the inspector title. */
export const JOB_KIND_LABEL: Record<JobKind, string> = {
  extraction: "Extraction",
  config_sync: "Configuration sync",
  config_load: "Configuration load",
  analysis: "Analysis",
  upload: "Upload",
  simulation: "Simulation",
  process_discovery: "Process discovery",
};

export const JOB_STATUS_LABEL: Record<Job["status"], string> = { queued: "Queued", running: "Running", completed: "Done", failed: "Failed" };

/** What the job works on: the object when it names one, several objects counted, else its own label. */
export function jobObject(job: Job): string {
  const mods = job.modules ?? [];
  if (mods.length === 1) return labelOf(mods[0]);
  if (mods.length === 2 || mods.length === 3) return mods.map(labelOf).join(", ");
  if (mods.length > 3) return `${mods.length} objects`;
  const stripped = job.label.replace(/^[A-Za-z ]+\|\s*/, "");
  return stripped || job.label;
}

/** "Extracting Material master", the words of the job line without the percent. */
export function jobDoing(job: Job): string {
  return `${DOING[job.kind] ?? "Running"} ${jobObject(job)}`;
}

/** Seconds a job took (or has taken so far), or null when it has not started. */
export function jobSeconds(job: Job, nowSeconds = Math.floor(Date.now() / 1000)): number | null {
  if (!job.started_at) return null;
  return Math.max(0, Math.round((job.finished_at ?? nowSeconds) - job.started_at));
}

/** The first sentence of an error, kept short enough for one line. */
export function firstSentence(text: string | null | undefined, max = 120): string {
  if (!text) return "";
  const one = text.split(/(?<=[.!?])\s/)[0].trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** The permission the retry route asks for, by kind (api/routes/jobs.py RETRY). */
export function retryPermission(kind: JobKind): string {
  return kind === "analysis" ? "analyse" : kind === "process_discovery" ? "run_process_discovery" : "trigger_sync";
}

/** Failed jobs worth a line in the status strip: the newest failure per system that no later success replaced. */
export function openFailures(jobs: readonly Job[]): Job[] {
  const failed = jobs.filter((j) => j.status === "failed");
  return failed
    .filter((f) => !jobs.some((j) => j.id !== f.id && j.status === "completed" && j.system_id === f.system_id && j.kind === f.kind && (j.finished_at ?? 0) > (f.finished_at ?? f.started_at)))
    .sort((a, b) => (b.finished_at ?? b.started_at) - (a.finished_at ?? a.started_at));
}
