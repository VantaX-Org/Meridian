/**
 * Migration load plan client (api/routes/load_plan.py).
 *
 *   GET /migration/load-plan   the DDIC-derived order in which migration objects load, with each object's readiness
 *
 * Every dependency names the field, its check table and the dictionary text. An edge is required when SAP refuses
 * the record without the field; a reference edge inside a cycle is deferred and loaded as a delta after both objects.
 */
import { v2Get } from "./client";

export type LoadStatus = "go" | "no_go" | "not_run";
export type PrerequisiteKind = "configuration" | "master_data" | "unclassified";

export interface LoadEvidence {
  field: string;
  text: string;
  check_table: string;
  check_table_text: string;
  required: boolean;
  reason?: string | null;
}

export interface LoadEdge {
  before: string;
  after: string;
  kind: "required" | "reference";
  deferred: boolean;
  evidence: LoadEvidence[];
}

export interface LoadPrerequisite { table: string; text: string; kind: PrerequisiteKind; fields: string[] }

export interface LoadObject {
  module: string;
  label: string;
  anchor: string;
  anchor_text: string;
  step: number;
  group: string[];
  status: LoadStatus;
  blocking: number;
  run_id?: string | null;
  blocked_by: string[];
  prerequisites: LoadPrerequisite[];
}

export interface LoadPlan { release: string; objects: LoadObject[]; edges: LoadEdge[]; unknown: string[]; steps: number }

export const getLoadPlan = (modules?: string[], systemId?: string): Promise<LoadPlan> =>
  v2Get<LoadPlan>("/migration/load-plan", {
    ...(modules?.length ? { modules: modules.join(",") } : {}),
    ...(systemId ? { system_id: systemId } : {}),
  });
