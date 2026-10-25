import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLES, roleLabel } from "@/lib/roles";

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
