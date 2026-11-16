import type { Job } from "@/types/jobs";

/** Mirrors api/routes/jobs.py _retryable: an extraction needs its recorded start request, an analysis its run. */
export function canRetry(job: Job): boolean {
  if (job.kind === "analysis") return Boolean(job.version_id);
  if (job.kind === "extraction") return Boolean(job.retry) && Boolean(job.system_id);
  return ["config_load", "process_discovery"].includes(job.kind) && Boolean(job.system_id);
}
