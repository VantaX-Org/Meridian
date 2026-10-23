import { describe, expect, it } from "vitest";
import { ROLES, isRole, legacyRole } from "@/hooks/use-role";
import { PERSONA_OPTIONS, homeHrefForRole, personaForRole } from "../persona";

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

  it("sends each persona key to its rbac.py PERSONA_HOME", () => {
    expect(homeHrefForRole("data_steward")).toBe("/home/steward");
    expect(homeHrefForRole("data_owner")).toBe("/home/steward");
    expect(homeHrefForRole("programme_lead")).toBe("/home/lead");
    expect(homeHrefForRole("platform_admin")).toBe("/home/lead");
  });

  it("maps persona keys to the legacy key they inherit (rbac.py PERSONA_ALIAS)", () => {
    expect(legacyRole("platform_admin")).toBe("admin");
    expect(legacyRole("programme_lead")).toBe("manager");
    expect(legacyRole("data_steward")).toBe("steward");
    expect(legacyRole("data_owner")).toBe("approver");
    expect(legacyRole("sap_basis")).toBe("sap_basis");
  });

  it("sends steward-persona roles to the steward home and everyone else to lead", () => {
    expect(homeHrefForRole("approver")).toBe("/home/steward");
    expect(homeHrefForRole("analyst")).toBe("/home/lead");
    expect(homeHrefForRole("process_analyst")).toBe("/home/process");
  });

  it("sends the SAP basis role to the basis home", () => {
    expect(homeHrefForRole("sap_basis")).toBe("/home/basis");
  });

  it("offers every persona a role can land on, and only those, under View as", () => {
    const landed = new Set(ROLES.map(personaForRole));
    expect(new Set(PERSONA_OPTIONS.map((o) => o.value))).toEqual(landed);
  });
});
