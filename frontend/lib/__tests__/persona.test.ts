import { describe, expect, it } from "vitest";
import { ROLES } from "@/hooks/use-role";
import { PERSONA_OPTIONS, homeHrefForRole, personaForRole } from "../persona";

describe("personaForRole", () => {
  it("maps every legacy role to a persona (rbac.md 1.1)", () => {
    const got = Object.fromEntries(ROLES.map((r) => [r, personaForRole(r)]));
    expect(got).toEqual({
      admin: "lead", manager: "lead", auditor: "lead", viewer: "lead",
      steward: "steward", approver: "steward", analyst: "lead", ai_reviewer: "lead",
      process_analyst: "process", sap_basis: "basis",
    });
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
