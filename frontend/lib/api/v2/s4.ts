/**
 * S/4HANA conversion readiness client (api/routes/findings.py s4_readiness, api/services/s4_readiness.py).
 *
 *   GET /findings/s4-readiness?scope=current  (every object at its latest run, grouped by simplification area)
 *
 * An area is red when any blocking rule fails; "not_evaluated" means no rule of the area ran.
 */
import { v2Get } from "./client";

export type S4Status = "green" | "amber" | "red" | "not_evaluated";

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
  status: S4Status;
  checks: S4Check[];
}

export interface S4Readiness {
  version_id: string | null;
  status: S4Status;
  ready: boolean;
  rules: number;
  evaluated: number;
  failing: number;
  failing_records: number;
  blocking_failing: number;
  warning_failing: number;
  areas: S4Area[];
  version_ids?: string[] | null;
}

export const getS4Readiness = () => v2Get<S4Readiness>("/findings/s4-readiness", { scope: "current" });
