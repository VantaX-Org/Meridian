import { describe, expect, it } from "vitest";
import { LEGACY_PERMISSIONS, type LegacyRole } from "../../e2e/fixtures/legacy-permissions";
import { actsOnNothing, homeActionFor, readOnlyLeadAction } from "../home-action";

const canFor = (role: LegacyRole) => (a: string) => (LEGACY_PERMISSIONS[role] as readonly string[]).includes(a);
const base = { belowTarget: 2, objectsHref: (f: boolean) => (f ? "/objects?readiness=warn%2Cfail" : "/objects"), worstHref: "/objects/fi_gl?run=v1", systemFailing: false };

describe("homeActionFor", () => {
  it("gives the auditor the audit log and keeps the lead's action for everyone who acts", () => {
    expect(homeActionFor({ ...base, persona: "lead", can: canFor("auditor") })).toEqual({ label: "Open audit log", href: "/admin/audit" });
    for (const r of ["admin", "manager", "analyst"] as const) {
      expect(homeActionFor({ ...base, persona: "lead", can: canFor(r) })).toEqual({ label: "Open objects below target", href: "/objects?readiness=warn%2Cfail" });
    }
    // A viewer has no audit log: the lead's action stays.
    expect(homeActionFor({ ...base, persona: "lead", can: canFor("viewer"), belowTarget: 0 })).toEqual({ label: "Open objects", href: "/objects" });
  });

  it("leaves read-only roles without a branch of their own on the lead action (the hook returns null)", () => {
    expect(actsOnNothing(canFor("auditor"))).toBe(true);
    expect(actsOnNothing(canFor("viewer"))).toBe(true);
    expect(actsOnNothing(canFor("approver"))).toBe(false);
    expect(readOnlyLeadAction(canFor("viewer"))).toBeNull();
    expect(readOnlyLeadAction(canFor("ai_reviewer"))).toBeNull();
    expect(readOnlyLeadAction(canFor("admin"))).toBeNull();
  });

  it("sends the data owner to approvals and the steward to the worst object", () => {
    expect(homeActionFor({ ...base, persona: "steward", can: canFor("approver") })).toEqual({ label: "Open approvals", href: "/inbox?kind=approvals" });
    expect(homeActionFor({ ...base, persona: "steward", can: canFor("steward") })).toEqual({ label: "Open worst object", href: "/objects/fi_gl?run=v1" });
    expect(homeActionFor({ ...base, persona: "steward", can: canFor("steward"), worstHref: undefined }).href).toBe("/objects");
  });

  it("keeps the basis action on systems", () => {
    expect(homeActionFor({ ...base, persona: "basis", can: canFor("analyst"), systemFailing: true })).toEqual({ label: "Open failed system", href: "/systems" });
  });

  it("takes the to-do action when one is given, for every persona and role", () => {
    const attention = { label: "Retry", href: "/admin/jobs?job=j1" };
    for (const persona of ["lead", "steward", "basis"] as const) {
      expect(homeActionFor({ ...base, persona, can: canFor("admin"), attention })).toEqual(attention);
    }
    expect(homeActionFor({ ...base, persona: "lead", can: canFor("auditor"), attention })).toEqual(attention);
    expect(homeActionFor({ ...base, persona: "lead", can: canFor("admin"), attention: undefined }).label).toBe("Open objects below target");
  });
});
