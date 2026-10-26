import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_ROLE_KEYS, ROLES, grantLabel, grantScopeLabel, grantableRoles, roleLabel } from "@/lib/roles";

describe("grants", () => {
  it("offers no legacy key for a new grant, flagged or not", () => {
    const roles = ["platform_admin", "admin", "manager", "steward", "approver", "ai_reviewer", "analyst", "custom:ops"]
      .map((key) => ({ key, legacy: key === "admin" }));
    expect(grantableRoles(roles).map((r) => r.key)).toEqual(["platform_admin", "analyst", "custom:ops"]);
    expect([...LEGACY_ROLE_KEYS].sort()).toEqual(["admin", "ai_reviewer", "approver", "manager", "steward"]);
  });

  it("names a grant's scope in words", () => {
    expect(grantScopeLabel(null, null)).toBe("All systems");
    expect(grantScopeLabel("ECC prod", null)).toBe("ECC prod");
    expect(grantScopeLabel(null, "fi_gl")).toBe("FI general ledger");
    expect(grantScopeLabel("ECC prod", "fi_gl")).toBe("ECC prod / FI general ledger");
    expect(grantLabel(undefined, "steward", null, null)).toBe("Steward (legacy), All systems");
    expect(grantLabel("Ops lead", "custom:ops", "ECC prod", null)).toBe("Ops lead, ECC prod");
  });
});

describe("roleLabel", () => {
  it("names every role in words, never the raw key", () => {
    expect(roleLabel("sap_basis")).toBe("SAP Basis / integration admin");
    expect(roleLabel("data_steward")).toBe("Data steward");
    for (const r of ROLES) expect(roleLabel(r)).not.toMatch(/_/);
  });

  it("sentence-cases a key it does not know", () => {
    expect(roleLabel("new_role")).toBe("New role");
  });

  it("is what the account menu shows for the signed-in role", () => {
    const src = readFileSync(join(__dirname, "../../components/user-menu.tsx"), "utf8");
    expect(src).toContain("roleLabel(user.role)");
    expect(src).not.toContain("{user.role}");
  });
});
