// Ruling 1: adding `requires` must not change the nav any legacy-role user sees.
import { describe, expect, it } from "vitest";
import { visibleNav, flattenNav, type NavGroup } from "../nav";
import { LEGACY_ROLES, permissionsPayload } from "../../e2e/fixtures/legacy-permissions";

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
