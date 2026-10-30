import { describe, expect, it } from "vitest";
import { EMPTY_FORM, formToBody, formToRule, parseConditions, ruleToForm, validateForm } from "./draft-model";

describe("draft model", () => {
  it("splits a rule into form fields and conditions", () => {
    const f = ruleToForm({ id: "ZR-1", field: "LFA1.STCD1", check_class: "regex_check", severity: "high", dimension: "validity", message: "bad", pattern: "^\\d+$" }, "accounts_payable");
    expect(f.id).toBe("ZR-1");
    expect(f.module).toBe("accounts_payable");
    expect(JSON.parse(f.conditions)).toEqual({ pattern: "^\\d+$" });
  });

  it("round-trips through the YAML body", () => {
    const f = ruleToForm({ id: "ZR-1", field: "LFA1.STCD1", check_class: "regex_check", severity: "high", dimension: "validity", message: "bad", pattern: "x" }, "m");
    const body = formToBody(f, "why");
    expect(body.module).toBe("m");
    expect(body.rationale).toBe("why");
    expect(JSON.parse(body.rule_yaml)).toEqual({ id: "ZR-1", field: "LFA1.STCD1", check_class: "regex_check", severity: "high", dimension: "validity", message: "bad", pattern: "x" });
  });

  it("form fields win over a same-named key in the conditions", () => {
    const rule = formToRule({ ...EMPTY_FORM, id: "A", module: "m", message: "x", conditions: '{"severity":"low","pattern":"p"}' });
    expect(rule.severity).toBe("medium");
    expect(rule.pattern).toBe("p");
  });

  it("drops a reserved key from the conditions when the form field is cleared", () => {
    const rule = formToRule({ ...EMPTY_FORM, id: "A", module: "m", message: "x", field: "", conditions: '{"field":"LFA1.STCD1","pattern":"p"}' });
    expect(rule.field).toBeUndefined();
    expect(rule.pattern).toBe("p");
  });

  it("rejects conditions that are not a JSON object", () => {
    expect(parseConditions("[1]").ok).toBe(false);
    expect(parseConditions("{oops").ok).toBe(false);
    expect(parseConditions("").ok).toBe(true);
  });

  it("names missing fields", () => {
    const errors = validateForm({ ...EMPTY_FORM, conditions: "nope" });
    expect(Object.keys(errors).sort()).toEqual(["conditions", "id", "message", "module"]);
  });
});
