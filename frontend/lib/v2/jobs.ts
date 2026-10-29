import { labelOf } from "@/lib/format";
import type { Job, JobKind } from "@/types/jobs";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";

/** Present participle, for the job line: "Extracting Material master 42%". */
const DOING: Record<JobKind, string> = {
  get extraction() { return t("Extracting"); },
  get config_sync() { return t("Loading configuration of"); },
  get config_load() { return t("Loading configuration of"); },
  get analysis() { return t("Analysing"); },
  get upload() { return t("Checking the upload of"); },
  get simulation() { return t("Simulating fixes for"); },
  get process_discovery() { return t("Discovering processes in"); },
};

/** Noun, for tables and the inspector title. */
export const JOB_KIND_LABEL: Record<JobKind, string> = {
  get extraction() { return t("Extraction"); },
  get config_sync() { return t("Configuration sync"); },
  get config_load() { return t("Configuration load"); },
  get analysis() { return t("Analysis"); },
  get upload() { return t("Upload"); },
  get simulation() { return t("Simulation"); },
  get process_discovery() { return t("Process discovery"); },
};

export const JOB_STATUS_LABEL: Record<Job["status"], string> = { get queued() { return t("Queued"); }, get running() { return t("Running"); }, get completed() { return t("Done"); }, get failed() { return t("Failed"); } };

/** What the job works on: the object when it names one, several objects counted, else its own label. */
export function jobObject(job: Job): string {
  const mods = job.modules ?? [];
  if (mods.length === 1) return labelText(mods[0]);
  if (mods.length === 2 || mods.length === 3) return mods.map(labelOf).join(", ");
  if (mods.length > 3) return t("{modsCount} objects", { modsCount: mods.length });
  const stripped = job.label.replace(/^[A-Za-z ]+\|\s*/, "");
  return stripped || job.label;
}

/** "Extracting Material master", the words of the job line without the percent. */
export function jobDoing(job: Job): string {
  return `${DOING[job.kind] ?? t("Running")} ${jobObject(job)}`;
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
