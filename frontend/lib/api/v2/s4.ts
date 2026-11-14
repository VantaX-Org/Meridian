/**
 * S/4HANA conversion readiness client (api/routes/findings.py s4_readiness, api/services/s4_readiness.py).
 *
 *   GET /findings/s4-readiness?scope=current  (every object at its latest run, grouped by simplification area)
 *
 * An area is red when any blocking rule fails; "not_evaluated" means no rule of the area ran.
 * ready is true only when every blocking rule was evaluated (assessment "complete"); a blocking rule that was
 * skipped is unknown, not passed, so the verdict is "incomplete" with blocking_unevaluated rules still open.
 */
import { v2Get } from "./client";

export type S4Status = "green" | "amber" | "red" | "not_evaluated";

export type S4Assessment = "complete" | "incomplete" | "not_assessed";

export interface S4Check {
  check_id: string;
  module: string | null;
  impact: "blocking" | "warning";
  status: S4Status;
  affected_count: number;
  pass_rate: number | null;
}

export interface S4Area {
  area: string;
  label: string;
  simplification_item: string | null;
  rules: number;
  evaluated: number;
  failing: number;
  failing_records: number;
  blocking_failing: number;
  warning_failing: number;
  blocking_rules?: number;
  blocking_evaluated?: number;
  blocking_unevaluated?: number;
  status: S4Status;
  checks: S4Check[];
}

export interface S4Readiness {
  version_id: string | null;
  status: S4Status;
  ready: boolean;
  assessment?: S4Assessment;
  rules: number;
  evaluated: number;
  failing: number;
  failing_records: number;
  blocking_failing: number;
  warning_failing: number;
  blocking_rules?: number;
  blocking_evaluated?: number;
  blocking_unevaluated?: number;
  areas: S4Area[];
  version_ids?: string[] | null;
}

export const getS4Readiness = () => v2Get<S4Readiness>("/findings/s4-readiness", { scope: "current" });
