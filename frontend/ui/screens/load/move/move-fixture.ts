import { vi } from "vitest";
import apiClient from "@/lib/api/client";
import type { MovePlan, MoveRun, Reconciliation } from "@/lib/api/next/move";

/** Mocked answers for the move API. Synthetic names only. */
export const PLAN: MovePlan = {
  id: "p1",
  source: "s1",
  target: "s2",
  modules: ["employee_central", "material_master"],
  mode: "cleansed",
  status: "ready",
  waves: [
    { wave: 1, label: "Foundation", steps: [{ module: "employee_central", entity: "PerPerson", method: "upsert", rows: 1000, history_rows: 400, purge_type: null, depends_on: [] }] },
    { wave: 2, label: "Dependent", steps: [{ module: "material_master", entity: "MARA", method: "file_load", rows: 500, history_rows: 0, purge_type: null, depends_on: ["PerPerson"] }] },
  ],
  unplaced: [{ module: "learning_management", entity: "LearningItem", reason: "No load method" }],
  config: { company_code: { present: 4, create: 2, conflict: 1 }, cust_location: { present: 12, create: 0, conflict: 0 } },
  cleansing: {
    cells_fixed_per_rule: { "SF-EC-014": 320, "SF-EC-002": 1200 },
    records_still_failing: 7,
    dqs: { overall: { before: 62, after: 91, delta: 29 } },
  },
};

export const RUN: MoveRun = {
  id: "r1",
  plan_id: "p1",
  kind: "load",
  status: "completed",
  dry_run: true,
  waves: [{ wave: 1, status: "completed", steps: [{ entity: "PerPerson", sent: 1400, ok: 1390, failed: 10, error_rate: 0.007 }] }],
  checkpoint: null,
  started_at: "2026-11-17T08:00:00Z",
  finished_at: "2026-11-17T08:05:00Z",
  cleansing: {
    summary: { cells_fixed_per_rule: { "SF-EC-014": 320 }, records_still_failing: 1 },
    unfixable: [{ rule: "SF-EC-031", field: "email", record_key: "1001", current_value: "a@x", reason: "Email must be valid" }],
  },
};

export const RECON: Reconciliation = {
  id: "c1",
  status: "completed",
  entities: [
    { entity: "PerPerson", source_rows: 1400, target_rows: 1390, missing_in_target: ["1001", "1002"], extra_in_target: [], field_diffs: { email: 2 }, sample: [{ key: "1001", field: "email", source: "a@x.test", target: "" }] },
    { entity: "MARA", source_rows: 500, target_rows: 500, missing_in_target: [], extra_in_target: [], field_diffs: {}, sample: [] },
  ],
  dqs: { source: 71, projected_target: 88, actual_target: 84, reasons: ["Rows rejected by the target"] },
};

type Table = Record<string, unknown | ((body: unknown) => unknown)>;

/** Answer apiClient calls from a table keyed `"GET /path"`. An unlisted call fails the test. Returns the calls made. */
export function route(table: Table) {
  const calls: { key: string; body: unknown }[] = [];
  const make = (m: string) => async (url: string, body?: unknown) => {
    const key = `${m} ${url}`;
    calls.push({ key, body });
    if (!(key in table)) throw new Error(`unmocked ${key}`);
    const v = table[key];
    return { data: typeof v === "function" ? (v as (b: unknown) => unknown)(body) : v };
  };
  vi.mocked(apiClient.get).mockImplementation(make("GET") as never);
  vi.mocked(apiClient.post).mockImplementation(make("POST") as never);
  vi.mocked(apiClient.patch).mockImplementation(make("PATCH") as never);
  vi.mocked(apiClient.put).mockImplementation(make("PUT") as never);
  return calls;
}
