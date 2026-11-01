/**
 * Version what-if (api/routes/simulation.py): POST /simulations queues a simulation on a stored run (analyse), and
 * GET /simulations/{id} returns the job's progress, then the stored result for a day (view).
 */
import { v2Get, v2Send } from "./client";

export interface SimulationBody {
  version_id: string;
  /** "TABLE.FIELD" to {old: new}; "__blank__" maps an empty value. */
  value_maps?: Record<string, Record<string, string>>;
  rule_fixes?: { check_id: string; fix_value?: string }[];
  batch_ids?: string[];
  all_rule_fixes?: boolean;
  rank?: boolean;
}

interface Delta { before: number | null; after: number | null; delta: number | null }
interface RuleCount { failing: number; total: number; pass_rate: number; passed: boolean }

export interface SimRule {
  module: string;
  check_id: string;
  field: string;
  severity: string;
  dimension: string;
  targeted: boolean;
  before: RuleCount | null;
  after: RuleCount | null;
  records_resolved: number;
  records_introduced: number;
  status: "newly_evaluated" | "not_evaluated" | "newly_failing" | "resolved" | "improved" | "regressed" | "unchanged";
}

export interface SimulationDoc {
  simulation_id: string;
  status: "completed";
  version_id: string;
  fixes: { cells_changed: number; unmatched_records: number };
  dqs: { overall: Delta; modules: (Delta & { module: string })[]; dimensions: (Delta & { dimension: string })[] };
  impact: { module: string; feature: string; before: string; after: string; change: string }[];
  rules: SimRule[];
  unchanged_rules: number;
  side_effects: SimRule[];
  findings: { before: number; after: number; resolved: number; introduced: number };
  records: { resolved: number; introduced: number };
  best_next_fixes?: { id: string; label: string; records_changed: number; dqs_gain: number; gain_per_1k_records: number; dqs_after: number }[];
}

export type SimulationState =
  | SimulationDoc
  | { simulation_id: string; status: "failed"; error: string }
  | { simulation_id: string; status: string; job: { stage?: string | null; message?: string | null; percent?: number | null } };

export const createSimulation = (body: SimulationBody): Promise<{ simulation_id: string; job_id: string; status: "queued" }> => v2Send("POST", "/simulations", body);
export const getSimulation = (id: string): Promise<SimulationState> => v2Get(`/simulations/${encodeURIComponent(id)}`);
export const isDone = (s: SimulationState): s is SimulationDoc => s.status === "completed" && "dqs" in s;
