import apiClient from "./client";
import type { Job, JobStatus } from "@/types/jobs";

/** Shape of api/routes/simulation.py + api/services/fix_simulation.py. */

/** TABLE.FIELD → { old value: new value }; "__blank__" maps empty fields. */
export type ValueMaps = Record<string, Record<string, string>>;

export interface RuleFix {
  check_id: string;
  /** Overrides the rule's own fix_value: one value, or a map by current value. */
  fix_value?: string | Record<string, string>;
}

export interface SimulationRequest {
  version_id: string;
  value_maps?: ValueMaps;
  rule_fixes?: RuleFix[];
  batch_ids?: string[];
  modules?: string[];
  all_rule_fixes?: boolean;
  rank?: boolean;
}

export interface SimulationQueued {
  simulation_id: string;
  job_id: string;
  status: JobStatus;
}

export interface RuleCounts {
  failing: number;
  total: number;
  pass_rate: number;
  passed: boolean;
}

export type RuleChange = "resolved" | "improved" | "regressed" | "newly_failing" | "unchanged"
  | "newly_evaluated" | "not_evaluated";

export interface RuleDelta {
  module: string;
  check_id: string;
  field: string;
  severity: string;
  dimension: string;
  targeted: boolean;
  before: RuleCounts | null;
  after: RuleCounts | null;
  records_resolved: number;
  records_introduced: number;
  status: RuleChange;
}

export interface ScoreDelta {
  before: number | null;
  after: number | null;
  delta: number | null;
}

export interface FeatureChange {
  module: string;
  feature: string;
  before: string;
  after: string;
  change: "unblocked" | "improved" | "worsened";
}

export interface NextFix {
  id: string;
  label: string;
  records_changed: number;
  dqs_gain: number;
  gain_per_1k_records: number;
  dqs_after: number;
}

export interface SimulationResult {
  simulation_id: string;
  status: "completed" | "failed";
  error?: string;
  version_id: string;
  modules: string[];
  fixes: { groups: number; cells_changed: number; by_field: Record<string, number>; unmatched_records: number; tables: string[] };
  dqs: {
    overall: ScoreDelta & { capped_before: boolean; capped_after: boolean };
    modules: (ScoreDelta & { module: string })[];
    dimensions: (ScoreDelta & { dimension: string })[];
  };
  impact: FeatureChange[];
  rules: RuleDelta[];
  unchanged_rules: number;
  side_effects: RuleDelta[];
  findings: { before: number; after: number; resolved: number; introduced: number };
  records: { resolved: number; introduced: number };
  best_next_fixes?: NextFix[];
}

/** While queued or running the API returns the job instead of a result. */
export interface SimulationPending {
  simulation_id: string;
  status: "queued" | "running";
  job: Job;
}

export async function createSimulation(body: SimulationRequest): Promise<SimulationQueued> {
  const res = await apiClient.post<SimulationQueued>("/api/v1/simulations", body);
  return res.data;
}

export async function getSimulation(id: string): Promise<SimulationResult | SimulationPending> {
  const res = await apiClient.get<SimulationResult | SimulationPending>(`/api/v1/simulations/${id}`);
  return res.data;
}

export function isSimulationResult(r: SimulationResult | SimulationPending): r is SimulationResult {
  return r.status === "completed" || r.status === "failed";
}
