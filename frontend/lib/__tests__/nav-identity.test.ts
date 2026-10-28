// Ruling 1: adding `requires` must not change the nav any legacy-role user sees.
import { describe, expect, it } from "vitest";
import { visibleNav, flattenNav, type NavGroup } from "../nav";
import { LEGACY_ROLES, permissionsPayload } from "../../e2e/fixtures/legacy-permissions";
import { PERSONA_ROLES, personaPermissionsPayload, type PersonaRole } from "../../e2e/fixtures/persona-permissions";

const hrefs = (groups: NavGroup[]) =>
  groups.map((g) => ({ group: g.group, hrefs: flattenNav(g.items).map((i) => i.href) }));

describe("nav identity for legacy roles", () => {
  it.each(LEGACY_ROLES)("%s sees the same nav with /me/permissions as with anyOf alone", (role) => {
    const p = permissionsPayload(role);
    const actions = new Set(p.actions);
    const can = (a: string) => actions.has(a);
    const isMenuItemEnabled = () => true;
    const anyOfOnly = visibleNav({ can, isMenuItemEnabled });
    const withRequires = visibleNav({ can, isMenuItemEnabled, has: (r, a) => p.resources[r]?.[a] === true });
    expect(hrefs(withRequires)).toEqual(hrefs(anyOfOnly));
    expect(anyOfOnly.length).toBeGreaterThan(0);
  });

  it("hides every item while /me/permissions loads (fail closed)", () => {
    expect(visibleNav({ can: () => true, isMenuItemEnabled: () => true, has: () => false })).toEqual([]);
  });

  it("hides the Admin group for a viewer", () => {
    const p = permissionsPayload("viewer");
    const groups = visibleNav({
      can: (a) => p.actions.includes(a), isMenuItemEnabled: () => true, has: (r, a) => p.resources[r]?.[a] === true,
    });
    expect(groups.map((g) => g.group)).not.toContain("Admin");
  });
});

// manage_triage (api/services/rbac.py PERSONA_ROLES): programme_lead and data_steward gained it, and nothing else did.
describe("nav for the persona roles that hold manage_triage", () => {
  const isMenuItemEnabled = () => true;
  const gateOf = (role: PersonaRole) => {
    const p = personaPermissionsPayload(role);
    return { can: (a: string) => p.actions.includes(a), isMenuItemEnabled, has: (r: string, a: string) => p.resources[r]?.[a] === true };
  };

  it.each(["programme_lead", "data_steward"] as const)("%s holds manage_triage, reaches Triage by it, and sees the same nav with or without requires", (role) => {
    const p = personaPermissionsPayload(role);
    expect(p.actions).toContain("manage_triage");
    expect(p.resources.stewardship?.admin).toBe(true);
    const g = gateOf(role);
    const withRequires = visibleNav(g);
    expect(hrefs(withRequires)).toEqual(hrefs(visibleNav({ can: g.can, isMenuItemEnabled })));
    expect(withRequires.flatMap((x) => flattenNav(x.items)).map((i) => i.href)).toContain("/admin/triage");
  });

  it("reaches Triage through manage_triage alone", () => {
    const g = { can: (a: string) => a === "manage_triage" || a === "view", isMenuItemEnabled, has: (r: string, a: string) => (r === "stewardship" && a === "admin") || a === "view" };
    expect(visibleNav(g).flatMap((x) => flattenNav(x.items)).map((i) => i.href)).toContain("/admin/triage");
  });

  it("grants manage_triage to no other persona or legacy role", () => {
    for (const role of PERSONA_ROLES) {
      if (role === "programme_lead" || role === "data_steward" || role === "platform_admin") continue;
      expect(personaPermissionsPayload(role).actions, role).not.toContain("manage_triage");
    }
    for (const role of LEGACY_ROLES) expect(permissionsPayload(role).actions, role).not.toContain("manage_triage");
  });
});
