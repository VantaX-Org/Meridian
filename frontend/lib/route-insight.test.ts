import { describe, expect, it } from "vitest";
import { buildInsight, sectionOf, type InsightFacts } from "./route-insight";

const empty: InsightFacts = { hasRun: false, dqs: null, prevDqs: null, critical: 0, total: 0, affected: 0, systems: 0, waves: 0, backlog: null };

describe("route insight", () => {
  it("maps routes to sections and skips the design showcase", () => {
    expect(sectionOf("/objects/material_master")).toBe("objects");
    expect(sectionOf("/design")).toBeNull();
    expect(sectionOf("/nope")).toBeNull();
  });
  it("gives a designed fresh-install sentence for every cell and uses the day-one step", () => {
    const h = buildInsight("home", { ...empty, dayOne: { label: "Connect a system", href: "/systems" } });
    expect(h.situation.sentence).toMatch(/No analysis has run yet/);
    expect(h.changed.sentence).toMatch(/Nothing has changed yet/);
    expect(h.next.action?.href).toBe("/systems");
  });
  it("builds live sentences from aggregate fields", () => {
    const h = buildInsight("objects", {
      ...empty, hasRun: true, runId: "r1", dqs: 72.4, prevDqs: 70, critical: 3, total: 120, affected: 4500,
      worst: { module: "material_master", label: "Material master", findings: 61, critical: 2 },
    });
    expect(h.situation.sentence).toBe("Data quality score is 72, with 120 findings across 4,500 records.");
    expect(h.changed.sentence).toBe("Score rose 2.4 points since the previous run.");
    expect(h.why.sentence).toMatch(/3 critical findings cap the score at 85/);
    expect(h.next.href).toBe("/objects/material_master?run=r1");
    expect(h.next.sentence).toBe("Start with Material master, which has 61 findings, 2 critical.");
  });
});
