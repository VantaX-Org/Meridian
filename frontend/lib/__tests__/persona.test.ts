import { describe, expect, it } from "vitest";
import { ROLES } from "@/hooks/use-role";
import { homeHrefForRole, personaForRole } from "../persona";
import { capValue } from "../home-metrics";
import type { Version } from "@/types/api";

describe("personaForRole", () => {
  it("maps every legacy role to a persona (rbac.md 1.1)", () => {
    const got = Object.fromEntries(ROLES.map((r) => [r, personaForRole(r)]));
    expect(got).toEqual({
      admin: "lead", manager: "lead", auditor: "lead", viewer: "lead",
      steward: "steward", approver: "steward", analyst: "analyst", ai_reviewer: "analyst",
    });
  });

  it("sends steward-persona roles to the steward home and everyone else to lead", () => {
    expect(homeHrefForRole("approver")).toBe("/home/steward");
    expect(homeHrefForRole("analyst")).toBe("/home/lead");
  });
});

describe("capValue", () => {
  const v = (reasons: (string | null)[]) =>
    ({ dqs_summary: Object.fromEntries(reasons.map((r, i) => [`m${i}`, { capped: r !== null, cap_reason: r }])) }) as unknown as Version;
  it("returns the lowest cap named in a reason, or null", () => {
    expect(capValue(v(["3 critical failures — score capped at 70", "1 critical failure — score capped at 85"]))).toBe(70);
    expect(capValue(v([null]))).toBeNull();
  });
});
