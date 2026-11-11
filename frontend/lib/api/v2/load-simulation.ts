/**
 * Load simulation client (api/routes/migration.py).
 *
 *   GET /migration/runs/{id}/load-simulation   a Migration-Cockpit-style "would fail" report for one run
 *
 * Findings are grouped per load object, gap type and field into messages built from the DDIC. A check-table miss
 * fails the load whatever its severity; one measured against the SAP standard baseline is provisional.
 */
import { v2Get } from "./client";

export interface SimValue { value: string | null; records: number }

export interface SimObject {
  module: string;
  label: string;
  records: number;
  would_load: number;
  would_fail: number;
  provisional: number;
  tables: string[];
  structural: number;
  messages: number;
}

export interface SimGroup {
  module: string;
  dest_table: string;
  field: string;
  gap_type: string;
  rule: string | null;
  severity: string;
  records: number;
  findings: number;
  structural: boolean;
  provisional: boolean;
  message: string;
  field_text: string | null;
  check_table: string | null;
  values: SimValue[];
  samples: string[];
}

export interface SimTransport {
  module: string;
  check_table: string;
  check_table_text: string | null;
  field: string;
  field_text: string | null;
  provisional: boolean;
  records: number;
  values: SimValue[];
}

export interface LoadSimulation {
  run_id: string;
  release: string;
  target_connected: boolean;
  objects: SimObject[];
  groups: SimGroup[];
  transports: SimTransport[];
  totals: { records: number; would_load: number; would_fail: number; provisional: number };
}

export const getLoadSimulation = (runId: string): Promise<LoadSimulation> =>
  v2Get<LoadSimulation>(`/migration/runs/${encodeURIComponent(runId)}/load-simulation`);
