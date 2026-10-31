import { describe, expect, it } from "vitest";
import lineage from "@/lib/api/v2/fixtures/lineage.json";
import type { BlastRadius, LineageGraph } from "@/lib/api/v2/lineage";
import type { MoneyFeature } from "@/lib/api/v2/step9";
import { blastModel, pathThrough } from "./blast-radius";

const graph = (lineage.graph as unknown as Record<string, LineageGraph>).MM302;
const blast = (lineage.blast as unknown as Record<string, BlastRadius>).MM302;
const money = [{ feature: "Migration cockpit: material load", system: "ECC", status: "blocked", opportunity_cost_per_month: 1200 }] as MoneyFeature[];

describe("blastModel", () => {
  it("folds tables, objects and processes into field-to-step edges", () => {
    const m = blastModel(graph, blast, []);
    expect(new Set(m.nodes.map((n) => n.col))).toEqual(new Set(["field", "step", "feature", "kpi"]));
    expect(m.edges.some(([a, b]) => a === "field:MARC.EKGRP" && b.startsWith("step:"))).toBe(true);
    expect(m.edges.every(([a, b]) => !a.startsWith("table:") && !b.startsWith("process:"))).toBe(true);
  });

  it("sums documents per step from joinable targets only and leaves money null without a cost model", () => {
    const m = blastModel(graph, blast, []);
    expect(m.documents).toBe(blast.targets.reduce((s, t) => s + t.documents, 0));
    expect(m.perMonth).toBeNull();
    expect(blastModel(graph, null, []).documents).toBeNull();
  });

  it("adds the config impact features with their money and lights a path end to end", () => {
    const m = blastModel(graph, blast, money);
    expect(m.perMonth).toBe(1200);
    expect(m.blocked).toBe(1);
    const lit = pathThrough(m, "field:MARC.EKGRP");
    expect(lit.has("money:Migration cockpit: material load")).toBe(true);
    expect([...lit].some((id) => id.startsWith("kpi:"))).toBe(true);
  });
});
