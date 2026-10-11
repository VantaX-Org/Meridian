import { describe, expect, it } from "vitest";
import { ROLES } from "@/hooks/use-role";
import { homeHrefForRole, personaForRole } from "../persona";

describe("personaForRole", () => {
  it("maps every legacy role to a persona (rbac.md 1.1)", () => {
    const got = Object.fromEntries(ROLES.map((r) => [r, personaForRole(r)]));
    expect(got).toEqual({
      admin: "lead", manager: "lead", auditor: "lead", viewer: "lead",
      steward: "steward", approver: "steward", analyst: "analyst", ai_reviewer: "analyst",
      process_analyst: "process",
    });
  });

  it("sends steward-persona roles to the steward home and everyone else to lead", () => {
    expect(homeHrefForRole("approver")).toBe("/home/steward");
    expect(homeHrefForRole("analyst")).toBe("/home/lead");
    expect(homeHrefForRole("process_analyst")).toBe("/home/process");
  });
});
