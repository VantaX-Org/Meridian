import { describe, expect, it } from "vitest";
import { buildInsight, sectionOf, showsRouteInsight, type InsightFacts } from "./route-insight";

const empty: InsightFacts = { hasRun: false, dqs: null, prevDqs: null, critical: 0, total: 0, affected: 0, systems: 0, waves: 0, backlog: null };

describe("route insight", () => {
  it("maps routes to sections and skips the design showcase", () => {
    expect(sectionOf("/objects/material_master")).toBe("objects");
    expect(sectionOf("/design")).toBeNull();
    expect(sectionOf("/nope")).toBeNull();
  });
  it("shows the shell banner on the persona homes only", () => {
    expect(showsRouteInsight("/home")).toBe(true);
    expect(showsRouteInsight("/home/basis")).toBe(true);
    expect(showsRouteInsight("/homework")).toBe(false);
    expect(showsRouteInsight("/insights")).toBe(false);
    expect(showsRouteInsight("/objects/material_master")).toBe(false);
  });
  it("gives a designed fresh-install sentence for every cell and uses the day-one step", () => {
    const h = buildInsight("home", { ...empty, dayOne: { label: "Connect a system", href: "/systems" } });
    expect(h.situation.sentence).toMatch(/Nothing has been analysed yet/);
    expect(h.changed.sentence).toMatch(/Nothing has changed yet/);
    expect(h.next.action?.href).toBe("/systems");
  });
  it("says analysis is running while no run has finished, and renders a status step without a button", () => {
    const h = buildInsight("runs", { ...empty, running: 2, dayOne: { label: "Analysis is running", href: "/runs/r2", status: true } });
    expect(h.situation.sentence).toBe("Analysis is running for 2 runs. The score appears here when it finishes.");
    expect(h.situation.href).toBe("/runs");
    expect(h.next.sentence).toBe("Analysis is running");
    expect(h.next.href).toBe("/runs/r2");
    expect(h.next.action).toBeUndefined();
  });
  it("builds live sentences from aggregate fields", () => {
    const h = buildInsight("objects", {
      ...empty, hasRun: true, runId: "r1", dqs: 72.4, prevDqs: 70, critical: 3, total: 120, affected: 4500,
      worst: { module: "material_master", label: "Material master", findings: 61, critical: 2 },
    });
    expect(h.situation.sentence).toBe("Quality is at 72.4, with 120 failing rules of all severities and 4,500 rule failures.");
    expect(h.changed.sentence).toBe("Up 2.4 points since the last run.");
    expect(h.why.sentence).toMatch(/^3 critical failing rules could stop go-live/);
    expect(h.next.href).toBe("/objects/material_master?run=r1");
    expect(h.next.sentence).toBe("Material master needs the most work: 61 failing rules, 2 of them critical.");
  });
  it("names the cap in the unit Home's hero and the executive summary use: capping rules and capped objects", () => {
    const base = { ...empty, hasRun: true, dqs: 64, prevDqs: null, critical: 74, total: 300, affected: 9000 };
    const capped = buildInsight("home", { ...base, cap: { rules: 8, named: [], capped: 11, measured: 15, cap: null } });
    expect(capped.why.sentence).toMatch(/^8 critical failing rules cap 11 of 15 objects and could stop go-live\./);
    expect(capped.why.sentence).not.toMatch(/74/);
    // critical rules within tolerance cap nothing, and the cell says so instead of claiming a cap
    const none = buildInsight("home", { ...base, critical: 2, cap: { rules: 0, named: [], capped: 0, measured: 15, cap: null } });
    expect(none.why.sentence).toMatch(/^2 critical failing rules, none capping the score\./);
  });
  it("offers no second button on the homes, where the verdict's action is the next step", () => {
    const facts: InsightFacts = {
      ...empty, hasRun: true, runId: "r1", dqs: 72.4, prevDqs: 70, critical: 3, total: 120, affected: 4500,
      worst: { module: "material_master", label: "Material master", findings: 61, critical: 2 },
    };
    const home = buildInsight("home", facts);
    expect(home.next.href).toBe("/objects/material_master?run=r1");
    expect(home.next.action).toBeUndefined();
    expect(buildInsight("objects", facts).next.action?.label).toBe("Open object");
  });
  it("builds the Changed cell from the compare delta and links the compare view", () => {
    const h = buildInsight("runs", {
      ...empty, hasRun: true, runId: "r2", dqs: 70, prevDqs: 74.2, critical: 0, total: 5, affected: 9,
      moved: { count: 3, biggest: { label: "Material master", change: -4.2 }, href: "/runs/r2/vs/r1" },
    });
    expect(h.changed.sentence).toBe("Down 4.2 points; 3 objects moved; biggest: Material master -4.2.");
    expect(h.changed.href).toBe("/runs/r2/vs/r1");
  });
  it("falls back to the score delta when no compare data exists", () => {
    const h = buildInsight("runs", { ...empty, hasRun: true, runId: "r2", dqs: 70, prevDqs: 74, critical: 0, total: 5, affected: 9 });
    expect(h.changed.sentence).toBe("Down 4 points since the last run.");
  });
});

describe("route insight lineage and money", () => {
  it("says this is the first run for the object instead of comparing with another object", () => {
    const h = buildInsight("objects", { ...empty, hasRun: true, runId: "r1", dqs: 70, prevDqs: null, firstRun: true, critical: 0, total: 5, affected: 9 });
    expect(h.changed.sentence).toBe("This is the first run of this object, so there is nothing to compare with yet.");
  });
  it("names the cost at risk as cost at risk, short, in the tenant currency", () => {
    const h = buildInsight("objects", { ...empty, hasRun: true, runId: "r1", dqs: 70, prevDqs: 70, critical: 0, total: 5, affected: 9, costAtRisk: 4840487383, currency: "ZAR" });
    // Cost at risk (failing records times their cost), never "value at risk" (blocked SAP features), a different figure.
    expect(h.why.sentence).toContain("Cost at risk of the failing records: ZAR 4.84 bn.");
    expect(h.why.sentence).not.toMatch(/value at risk|4840487383/i);
  });
  it("names the scope's one next step when it is given, the step the overview and the summary name", () => {
    const doNext = { sentence: "HCM personnel administration comes first, the lowest score at 64.5: fix PA021, which caps it", href: "/fix?module=hcm&check=PA021", label: "Fix PA021" };
    const worst = { module: "employee_central", label: "Employee central", findings: 376, critical: 27 };
    const home = buildInsight("home", { ...empty, hasRun: true, dqs: 72, prevDqs: 72, critical: 1, total: 5, affected: 9, worst, doNext });
    expect(home.next.sentence).toBe(`${doNext.sentence}.`);
    expect(home.next.href).toBe(doNext.href);
    // The home's verdict carries the one button; other sections get the step's own action.
    expect(home.next.action).toBeUndefined();
    expect(buildInsight("objects", { ...empty, hasRun: true, dqs: 72, prevDqs: 72, critical: 1, total: 5, affected: 9, worst, doNext }).next.action)
      .toEqual({ label: "Fix PA021", href: doNext.href });
  });
  it("holds the value-at-risk sentence until the currency is known, never a bare number", () => {
    const h = buildInsight("objects", { ...empty, hasRun: true, runId: "r1", dqs: 70, prevDqs: 70, critical: 0, total: 5, affected: 9, costAtRisk: 1008920, currency: undefined });
    expect(h.why.sentence).not.toMatch(/at risk/);
    expect(h.why.sentence).toBe("Nothing critical, so nothing caps the score.");
  });
});
