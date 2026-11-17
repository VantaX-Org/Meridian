import { vi } from "vitest";
import apiClient from "@/lib/api/client";
import type { MovePlan, MoveRun, Reconciliation } from "@/lib/api/next/move";

/** Mocked answers for the move API. Synthetic names only. */
export const PLAN: MovePlan = {
  id: "p1",
  source: { id: "s1", name: "Dev ECC" },
  target: { id: "s2", name: "New S4" },
  modules: ["employee_central", "material_master"],
  mode: "cleansed",
  waves: [
    { wave: 1, label: "Foundation", steps: [{ module: "employee_central", entity: "PerPerson", method: "odata_upsert", rows: 1000, history_rows: 400, purge_type: null, depends_on: [] }] },
    { wave: 2, label: "Dependent", steps: [{ module: "material_master", entity: "MARA", method: "file_load", rows: 500, history_rows: 0, purge_type: null, depends_on: ["PerPerson"] }] },
  ],
  unplaced: [{ module: "learning_management", entity: "LearningItem", reason: "No load method" }],
  cleansing: {
    cells_fixed_by_rule: [
      { rule_id: "SF-EC-014", description: "Phone number format", cells: 320 },
      { rule_id: "SF-EC-002", description: "Trim leading spaces", cells: 1200 },
    ],
    records_still_failing: 7,
    dqs_before: 62,
    dqs_after: 91,
    needs_review: [{ entity: "PerPerson", key: "1001", field: "email", rule_id: "SF-EC-031", description: "Email must be valid", value: "a@x" }],
  },
};

export const RUN: MoveRun = {
  id: "r1",
  status: "completed",
  dry_run: true,
  waves: [{ wave: 1, status: "completed", steps: [{ entity: "PerPerson", sent: 1400, ok: 1390, failed: 10, error_rate: 0.007 }] }],
  checkpoint: null,
  started_at: "2026-11-17T08:00:00Z",
  finished_at: "2026-11-17T08:05:00Z",
};

export const RECON: Reconciliation = {
  entities: [
    { entity: "PerPerson", source_rows: 1400, target_rows: 1390, missing_in_target: 10, extra_in_target: 0, field_diffs: 2, sample: [{ key: "1001", field: "email", source: "a@x.test", target: "" }] },
    { entity: "MARA", source_rows: 500, target_rows: 500, missing_in_target: 0, extra_in_target: 0, field_diffs: 0, sample: [] },
  ],
  dqs: { source: 71, projected_target: 88, actual_target: 84, reasons: [{ label: "Rows rejected by the target", value: 10 }] },
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
