import { describe, expect, it } from "vitest";
import { fixtureResponse, landscapeFixture, syntheticRules } from "./index";
import type { CommandResult, Receipt, RuleRow, WorkPage } from "../types";
import { fixtureCarry, withFixture } from "../fixture";

const L = landscapeFixture;

describe("landscape fixture reconciles with the approved prototype", () => {
  it("has 3 systems in the three states and 15 objects scored on ECC production", () => {
    expect(L.systems.map((s) => [s.name, s.state])).toEqual([["ECC production", "analysed"], ["S/4HANA sandbox", "extracted"], ["SuccessFactors", "not_extracted"]]);
    expect(L.objects).toHaveLength(15);
    expect(L.cells).toHaveLength(15);
    expect(new Set(L.cells.map((c) => c.system_id))).toEqual(new Set([L.systems[0].id]));
  });

  it("counts: 2 go, 2 at risk, 11 no-go, and the counts match the cells", () => {
    expect(L.counts).toEqual({ go: 2, at_risk: 2, no_go: 11 });
    for (const [verdict, key] of [["go", "go"], ["at-risk", "at_risk"], ["no-go", "no_go"]] as const) expect(L.cells.filter((c) => c.verdict === verdict).length).toBe(L.counts[key]);
  });

  it("the sentence is computed from the cells: 11 held at 70 by 30 critical rules, MM003 and MM035 release 1", () => {
    expect(L.sentence).toEqual({ held_under_85: 11, objects: 15, critical_over_tolerance: 30, release_if_fixed: ["MM003", "MM035"], released: 1 });
    const held = L.cells.filter((c) => c.capped && c.cap_level === 70);
    expect(held).toHaveLength(11);
    expect(held.reduce((n, c) => n + c.breaches.length, 0)).toBe(29);
    const releasable = L.cells.filter((c) => c.breaches.length > 0 && c.breaches.every((b) => L.sentence.release_if_fixed.includes(b)));
    expect(releasable.map((c) => c.module).sort()).toEqual(["material_master"]);
  });

  it("the status strip equals the sum of the cells: 400,662 records and 794 rules", () => {
    expect(L.cells.reduce((n, c) => n + (c.records_checked ?? 0), 0)).toBe(L.status_strip.records_checked);
    expect(L.cells.reduce((n, c) => n + (c.rules_measured ?? 0), 0)).toBe(L.status_strip.rules_measured);
    expect(L.status_strip).toMatchObject({ records_checked: 400662, rules_measured: 794, scored_in_s: 702, cost_model: "ZAR", licence_valid_to: "2027-03-31" });
  });

  it("Material master measures 71.8 and shows 70.0, capped by two critical rules", () => {
    const mm = L.cells.find((c) => c.module === "material_master");
    expect(mm).toMatchObject({ raw_score: 71.8, score: 70, capped: true, cap_level: 70, breaches: ["MM003", "MM035"], verdict: "no-go", records_checked: 61816, rules_measured: 80, open_work: 25712 });
    expect(mm?.dimensions).toEqual({ completeness: 62, accuracy: 72, consistency: 70, timeliness: 88, uniqueness: 90, validity: 65 });
  });

  it("verdicts follow the rule: go needs 90 and no critical over tolerance; at risk needs 75", () => {
    for (const c of L.cells) {
      const score = c.score ?? 0;
      const expected = score >= 90 && c.breaches.length === 0 ? "go" : score >= 75 ? "at-risk" : "no-go";
      expect(c.verdict, c.module).toBe(expected);
    }
  });

  it("states its low coverage: only Plant maintenance is under the 70% line", () => {
    expect(L.cells.filter((c) => c.low_confidence).map((c) => c.module)).toEqual(["plant_maintenance"]);
  });
});

describe("receipt fixtures", () => {
  const receipts = L.objects.map((o) => fixtureResponse<Receipt>(`/objects/${o.module}/receipt`, {}));

  it("one receipt per object, and an unknown object is a 404", () => {
    expect(receipts).toHaveLength(15);
    expect(() => fixtureResponse("/objects/nope/receipt", {})).toThrowError(expect.objectContaining({ status: 404 }));
  });

  it("weights sum to 1 and are 25/25/20/10/10/10", () => {
    for (const r of receipts) {
      expect(r.dimensions.map((d) => d.weight)).toEqual([0.25, 0.25, 0.2, 0.1, 0.1, 0.1]);
      expect(r.dimensions.reduce((n, d) => n + d.weight, 0)).toBeCloseTo(1, 6);
    }
  });

  it("points are score times weight and add up to the weighted score, which equals the measured score", () => {
    for (const r of receipts) {
      for (const d of r.dimensions) expect(Math.abs((d.points ?? 0) - (d.score ?? 0) * d.weight)).toBeLessThanOrEqual(0.051);
      const sum = r.dimensions.reduce((n, d) => n + (d.points ?? 0), 0);
      expect(Math.abs(sum - (r.weighted ?? 0)), r.module).toBeLessThan(0.15);
      expect(r.weighted).toBe(r.measured);
    }
  });

  it("the shown score is the cap when capped and the measured score otherwise, and agrees with the landscape cell", () => {
    for (const r of receipts) {
      const cell = L.cells.find((c) => c.module === r.module);
      expect(r.score).toBe(cell?.score);
      expect(r.capped).toBe(cell?.capped);
      expect(r.score).toBe(r.capped ? r.cap_level : r.measured);
      expect(r.breaches.map((b) => b.check_id)).toEqual(cell?.breaches);
    }
  });

  it("Material master carries the prototype's receipt: ZAR 4.2 m at risk, 3 blocked and 5 degraded features, 25,712 to fix", () => {
    const mm = fixtureResponse<Receipt>("/objects/material_master/receipt", {});
    expect(mm).toMatchObject({ value_at_risk: 4200000, currency: "ZAR", features_blocked: 3, features_degraded: 5, open_work: 25712, tolerance: { pct: 0.1, rows: 25 } });
    expect(mm.breaches.map((b) => [b.check_id, b.failing])).toEqual([["MM003", 2904], ["MM035", 1420]]);
    expect(mm.severity_weights).toEqual({ critical: 4, high: 3, medium: 2, low: 1 });
    expect(mm.cap_rule).toBe("85 at one critical rule over tolerance, 70 at two or more");
  });

  it("never invents a figure it does not hold: other objects have null value at risk; their capping rules fail as the rules library says", () => {
    const bp = fixtureResponse<Receipt>("/objects/business_partner/receipt", {});
    expect(bp.value_at_risk).toBeNull();
    expect(bp.open_work).toBeNull();
    expect(bp.breaches.every((b) => (b.failing ?? 0) > (b.tolerance_rows ?? 0))).toBe(true);
  });
});

describe("the other fixture reads", () => {
  it("work: the top rows are ranked by value at risk and the total is 25,712", () => {
    const page = fixtureResponse<WorkPage>("/work/records", { limit: 5 });
    expect(page.items).toHaveLength(5);
    expect(page.total).toBe(25712);
    const v = page.items.map((r) => r.value_at_risk ?? 0);
    expect(v).toEqual([...v].sort((a, b) => b - a));
  });

  it("versions: the last 8 runs, newest first", () => {
    const list = fixtureResponse<{ versions: { run_at: string }[] }>("/versions", { limit: 8 });
    expect(list.versions).toHaveLength(8);
    const at = list.versions.map((r) => r.run_at);
    expect(at).toEqual([...at].sort().reverse());
    expect(at[0]).toBe("2026-10-16T05:17:00Z");
  });

  it("shell counts: 25,712 to fix and 7 in the inbox", () => {
    expect(fixtureResponse("/shell/counts", {})).toEqual({ fix: 25712, inbox: 7 });
  });

  it("command: a rule id, a material number and a word each find their group", () => {
    const rule = fixtureResponse<CommandResult>("/command", { q: "mm142" });
    expect(rule.groups.find((g) => g.kind === "rule")?.items[0].title).toBe("MM142: Base unit of measure MEINS must reference a valid entry in T006");
    const rec = fixtureResponse<CommandResult>("/command", { q: "101" });
    expect(rec.groups.find((g) => g.kind === "record")?.items[0].title).toContain("000000000000000101");
    const act = fixtureResponse<CommandResult>("/command", { q: "export" });
    expect(act.groups.find((g) => g.kind === "action")?.items[0].title).toBe("Export fix sheet");
    expect(fixtureResponse<CommandResult>("/command", { q: "zzzzqq" }).groups).toEqual([]);
  });

  it("rules: Material master has its 8 ranked rules; a rows param builds a long synthetic list", () => {
    expect(fixtureResponse<{ rules: RuleRow[] }>("/findings", { module: "material_master" }).rules).toHaveLength(8);
    expect(fixtureResponse<{ rules: RuleRow[] }>("/findings", { module: "material_master", rows: 100000 }).rules).toHaveLength(100000);
    const synthetic = syntheticRules(5);
    expect(synthetic.map((r) => r.check_id)).toEqual(["ZR000001", "ZR000002", "ZR000003", "ZR000004", "ZR000005"]);
  });

  it("an unknown path is a 404", () => {
    expect(() => fixtureResponse("/nothing", {})).toThrowError(expect.objectContaining({ status: 404 }));
  });
});

describe("withFixture", () => {
  it("appends fixture=1 to a href, once, before a hash, only when on", () => {
    expect(withFixture("/", true)).toBe("/?fixture=1");
    expect(withFixture("/?a=1", true)).toBe("/?a=1&fixture=1");
    expect(withFixture("/?fixture=1", true)).toBe("/?fixture=1");
    expect(withFixture("/#x", true)).toBe("/?fixture=1#x");
    expect(withFixture("/", false)).toBe("/");
  });

  it("carries the role and persona the page was opened as, unless the href sets its own", () => {
    expect(withFixture("/work?filter=approvals", true, { role: "data_owner" })).toBe("/work?filter=approvals&fixture=1&role=data_owner");
    expect(withFixture("/?open=job:j1#a", true, { role: "sap_basis", persona: "basis" })).toBe("/?open=job:j1&fixture=1&role=sap_basis&persona=basis#a");
    expect(withFixture("/?role=auditor", true, { role: "sap_basis" })).toBe("/?role=auditor&fixture=1");
    expect(withFixture("/", false, { role: "sap_basis" })).toBe("/");
  });

  it("fixtureCarry reads role and persona from the address", () => {
    window.history.replaceState(null, "", "/work?fixture=1&role=data_steward&x=1");
    expect(fixtureCarry()).toEqual({ role: "data_steward" });
    window.history.replaceState(null, "", "/");
    expect(fixtureCarry()).toEqual({});
  });
});
