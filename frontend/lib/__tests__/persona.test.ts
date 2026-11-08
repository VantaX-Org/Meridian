import { describe, expect, it } from "vitest";
import { ROLES, isRole, legacyRole } from "@/hooks/use-role";
import { PERSONA_OPTIONS, homeRoleFrom, personaForRole, pillSetFor } from "../persona";

describe("personaForRole", () => {
  it("maps every legacy role to a persona (rbac.md 1.1)", () => {
    const got = Object.fromEntries(ROLES.map((r) => [r, personaForRole(r)]));
    expect(got).toEqual({
      admin: "lead", manager: "lead", auditor: "lead", viewer: "lead",
      steward: "steward", approver: "steward", analyst: "lead", ai_reviewer: "lead",
      process_analyst: "process", sap_basis: "basis",
      programme_lead: "lead", data_steward: "steward", data_owner: "steward", platform_admin: "lead",
    });
  });

  it("recognises every role key the API can return (rbac.py VALID_ROLES)", () => {
    const valid = [
      "admin", "manager", "steward", "analyst", "approver", "auditor", "ai_reviewer", "viewer",
      "programme_lead", "data_steward", "data_owner", "sap_basis", "platform_admin", "process_analyst",
    ];
    expect(valid.filter((r) => !isRole(r))).toEqual([]);
    expect(isRole("superuser")).toBe(false);
  });

  it("maps persona keys to the legacy key they inherit (rbac.py PERSONA_ALIAS)", () => {
    expect(legacyRole("platform_admin")).toBe("admin");
    expect(legacyRole("programme_lead")).toBe("manager");
    expect(legacyRole("data_steward")).toBe("steward");
    expect(legacyRole("data_owner")).toBe("approver");
    expect(legacyRole("sap_basis")).toBe("sap_basis");
  });

  it("gives the data owner (and the legacy approver) their own pill set, everyone else their persona's", () => {
    expect(pillSetFor("data_owner")).toBe("owner");
    expect(pillSetFor("approver")).toBe("owner");
    expect(pillSetFor("data_steward")).toBe("steward");
    expect(pillSetFor("sap_basis")).toBe("basis");
    expect(pillSetFor("process_analyst")).toBe("process");
    expect(pillSetFor("platform_admin")).toBe("lead");
  });

  it("offers every persona a role can land on, and only those, under View as", () => {
    const landed = new Set(ROLES.map(personaForRole));
    expect(new Set(PERSONA_OPTIONS.map((o) => o.value))).toEqual(landed);
  });
});

describe("homeRoleFrom", () => {
  it("lands a scoped-only steward (users.role viewer) on Fix, not the lead home", () => {
    const role = homeRoleFrom("viewer", ["data_steward", "viewer"]);
    expect(role).toBe("data_steward");
  });

  it("keeps users.role when it already has a persona, or no grant has one", () => {
    expect(homeRoleFrom("sap_basis", ["data_steward"])).toBe("sap_basis");
    expect(homeRoleFrom("viewer", ["viewer", "custom:x", "analyst"])).toBe("viewer");
    expect(homeRoleFrom("viewer", [])).toBe("viewer");
  });
});
