import { describe, expect, it } from "vitest";
import { ddicRuleName } from "@/lib/rule-name";

describe("ddicRuleName", () => {
  it("names each DDIC conformance kind with its table", () => {
    expect(ddicRuleName("DDIC-MARA-TYPE")).toBe("Value does not match the field's SAP data type (MARA)");
    expect(ddicRuleName("DDIC-BSIK-LENGTH")).toBe("Value exceeds the field's SAP length or precision (BSIK)");
    expect(ddicRuleName("DDIC-ADRC-CASE")).toBe("Lower-case value in an upper-case SAP field (ADRC)");
    expect(ddicRuleName("DDIC-BUT000-FIXED_VALUE")).toBe("Value is not one of the domain's fixed values (BUT000)");
    expect(ddicRuleName("DDIC-T001-CHECK_TABLE")).toBe("Value does not exist in the source system's check table (T001)");
  });

  it("leaves any other id unnamed", () => {
    expect(ddicRuleName("MM045")).toBeNull();
    expect(ddicRuleName("DDIC-MARA-OTHER")).toBeNull();
    expect(ddicRuleName(null)).toBeNull();
  });
});
