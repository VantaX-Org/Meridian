/**
 * The process designer and the survivorship editor of step 6b. The designer uses the existing /process-designer
 * endpoints (api/routes/process_designer.py): models are tenant-wide, saved as versions with a base version (409 when
 * stale, 422 with errors when invalid), and "published" is the model's status. Survivorship replaces the rules of one
 * domain with PUT /survivorship-rules (api/routes/survivorship_rules.py).
 */
import { v2Get, v2Send } from "./client";
import type { ModelSummary, ModelVersionRow, ProcessModelDocument } from "@/types/process-model";
import type { ModelRecord, ModelWithDocument, SaveResult } from "@/lib/api/process-designer";
import type { SurvivorshipRule, SurvivorshipRuleInput } from "@/lib/api/survivorship";

export type { ModelSummary, ModelVersionRow, ProcessModelDocument, ModelRecord, ModelWithDocument, SaveResult, SurvivorshipRule, SurvivorshipRuleInput };

const BASE = "/process-designer";

export const getReferenceModel = (): Promise<ProcessModelDocument> => v2Get<ProcessModelDocument>(`${BASE}/reference`);
export const listModels = (): Promise<ModelSummary[]> => v2Get<ModelSummary[]>(`${BASE}/models`);
export const getModel = (id: string, version?: number): Promise<ModelWithDocument> => v2Get<ModelWithDocument>(`${BASE}/models/${encodeURIComponent(id)}`, { version });
export const listVersions = (id: string): Promise<ModelVersionRow[]> => v2Get<ModelVersionRow[]>(`${BASE}/models/${encodeURIComponent(id)}/versions`);
/** `from` is "reference" or a model id. Needs analyse or run_process_discovery. */
export const createModel = (name: string, from: string): Promise<{ model: ModelRecord; version_no: number }> => v2Send("POST", `${BASE}/models`, { name, from });
export const saveModel = (id: string, body: { document: ProcessModelDocument; note: string; base_version: number }): Promise<SaveResult> => v2Send("PUT", `${BASE}/models/${encodeURIComponent(id)}`, body);
export const patchModel = (id: string, body: { name?: string; status?: "draft" | "published" }): Promise<ModelRecord> => v2Send("PATCH", `${BASE}/models/${encodeURIComponent(id)}`, body);
export const deleteModel = (id: string): Promise<void> => v2Send<void>("DELETE", `${BASE}/models/${encodeURIComponent(id)}`);

/** PUT /survivorship-rules: replaces every rule of the domain; a rule left out is deleted. Needs mdm.write. */
export const putSurvivorship = (domain: string, rules: SurvivorshipRuleInput[]): Promise<{ rules: SurvivorshipRule[]; total: number }> => v2Send("PUT", "/survivorship-rules", { domain, rules });

/** One attribute whose golden value would change under candidate survivorship rules, with its DDIC check. */
export interface SurvivorshipPreviewAttribute {
  field: string;
  changed: number;
  in_dictionary: boolean;
  table?: string | null;
  text: string;
  length?: number | null;
  check_table?: string | null;
  fixed_values: number;
  check_status: "checked" | "unknown" | "not_checked";
  invalid: number;
  invalid_reasons: Record<string, number>;
  invalid_samples: string[];
}

export interface SurvivorshipPreviewSample {
  golden_id?: string | null;
  key?: string | null;
  field: string;
  before: string;
  after: string;
  rule?: string | null;
  winner_key?: string | null;
  winner_system?: string | null;
}

export interface SurvivorshipPreview {
  domain: string;
  clusters_total: number;
  clusters_scanned: number;
  capped: boolean;
  cap: number;
  records_changed: number;
  values_changed: number;
  invalid_values: number;
  value_set_source: "live" | "baseline" | "none";
  attributes: SurvivorshipPreviewAttribute[];
  samples: SurvivorshipPreviewSample[];
}

/** What-if: the golden values the candidate rules would change, without saving them. */
export const previewSurvivorship = (domain: string, rules: SurvivorshipRuleInput[]): Promise<SurvivorshipPreview> =>
  v2Send("POST", "/survivorship-rules/preview", { domain, rules });
