// frontend/lib/__tests__/nav.test.ts
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { NAV_GROUPS, flattenNav, getPageTitle } from "../nav";

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
});
