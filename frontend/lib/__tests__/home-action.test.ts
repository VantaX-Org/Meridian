import { describe, expect, it } from "vitest";
import { LEGACY_PERMISSIONS, type LegacyRole } from "../../e2e/fixtures/legacy-permissions";
import { actsOnNothing, homeActionFor, homeStep, readOnlyLeadAction } from "../home-action";

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

describe("homeStep: one step for the hero button, the Next line and the Do next cell", () => {
  const next = { module: "material_master", label: "Material master", score: 64.5, rule: "MM045", runId: "v1", sentence: "Material master comes first, the lowest score at 64.5: fix MM045, which caps it", action: { label: "Fix MM045", href: "/fix?module=material_master&check=MM045" } };
  const input = { ...base, next };

  it("takes the top to-do item first, with its title as the sentence", () => {
    const step = homeStep({ ...input, persona: "lead", can: canFor("admin"), attention: { label: "Open system", href: "/systems/s1" }, attentionTitle: "ERP-SIM cannot connect." });
    expect(step).toEqual({ sentence: "ERP-SIM cannot connect", label: "Open system", href: "/systems/s1" });
  });

  it("then the persona's own step: proposals, audit log, approvals, failed system", () => {
    expect(homeStep({ ...input, persona: "lead", can: canFor("admin"), proposals: 3 })).toMatchObject({ label: "Review 3 proposals", href: "/rules/drafts?tab=ai" });
    expect(homeStep({ ...input, persona: "lead", can: canFor("auditor") })).toMatchObject({ label: "Open audit log", href: "/admin/audit" });
    expect(homeStep({ ...input, persona: "steward", can: canFor("approver") })).toMatchObject({ label: "Open approvals", href: "/inbox?kind=approvals" });
    expect(homeStep({ ...input, persona: "basis", can: canFor("analyst"), systemFailing: true, failingSystem: "ERP-SIM" })).toEqual({ sentence: "ERP-SIM is not healthy", label: "Open failed system", href: "/systems" });
  });

  it("sends a steward who can apply to Fix work, with the records to fix in the sentence", () => {
    expect(homeStep({ ...input, persona: "steward", can: canFor("steward"), recordsToFix: 24576 })).toEqual({ sentence: "24,576 records need fixing", label: "Start fixing", href: "/fix" });
    expect(homeStep({ ...input, persona: "steward", can: canFor("steward"), recordsToFix: 24576, fixStarted: true }).label).toBe("Continue in Fix work");
  });

  it("leaves the steward on the score's step when the work list is clear (nothing to fix)", () => {
    expect(homeStep({ ...input, persona: "steward", can: canFor("steward"), recordsToFix: 0 }).label).toBe("Fix MM045");
  });

  it("otherwise names the score's step (doNext), the same sentence the Do next cell shows", () => {
    expect(homeStep({ ...input, persona: "lead", can: canFor("admin") })).toEqual({ sentence: next.sentence, label: "Fix MM045", href: next.action.href });
  });

  it("falls back to the persona's generic action when nothing is scored", () => {
    expect(homeStep({ ...base, persona: "lead", can: canFor("admin"), next: null })).toEqual({ sentence: "2 objects are below target", label: "Open objects below target", href: "/objects?readiness=warn%2Cfail" });
  });
});
