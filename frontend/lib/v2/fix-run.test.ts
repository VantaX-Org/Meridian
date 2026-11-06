import { describe, expect, it } from "vitest";
import { currentRunFor } from "./fix-run";
import type { TimelineRun } from "@/lib/api/v2/runs";

const run = (id: string): TimelineRun => ({ id, run_number: 3, run_at: null, label: null, system_id: "s1", baseline: false, kind: null, objects: {}, records_checked: null, duration_s: null });
const L = { cells: [{ system_id: "s1", module: "material_master", run_id: "r3" }, { system_id: "s2", module: "material_master", run_id: "x9" }] } as never;

describe("currentRunFor", () => {
  it("finds the run of the object's cell", () => {
    expect(currentRunFor(L, [run("r3")], "material_master", "s1")?.run.id).toBe("r3");
  });
  it("is null for an unknown object, a missing run or no data", () => {
    expect(currentRunFor(L, [run("r3")], "customer_master", "s1")).toBeNull();
    expect(currentRunFor(L, [run("r3")], "material_master", "s2")).toBeNull();
    expect(currentRunFor(undefined, [run("r3")], "material_master")).toBeNull();
  });
});
