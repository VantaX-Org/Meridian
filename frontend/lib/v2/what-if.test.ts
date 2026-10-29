import { describe, expect, it } from "vitest";
import { createElement } from "react";
import type { Receipt } from "@/lib/api/v2/types";
import type { StepView } from "./process-tree";
import { capFor, failingRules, simulate } from "./what-if";
import { columnsFromHidden, exportRows, hiddenFromColumns, nodeText } from "./grid-export";

const field = (field: string, status: "green" | "amber" | "red", check: string | null, affected = 0) =>
  ({ field, description: field, dq_status: status, check_id: check, affected_count: affected, pass_rate: null, finding_message: `${check} fails` }) as never;

function step(id: string, n: number, fields: ReturnType<typeof field>[]): StepView {
  const rules = (fields as { dq_status: string; check_id: string | null; affected_count: number; field: string }[])
    .filter((f) => f.dq_status !== "green" && f.check_id)
    .map((f) => ({ checkId: f.check_id as string, message: `${f.check_id} fails`, fields: [f.field], affected: f.affected_count, passRate: null }));
  const status = fields.some((f) => (f as { dq_status: string }).dq_status === "red") ? "red" : fields.some((f) => (f as { dq_status: string }).dq_status === "amber") ? "amber" : "green";
  return { id, l1Id: "PTP", l1Name: "Procure to Pay", l2Name: "", l3Name: "", name: id, tcode: "", description: "", status, blocked: status === "red", number: n, activities: [], fields, rules, recordsAtLeast: Math.max(0, ...rules.map((r) => r.affected)) } as StepView;
}

const steps = [
  step("GR", 3, [field("MARA.MEINS", "red", "MM014", 3640), field("MARA.MTART", "red", "MM031", 1000)]),
  step("PO", 2, [field("MARA.MATKL", "amber", "MM020", 12)]),
  step("PR", 1, [field("MARA.MATNR", "green", null)]),
];

describe("what if these rules were fixed", () => {
  it("opens a blocked step only when every red field of it is fixed", () => {
    expect(simulate(steps, ["MM014"]).blockedAfter).toBe(1);
    const both = simulate(steps, ["MM014", "MM031"]);
    expect(both.blockedBefore).toBe(1);
    expect(both.blockedAfter).toBe(0);
    expect(both.released.map((s) => s.id)).toEqual(["GR"]);
    expect(simulate(steps, ["MM020"]).steps.find((s) => s.id === "PO")?.after).toBe("green");
  });

  it("releases the score cap the receipt's way: one critical caps at 85, two at 70, none releases it", () => {
    expect([capFor(0), capFor(1), capFor(2), capFor(5)]).toEqual([null, 85, 70, 70]);
    const receipt = { score: 70, measured: 71.8, cap_level: 70, breaches: [{ check_id: "MM014" }, { check_id: "MM031" }] } as unknown as Receipt;
    expect(simulate(steps, ["MM014"], receipt).score).toMatchObject({ capAfter: 85, after: 71.8 });
    expect(simulate(steps, ["MM014", "MM031"], receipt).score).toMatchObject({ capAfter: null, after: 71.8 });
    expect(simulate(steps, [], receipt).score).toMatchObject({ capAfter: 70, after: 70 });
  });

  it("offers the failing rules most records first, once each", () => {
    expect(failingRules(steps).map((r) => r.checkId)).toEqual(["MM014", "MM031", "MM020"]);
  });
});

describe("grid export", () => {
  const cols = [
    { id: "name", header: "Name", cell: (r: { n: string }) => createElement("strong", null, r.n) },
    { id: "count", header: "Count", numeric: true, cell: (r: { c: number }) => createElement("span", null, r.c.toLocaleString("en-US")) },
    { id: "hidden", header: "Hidden", defaultHidden: true, cell: () => "x" },
  ] as never[];

  it("reads the text of a cell and keeps numbers as numbers", () => {
    expect(nodeText(createElement("span", null, "A ", createElement("b", null, "B"), 3))).toBe("A B3");
    expect(exportRows([{ n: "Material master", c: 25712 }] as never[], cols.slice(0, 2))).toEqual([{ name: "Material master", count: 25712 }]);
  });

  it("turns the hidden list into the /views columns and back", () => {
    expect(columnsFromHidden(cols, new Set(["hidden"]))).toEqual(["name", "count"]);
    expect(hiddenFromColumns(cols, ["count"])).toEqual(["name", "hidden"]);
  });
});
