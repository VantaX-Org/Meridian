/** Automation chain fixture (api/routes/automation_chain.py): the five stages, the beat tasks and the run schedules. */
import type { AutomationChain } from "../automation";

export const NONE_AUTOMATION = Symbol("not an automation path");

const H = 3_600_000;
const at = (h: number) => new Date(Date.now() + h * H).toISOString();

export function automationRead(path: string): unknown {
  if (path !== "/automation/chain") return NONE_AUTOMATION;
  const chain: AutomationChain = {
    generated_at: at(0),
    stages: [
      { stage: "extract", task_count: 2, next_run_at: at(0.25), last_at: at(-5), last_status: "completed", rows: 412_306, runs_7d: 7, failed_7d: 0 },
      { stage: "checks", task_count: 5, next_run_at: at(2), last_at: at(-4.5), last_status: "agents_complete", version_id: "v-0042", runs_7d: 7, failed_7d: 1 },
      { stage: "agents", task_count: 6, next_run_at: at(0.5), last_at: at(-4.4), last_status: "agents_complete", queue_open: 7, queue_overdue: 3, escalated: 1 },
      { stage: "report", task_count: 7, next_run_at: at(9), last_at: at(-15), last_status: "complete", runs_7d: 9 },
      { stage: "monitoring", task_count: 5, next_run_at: at(0.1), last_at: at(-4.3), last_status: "regressed", regressed_checks: 2, new_records: 318, deliveries_7d: 24, failed_7d: 1 },
    ],
    tasks: [
      { key: "health-samples", task: "workers.tasks.health_samples.sample_health", stage: "monitoring", cron: "*/5 * * * *", next_run_at: at(0.05) },
      { key: "sync-profiles", task: "workers.scheduler.sync_profile_scheduler", stage: "extract", cron: "*/15 * * * *", next_run_at: at(0.25) },
      { key: "ai-triage", task: "workers.tasks.ai_triage.triage_queue_items", stage: "agents", cron: "*/30 * * * *", next_run_at: at(0.5) },
      { key: "daily-analysis", task: "workers.scheduler.daily_analysis", stage: "checks", cron: "0 2 * * *", next_run_at: at(2) },
      { key: "daily-digest", task: "workers.scheduler.daily_digest", stage: "report", cron: "0 7 * * *", next_run_at: at(9) },
      { key: "token-cleanup", task: "workers.tasks.maintenance.cleanup_tokens", stage: "platform", cron: "0 3 * * *", next_run_at: at(3) },
    ],
    schedules: [
      { id: "sp-1", name: "Material master nightly", system_name: "ECC production", domain: "material_master", modules: ["material_master"], schedule_cron: "0 1 * * *", active: true, status: "idle", last_run_at: at(-23), next_run_at: at(1) },
      { id: "sp-2", name: "SuccessFactors weekly", system_name: "SuccessFactors", domain: "successfactors", modules: ["successfactors"], schedule_cron: "0 4 * * 1", active: false, status: "paused", last_run_at: at(-150), next_run_at: null },
    ],
  };
  return chain;
}
