import { describe, expect, it } from "vitest";
import { breachWords, capWords, gateWords, recordsByModule, rulerOfState, sentenceWords, signed1, thresholdsFromDraft } from "./step9";
import type { SimState } from "@/lib/api/v2/step9";
import type { WorkRow } from "@/lib/api/v2/types";
import { setLang } from "./i18n";

describe("step 9 words in German and Japanese", () => {
  it("come from the catalogue", () => {
    try {
      setLang("de");
      expect(capWords({ score: 70, raw_score: 84.72, cap_level: 70, breaches: ["MM001", "MM005"], dimensions: {}, verdict: "no-go", features_blocked: 0, features_degraded: 0, wave_gate: [] })).toBe("Bei 70 gedeckelt durch MM001 und MM005");
      expect(breachWords({ metric: "score", threshold: 85, actual: 70 })).toMatch(/, braucht 85 oder mehr$/);
      setLang("ja");
      expect(gateWords({ wave_id: "w", name: "W1", open: true, reasons: [] })).toBe("W1: ゲート開");
    } finally {
      setLang("en");
    }
  });
});

const state = (over: Partial<SimState>): SimState => ({ score: 70, raw_score: 84.72, cap_level: 70, breaches: ["MM001", "MM005"], dimensions: { completeness: 98.33, accuracy: 85, validity: 50 }, verdict: "no-go", features_blocked: 2, features_degraded: 1, wave_gate: [], ...over });

describe("step 9 words", () => {
  it("draws a simulated state on the ruler, unmeasured dimensions null", () => {
    const r = rulerOfState(state({}));
    expect(r.dims).toEqual([98.33, 85, null, null, null, 50]);
    expect(r.capped).toBe(true);
    expect(rulerOfState(state({ score: 99.31, raw_score: 99.31, cap_level: null, breaches: [] })).capped).toBe(false);
  });

  it("says the cap, the change and the gate in words", () => {
    expect(capWords(state({}))).toBe("Capped at 70 by MM001 and MM005");
    expect(capWords(state({ score: 72.4, raw_score: 72.4, cap_level: null, breaches: ["MM005"] }))).toBe("Not capped: measured 72.4 is under the cap of 85");
    expect(capWords(state({ score: 99, raw_score: 99, cap_level: null, breaches: [] }))).toBe("No cap: no critical rule over tolerance");
    expect(signed1(15)).toBe("+15.0");
    expect(signed1(-1.24)).toBe("-1.2");
    expect(signed1(null)).toBe("—");
    expect(gateWords({ wave_id: "w", name: "Wave 1", open: false, reasons: ["2 critical rule(s) over tolerance"] })).toBe("Wave 1: gate closed, 2 critical rule(s) over tolerance");
  });

  it("writes the landscape sentence as /landscape does", () => {
    expect(sentenceWords({ held_under_85: 1, objects: 1, critical_over_tolerance: 2, release_if_fixed: ["MM001", "MM005"], released: 1 })).toBe("1 of 1 objects are held under 85 by 2 critical rules over tolerance; fixing MM001 and MM005 would release 1 of them.");
    expect(sentenceWords({ held_under_85: 0, objects: 1, critical_over_tolerance: 0, release_if_fixed: [], released: 0 })).toBe("0 of 1 objects are held under 85 by 0 critical rules over tolerance.");
  });

  it("groups selected rows by object, the largest first", () => {
    const r = (module: string, key: string) => ({ module, record_key: key }) as WorkRow;
    expect(recordsByModule([r("a", "1"), r("b", "2"), r("b", "3")]).map((g) => [g.module, g.records.length])).toEqual([["b", 2], ["a", 1]]);
  });

  it("reads contract thresholds from the editor and words a breach", () => {
    expect(thresholdsFromDraft({ min_score: "85", max_critical: "", dims: { validity: "60", accuracy: "" } })).toEqual({ min_score: 85, dimensions: { validity: 60 } });
    expect(thresholdsFromDraft({ min_score: "101", max_critical: "", dims: {} })).toBeNull();
    expect(breachWords({ metric: "validity", threshold: 60, actual: 50 })).toBe("Validity 50.0, needs 60 or more");
    expect(breachWords({ metric: "score", threshold: 80, actual: null })).toBe("Score not measured, needs 80 or more");
  });
});
