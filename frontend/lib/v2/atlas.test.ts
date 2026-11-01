import { describe, expect, it } from "vitest";
import type { TimelineRun } from "@/lib/api/v2/runs";
import { atlasKey, framesOf } from "./atlas";

const run = (id: string, run_at: string | null, system_id: string, objects: Record<string, number | null>): TimelineRun => ({
  id,
  run_at,
  label: null,
  system_id,
  baseline: false,
  kind: "scheduled",
  objects: Object.fromEntries(Object.entries(objects).map(([m, s]) => [m, { score: s, raw_score: s, capped: false }])),
  records_checked: null,
  duration_s: null,
});

describe("atlas frames", () => {
  it("replays every system in run order and carries untouched objects forward", () => {
    const ecc = [run("e1", "2026-10-01T00:00:00Z", "ecc", { fi_gl: 70 }), run("e2", "2026-10-03T00:00:00Z", "ecc", { fi_gl: 76 })];
    const sf = [run("s1", "2026-10-02T00:00:00Z", "sf", { employee_central: 90 })];
    const frames = framesOf([ecc, sf]);
    expect(frames.map((f) => f.run.id)).toEqual(["e1", "s1", "e2"]);
    expect(frames[1].scores.get(atlasKey("ecc", "fi_gl"))).toBe(70);
    expect(frames[2].scores.get(atlasKey("sf", "employee_central"))).toBe(90);
    expect(frames[2].delta.get(atlasKey("ecc", "fi_gl"))).toBe(6);
    expect(frames[0].delta.size).toBe(0);
  });

  it("drops runs without a time and gives no delta across an unscored run", () => {
    const frames = framesOf([[run("a", "2026-10-01T00:00:00Z", "ecc", { fi_gl: null }), run("b", null, "ecc", { fi_gl: 50 }), run("c", "2026-10-02T00:00:00Z", "ecc", { fi_gl: 80 })]]);
    expect(frames.map((f) => f.run.id)).toEqual(["a", "c"]);
    expect(frames[1].delta.has(atlasKey("ecc", "fi_gl"))).toBe(false);
    expect(frames[1].scores.get(atlasKey("ecc", "fi_gl"))).toBe(80);
  });

  it("keeps the measured score of a capped object until a later run lifts the cap", () => {
    const capped = { ...run("a", "2026-10-01T00:00:00Z", "ecc", {}), objects: { fi_gl: { score: 70, raw_score: 81.4, capped: true } } };
    const frames = framesOf([[capped, run("b", "2026-10-02T00:00:00Z", "ecc", { mm_purchasing: 90 }), run("c", "2026-10-03T00:00:00Z", "ecc", { fi_gl: 88 })]]);
    expect(frames[0].measured.get(atlasKey("ecc", "fi_gl"))).toBe(81.4);
    expect(frames[1].measured.get(atlasKey("ecc", "fi_gl"))).toBe(81.4);
    expect(frames[2].measured.has(atlasKey("ecc", "fi_gl"))).toBe(false);
  });
});
