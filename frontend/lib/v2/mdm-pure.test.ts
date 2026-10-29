import { describe, expect, it } from "vitest";
import type { BusinessProcessL1 } from "@/types/api";
import type { ImpactResult } from "@/lib/api/v2/object";
import type { RuleRow } from "@/lib/api/v2/types";
import { blockedCount, firstBlockedStep, parseStepRef, stepRef, stepsOf, worstOf } from "./process-tree";
import { buildLineage, fieldsWithoutTerm } from "./lineage-graph";

const field = (check: string | null, status: "green" | "amber" | "red", affected = 0) => ({
  field: "MARA.MEINS", description: "Base unit", mandatory: true, config_source: "", check_id: check, dq_status: status, pass_rate: status === "green" ? 100 : 80, affected_count: affected, finding_message: check ? `${check} fails` : "",
});
const step = (id: string, status: "green" | "amber" | "red", fields: ReturnType<typeof field>[]) => ({
  l4_id: id, l4_name: id, tcode: "T", description: "", config_dependency: null, step_status: status,
  activities: [{ l5_id: `${id}-1`, l5_name: "a", tcode: "T", description: "", fields, check_ids: [], activity_status: status }],
});
const doc: BusinessProcessL1[] = [
  { l1_id: "PTP", l1_name: "Procure", l1_description: "", system: "ECC", l2_groups: [
    { l2_id: "A", l2_name: "A", l3_processes: [{ l3_id: "A-P1", l3_name: "A", description: "", overall_readiness: "amber", l4_subprocesses: [step("S1", "green", [field(null, "green")]), step("S2", "amber", [field("R1", "amber", 40)])] }] },
    { l2_id: "B", l2_name: "B", l3_processes: [{ l3_id: "B-P1", l3_name: "B", description: "", overall_readiness: "red", l4_subprocesses: [step("S3", "red", [field("R2", "red", 500), field("R3", "red", 90), field("R2", "red", 700)])] }] },
  ] },
  { l1_id: "PP", l1_name: "Plan", l1_description: "", system: "ECC", l2_groups: [
    { l2_id: "C", l2_name: "C", l3_processes: [{ l3_id: "C-P1", l3_name: "C", description: "", overall_readiness: "green", l4_subprocesses: [step("S4", "green", [])] }] },
  ] },
];

describe("process steps", () => {
  it("numbers steps within their L1 and keeps reading order", () => {
    expect(stepsOf(doc).map((s) => `${s.l1Id}:${s.number}:${s.id}`)).toEqual(["PTP:1:S1", "PTP:2:S2", "PTP:3:S3", "PP:1:S4"]);
  });
  it("marks a step blocked only when the API marks it red; amber is at risk", () => {
    const s = stepsOf(doc);
    expect(s.map((x) => x.blocked)).toEqual([false, false, true, false]);
    expect(s[1].status).toBe("amber");
    expect(blockedCount(doc)).toBe(1);
    expect(firstBlockedStep(doc)?.id).toBe("S3");
    expect(firstBlockedStep([])).toBeNull();
  });
  it("lists each failing rule once with its worst count, most records first, and a floor for the records affected", () => {
    const s3 = stepsOf(doc)[2];
    expect(s3.rules.map((r) => [r.checkId, r.affected])).toEqual([["R2", 700], ["R3", 90]]);
    expect(s3.recordsAtLeast).toBe(700);
    expect(stepsOf(doc)[0].rules).toEqual([]);
  });
  it("round-trips the step reference and takes the worst status", () => {
    expect(parseStepRef(stepRef("material_master", "PTP-GR-MIGO"))).toEqual({ module: "material_master", step: "PTP-GR-MIGO" });
    expect(parseStepRef("nocolon")).toBeNull();
    expect(worstOf(["green", "amber"])).toBe("amber");
    expect(worstOf(["green", "red", "amber"])).toBe("red");
    expect(worstOf([])).toBe("green");
  });
});

const rule = (id: string, f: string | null, var_: number, affected = 10): RuleRow => ({ check_id: id, name: id, field: f, severity: "high", affected_count: affected, total_count: 100, pass_rate: 90, value_at_risk: var_ });
const impact = (feature: string, status: "blocked" | "degraded" | "ok", ids: string[]): ImpactResult => ({ feature, system: "S/4", status, blocking_findings: ids.map((c) => ({ check_id: c, module: "m" })), total_affected_records: 5, blocked_transactions: [], opportunity_cost_summary: "" });

describe("lineage graph", () => {
  const rules = [rule("R1", "MARA.MEINS", 300), rule("R2", "MARA.MTART", 200), rule("R3", "MARC.EKGRP", 100), rule("R4", null, 900)];
  it("links tables to fields to rules to the features they block, skipping features that are ok", () => {
    const g = buildLineage(rules, [impact("F1", "blocked", ["R1", "R2"]), impact("F2", "degraded", ["R3"]), impact("F3", "ok", ["R1"])], "m");
    const ids = (k: string) => g.nodes.filter((n) => n.kind === k).map((n) => n.id);
    expect(ids("table")).toEqual(["table:MARA", "table:MARC"]);
    expect(ids("field")).toEqual(["field:MARA.MEINS", "field:MARA.MTART", "field:MARC.EKGRP"]);
    expect(ids("rule")).toEqual(["rule:R1", "rule:R2", "rule:R3"]);
    expect(ids("feature")).toEqual(["feature:F1", "feature:F2"]);
    expect(g.edges).toHaveLength(3 + 3 + 3);
    expect(g.hidden).toBe(1); // R4 reads no field
  });
  it("keeps the rules with the most value at risk when it has to cut, and says how many it left out", () => {
    const g = buildLineage(rules, [], "m", 2);
    expect(g.nodes.filter((n) => n.kind === "rule").map((n) => n.label)).toEqual(["R1", "R2"]);
    expect(g.hidden).toBe(2);
  });
  it("lays each column out on its own x and gives every node a distinct row within its column", () => {
    const g = buildLineage(rules, [impact("F1", "blocked", ["R1"])], "m");
    const col = (k: string) => g.nodes.filter((n) => n.kind === k);
    expect(new Set(g.nodes.map((n) => n.x)).size).toBe(4);
    expect(new Set(col("field").map((n) => n.y)).size).toBe(col("field").length);
  });
  it("lists the fields the rules read that have no term, once each", () => {
    expect(fieldsWithoutTerm([...rules, rule("R5", "MARA.MEINS", 1)], new Set(["MARA.MTART"]))).toEqual([
      { field: "MARA.MEINS", rules: ["R1", "R5"] },
      { field: "MARC.EKGRP", rules: ["R3"] },
    ]);
  });
});
