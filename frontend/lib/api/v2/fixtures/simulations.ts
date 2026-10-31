/**
 * Version what-if fixture, shaped like api/routes/simulation.py and workers/tasks/run_simulation.py. The POST
 * validates as the route does; the first read of a simulation reports the job running, the next the stored result.
 */
import type { SimulationBody, SimulationDoc, SimRule } from "../simulations";

export const NONE_SIMULATIONS = Symbol("not a simulations path");

const KEY = /^[A-Z0-9_/]+\.[A-Z0-9_/]+$/;
let sims: Map<string, { reads: number; body: SimulationBody }> = new Map();
export const resetSimulationsFixture = (): void => { sims = new Map(); };

function refuse(detail: string, code = 422): never {
  throw Object.assign(new Error(detail), { status: code, response: { status: code, data: { detail } } });
}

const rule = (module: string, check_id: string, field: string, severity: string, dimension: string, targeted: boolean, b: number, a: number, total: number, resolved: number, introduced: number, status: SimRule["status"]): SimRule => ({
  module, check_id, field, severity, dimension, targeted,
  before: { failing: b, total, pass_rate: 1 - b / total, passed: b === 0 },
  after: { failing: a, total, pass_rate: 1 - a / total, passed: a === 0 },
  records_resolved: resolved, records_introduced: introduced, status,
});

function result(id: string, body: SimulationBody): SimulationDoc {
  const side = rule("material_master", "MM205", "MARC.DISPO", "medium", "consistency", false, 3, 11, 4120, 0, 8, "regressed");
  return {
    simulation_id: id, status: "completed", version_id: body.version_id,
    fixes: { cells_changed: 412, unmatched_records: 6 },
    dqs: {
      overall: { before: 71.4, after: 78.9, delta: 7.5 },
      modules: [{ module: "material_master", before: 68.2, after: 79.5, delta: 11.3 }, { module: "business_partner", before: 74.6, after: 78.3, delta: 3.7 }],
      dimensions: [{ dimension: "completeness", before: 70.1, after: 81.0, delta: 10.9 }, { dimension: "validity", before: 76.0, after: 79.2, delta: 3.2 }, { dimension: "consistency", before: 69.5, after: 68.9, delta: -0.6 }],
    },
    impact: [{ module: "material_master", feature: "MRP run", before: "blocked", after: "degraded", change: "improved" }],
    rules: [
      rule("material_master", "MM142", "MARA.MTART", "critical", "validity", true, 214, 0, 4120, 214, 0, "resolved"),
      rule("material_master", "MM118", "MARC.EKGRP", "high", "completeness", true, 190, 12, 4120, 178, 0, "improved"),
      side,
    ],
    unchanged_rules: 386,
    side_effects: [side],
    findings: { before: 41, after: 39, resolved: 3, introduced: 1 },
    records: { resolved: 392, introduced: 8 },
    best_next_fixes: [
      { id: "vm:MARA.MTART", label: "MARA.MTART value map", records_changed: 214, dqs_gain: 4.1, gain_per_1k_records: 19.16, dqs_after: 75.5 },
      { id: "rule:MM118", label: "MM118 fix", records_changed: 198, dqs_gain: 7.5, gain_per_1k_records: 17.17, dqs_after: 78.9 },
    ],
  };
}

export function simulationsRead(path: string): unknown {
  const m = /^\/simulations\/([^/]+)$/.exec(path);
  if (!m) return NONE_SIMULATIONS;
  const id = decodeURIComponent(m[1]);
  const s = sims.get(id) ?? refuse("Simulation not found or expired", 404);
  s.reads += 1;
  return s.reads === 1 ? { simulation_id: id, status: "running", job: { stage: "patch", message: "Applying the fixes", percent: 40 } } : result(id, s.body);
}

export function simulationsWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || path !== "/simulations") return NONE_SIMULATIONS;
  const b = (body ?? {}) as SimulationBody;
  const maps = b.value_maps ?? {};
  if (!Object.keys(maps).length && !(b.rule_fixes ?? []).length && !(b.batch_ids ?? []).length && !b.all_rule_fixes) refuse("Give at least one value map, rule fix or batch.");
  for (const k of Object.keys(maps)) if (!KEY.test(k)) refuse(`value_maps key ${k} must be TABLE.FIELD`);
  const id = `sim-${sims.size + 1}`;
  sims.set(id, { reads: 0, body: b });
  return { simulation_id: id, job_id: id, status: "queued" };
}
