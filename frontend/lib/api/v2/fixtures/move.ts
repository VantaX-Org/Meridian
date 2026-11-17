/**
 * Fixture answers for the instance move (`?fixture=1`), in the shapes of api/routes/instance_move.py:
 *   GET /migration/move/plans, GET /migration/move/plans/{plan_id}, GET /migration/move/reconciliations/{recon_id}
 * Every other path answers NONE_MOVE and falls through.
 */
import type { MovePlan, Reconciliation } from "../../next/move";

export const NONE_MOVE = Symbol("no-move-fixture");

const PLAN: MovePlan = {
  id: "mp-1",
  source: "sys-sf-old",
  target: "sys-sf-new",
  modules: ["employee_central"],
  mode: "cleansed",
  status: "ready",
  unplaced: [],
  waves: [
    { wave: 0, label: "Picklists, MDF config and Foundation", steps: [
      { module: "employee_central", entity: "FOCOMPANY", method: "upsert", rows: 4, history_rows: 9, purge_type: null, depends_on: [] },
      { module: "employee_central", entity: "FODEPARTMENT", method: "upsert", rows: 38, history_rows: 71, purge_type: null, depends_on: ["FOCOMPANY"] },
    ] },
    { wave: 2, label: "User", steps: [{ module: "employee_central", entity: "USERACCOUNT", method: "upsert", rows: 412, history_rows: 0, purge_type: null, depends_on: [] }] },
    { wave: 4, label: "Employment", steps: [{ module: "employee_central", entity: "EMPEMPLOYMENT", method: "upsert", rows: 412, history_rows: 57, purge_type: "incremental", depends_on: ["USERACCOUNT"] }] },
  ],
};

const RECON: Reconciliation & { plan_id: string } = {
  id: "mr-1",
  plan_id: PLAN.id,
  status: "completed",
  entities: [{ entity: "FOCOMPANY", source_rows: 13, target_rows: 13, missing_in_target: [], extra_in_target: [], field_diffs: {}, sample: [] }],
  dqs: { source: 81.4, projected_target: 88.2, actual_target: 87.9, reasons: [] },
  reason: null,
};

export function moveRead(path: string): unknown {
  if (path === "/migration/move/plans") return [structuredClone(PLAN)];
  if (path === `/migration/move/plans/${PLAN.id}`) return structuredClone(PLAN);
  if (path === `/migration/move/reconciliations/${RECON.id}`) return structuredClone(RECON);
  return NONE_MOVE;
}
