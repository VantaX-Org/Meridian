// frontend/lib/__tests__/nav.test.ts
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { NAV_GROUPS, flattenNav, getPageTitle, activeHref, homeHrefForRole } from "../nav";

describe("nav vs legacy redirects", () => {
  it("never points a nav item at a path that redirects elsewhere", async () => {
    const redirects = await nextConfig.redirects!();
    const sources = new Set(redirects.map((r) => r.source));

    const hrefs = NAV_GROUPS.flatMap((g) => flattenNav(g.items).map((i) => i.href.split("?")[0]));

    for (const href of hrefs) {
      expect(sources.has(href)).toBe(false);
    }
  });
});

describe("getPageTitle", () => {
  it("resolves a shared href (/systems) to the first-listed nav item's title", () => {
    expect(getPageTitle("/systems")).toBe("Systems");
  });

  it("labels the runs page Runs and keeps compare searchable", () => {
    const runs = flattenNav(NAV_GROUPS.flatMap((g) => g.items)).find((n) => n.href === "/runs");
    expect(runs?.label).toBe("Runs");
    expect(runs?.keywords).toContain("compare");
    expect(getPageTitle("/runs")).toBe("Runs");
  });
});

describe("NAV_GROUPS", () => {
  it("has every href exactly once across items and children", () => {
    const hrefs = flattenNav(NAV_GROUPS.flatMap((g) => g.items)).map((i) => i.href);
    expect(hrefs.length).toBe(new Set(hrefs).size);
  });
});

describe("homeHrefForRole", () => {
  it("routes steward to the steward persona and admin/manager to lead", () => {
    expect(homeHrefForRole("steward")).toBe("/home/steward");
    expect(homeHrefForRole("admin")).toBe("/home/lead");
    expect(homeHrefForRole("manager")).toBe("/home/lead");
    expect(homeHrefForRole("viewer")).toBe("/home/basis");
  });
});

describe("activeHref", () => {
  const flat = flattenNav(NAV_GROUPS.flatMap((g) => g.items));

  it("matches any /home/* persona page to the Home item", () => {
    expect(activeHref("/home/steward", new URLSearchParams(), flat)).toBe("/home/lead");
  });

  it("prefers the longer, more specific path over its parent", () => {
    expect(activeHref("/insights/readiness", new URLSearchParams(), flat)).toBe("/insights/readiness");
  });

  it("requires every query pair on a query-scoped item to match", () => {
    const search = new URLSearchParams("kind=exception");
    expect(activeHref("/inbox", search, flat)).toBe("/inbox?kind=exception");
    expect(activeHref("/inbox", new URLSearchParams(), flat)).toBe("/inbox");
  });

  it("returns null when nothing matches", () => {
    expect(activeHref("/not-a-route", new URLSearchParams(), flat)).toBeNull();
  });
});
