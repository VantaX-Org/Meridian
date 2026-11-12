/**
 * Record sheet client (api/routes/object_records.py): one record of any object, read from the run's extracted data.
 * Used when the work queue has no row for the record, so a record that passes every rule can still be opened.
 */
import { v2Get } from "./client";

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
export const getRecordSheet = (object: string, key: string): Promise<RecordSheet> => v2Get(base(object, key));
export const getRecordFindings = (object: string, key: string): Promise<RecordFindings> => v2Get(`${base(object, key)}/findings`);
