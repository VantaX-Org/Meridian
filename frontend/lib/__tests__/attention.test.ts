import { describe, expect, it } from "vitest";
import { item } from "@/components/attention/__tests__/fixtures";
import { attentionAction, asOfTime, itemObject, kindLabel, scopeSentence } from "../attention";

describe("attention helpers", () => {
  it("takes the home action only from blocked work, regressions and freshness", () => {
    expect(attentionAction(item({ tier: 1 }))).toEqual({ label: "Open system", href: "/systems/s1" });
    expect(attentionAction(item({ tier: 3 }))?.label).toBe("Open system");
    expect(attentionAction(item({ tier: 4 }))).toBeUndefined();
    expect(attentionAction(item({ tier: 5 }))).toBeUndefined();
    expect(attentionAction(null)).toBeUndefined();
  });

  it("names the object by its module, never the API label", () => {
    expect(itemObject({ module: "fi_gl", object: "General ledger (FI)" })).toBe("FI general ledger");
    expect(itemObject({ module: null, object: null })).toBeNull();
  });

  it("words a kind, and an unknown one as its id", () => {
    expect(kindLabel("stale_object")).toBe("Stale objects");
    expect(kindLabel("brand_new_kind")).toBe("Brand new kind");
  });

  it("prints the time the list was built as hours and minutes", () => {
    expect(asOfTime("2026-10-28T14:32:00Z")).toMatch(/^\d{2}:\d{2}$/);
    expect(asOfTime("not a date")).toBe("—");
  });

  it("describes a scope in words", () => {
    const systems = new Map([["s1", "KSA PRD"]]);
    expect(scopeSentence([], systems)).toBe("every system and object");
    expect(scopeSentence([{ system_id: "s1", module: "material_master" }, { system_id: "s1", module: null }, { system_id: null, module: "fi_gl" }], systems))
      .toBe("Material master on KSA PRD, all objects on KSA PRD, FI general ledger");
  });
});
