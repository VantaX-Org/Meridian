import { describe, expect, it } from "vitest";
import { atRiskSentence, findingsHref, pct } from "../links";

describe("lineage pass rate", () => {
  it("prints the API's 0 to 100 pass rate as is, never times 100", () => {
    expect(pct(90.81)).toBe("90.8%");
    expect(pct(0)).toBe("0.0%");
    expect(pct(null)).toBe("");
  });
});

describe("lineage findings link", () => {
  const modules = new Map([["CO098", "controlling"]]);
  it("opens one rule's failing records on its object page, scoped to the run", () => {
    expect(findingsHref(["CO098"], "run-1", (id) => modules.get(id))).toBe("/objects/controlling?tab=records&check=CO098&run=run-1");
  });
  it("never links /rules/<check id> (the rule page takes a rule uuid)", () => {
    expect(findingsHref(["CO098"], "run-1", (id) => modules.get(id))).not.toMatch(/^\/rules\//);
    expect(findingsHref(["CO056"], "run-1", (id) => modules.get(id))).toBe("/insights/rules?run=run-1");
  });
  it("opens the run's rule list for several rules", () => {
    expect(findingsHref(["CO098", "CO056"], "run-1", (id) => modules.get(id))).toBe("/insights/rules?run=run-1");
    expect(findingsHref(["CO098", "CO056"], undefined, () => undefined)).toBe("/insights/rules");
  });
});

describe("lineage at-risk sentence", () => {
  it("leaves zero counts out and agrees the verb", () => {
    expect(atRiskSentence(0, 0)).toBe("No KPI or feature is at risk");
    expect(atRiskSentence(3, 0)).toBe("3 KPIs are at risk");
    expect(atRiskSentence(0, 1)).toBe("1 feature is at risk");
    expect(atRiskSentence(2, 4)).toBe("2 KPIs and 4 features are at risk");
  });
});
