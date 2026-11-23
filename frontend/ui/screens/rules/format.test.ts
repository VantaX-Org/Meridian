import { describe, expect, it } from "vitest";
import { ruleCheck } from "./format";

describe("ruleCheck", () => {
  it("reads the check id from a library rule name when the id is a row UUID", () => {
    expect(ruleCheck({ id: "6f1c2b9e-0000-4000-8000-000000000001", name: "MM142: Base unit is missing" })).toBe("MM142");
  });
  it("falls back to the id without its fixture prefix when the name has no code", () => {
    expect(ruleCheck({ id: "rule-MM142", name: "Base unit is missing" })).toBe("MM142");
  });
});
