/**
 * Extraction targets (api/services/extract_target.py, api/routes/versions.py). A run started with a target system and/or
 * a target template per object has each template filled from the run once it is stored. These read the outcome and
 * open the filled file. A failed fill never fails the run: its entry carries the error.
 */
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";

export type TemplateFillStatus = "pending" | "filled" | "failed" | "skipped";

/** What the caller picks at extraction start. Both are optional; the API defaults them (paired target, latest template). */
export interface ExtractTargetChoice {
  target_system_id?: string;
  /** Module to target-template id. Each key must be among the requested modules. An empty id fills nothing for that module (no default newest template). */
  target_template_ids?: Record<string, string>;
}

export interface TemplateFill {
  module: string;
  template_id: string;
  template_name?: string | null;
  status: TemplateFillStatus;
  error?: string | null;
  filled_at?: string | null;
  format?: string | null;
  summary?: Record<string, unknown> | null;
  /** Relative to the site root; open it with openExtractTargetFile. */
  download_url?: string | null;
  /** The run the rows were read from: this run, or the newest full extraction of its system after a refill. */
  source_version_id?: string | null;
}

export interface ExtractTarget {
  target_system_id: string | null;
  templates: TemplateFill[];
}

const enc = encodeURIComponent;

export const getRunExtractTarget = (versionId: string): Promise<ExtractTarget> =>
  v2Get(`/versions/${enc(versionId)}/extract-target`);

/** Saves the template filled from this run for one module. Returns the saved file name. */
export const openExtractTargetFile = (versionId: string, module: string): Promise<string> =>
  v2Download(`/versions/${enc(versionId)}/extract-target/${enc(module)}/file`, undefined, `${module}.xlsx`);

/** Fills this run's template for one module again, from the newest full extraction of the run's system. 409 while an extraction of that system runs. */
export const refillExtractTarget = (versionId: string, module: string): Promise<TemplateFill> =>
  v2Send("POST", `/versions/${enc(versionId)}/extract-target/${enc(module)}/refill`);
