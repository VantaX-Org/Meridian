/**
 * Record sheet client (api/routes/object_records.py): one record of any object, read from the run's extracted data.
 * Used when the work queue has no row for the record, so a record that passes every rule can still be opened.
 */
import { v2Get, v2Send } from "./client";
import { v2Download } from "./download";

export interface RecordSheet {
  matnr: string;
  description: string | null;
  /** Field name to value; for a generic object this is the whole row. */
  mara: Record<string, string | null>;
  labels: Record<string, string | null>;
  version_id?: string | null;
}
export interface RecordFindings {
  version_id: string | null;
  failing: { check_id: string; severity: string; message: string | null; field: string | null }[];
}

const base = (object: string, key: string) => `/objects/${encodeURIComponent(object)}/records/${encodeURIComponent(key)}`;
const at = (versionId?: string | null) => (versionId ? { version_id: versionId } : undefined);
/** Without a run the route reads the latest complete run of the object. */
export const getRecordSheet = (object: string, key: string, versionId?: string | null): Promise<RecordSheet> => v2Get(base(object, key), at(versionId));
export const getRecordFindings = (object: string, key: string, versionId?: string | null): Promise<RecordFindings> => v2Get(`${base(object, key)}/findings`, at(versionId));

export interface GlossaryEntry { id: string; business_name: string; business_definition?: string | null }
/** POST /glossary/batch-lookup (view): business names for TABLE.FIELD codes. Codes with no term are left out. */
export const glossaryBatchLookup = (fields: string[]): Promise<{ lookup: Record<string, GlossaryEntry> }> =>
  v2Send("POST", "/glossary/batch-lookup", { fields });

/** GET /objects/export (export): every object's summary for one run. */
export const exportObjects = (run: string, format: "csv" | "xlsx"): Promise<string> =>
  v2Download("/objects/export", { run, format }, `objects.${format}`);
/** GET /objects/{module}/export (export): one object's dimension scores and every rule result for one run. */
export const exportObject = (module: string, run: string, format: "csv" | "xlsx"): Promise<string> =>
  v2Download(`/objects/${encodeURIComponent(module)}/export`, { run, format }, `object-${module}.${format}`);
