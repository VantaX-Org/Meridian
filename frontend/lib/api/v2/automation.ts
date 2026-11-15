/**
 * Automation chain (api/routes/automation_chain.py): what runs on its own, when it last ran, how it went and when it runs
 * next, for the chain extract, checks, agents, report, monitoring. Read-only, view permission.
 */
import { v2Get } from "./client";

export const CHAIN_STAGES = ["extract", "checks", "agents", "report", "monitoring"] as const;
export type ChainStage = (typeof CHAIN_STAGES)[number];

export interface ChainStageRow {
  stage: ChainStage;
  task_count: number;
  next_run_at: string | null;
  last_at: string | null;
  last_status: string | null;
  rows?: number | null;
  runs_7d?: number | null;
  failed_7d?: number | null;
  version_id?: string | null;
  queue_open?: number | null;
  queue_overdue?: number | null;
  escalated?: number | null;
  regressed_checks?: number | null;
  new_records?: number | null;
  deliveries_7d?: number | null;
}

export interface ChainTask { key: string; task: string; stage: ChainStage | "platform"; cron: string | null; next_run_at: string | null }

export interface ChainSchedule { id: string; name: string | null; system_name: string | null; domain: string; modules: string[]; schedule_cron: string | null; active: boolean; status: string; last_run_at: string | null; next_run_at: string | null }

export interface AutomationChain { generated_at: string; stages: ChainStageRow[]; tasks: ChainTask[]; schedules: ChainSchedule[] }

export const getAutomationChain = () => v2Get<AutomationChain>("/automation/chain");
