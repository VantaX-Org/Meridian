// frontend/lib/__tests__/nav.test.ts
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { MAX_PILLS, NAV_GROUPS, flattenNav, getPageTitle, activeHref, homeHrefForRole, isItemVisible, resolveNavHref, splitNav, visibleNav, type NavItem } from "../nav";
import { LEGACY_ROLES, permissionsPayload } from "../../e2e/fixtures/legacy-permissions";

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
  it("routes steward and approver to Fix work and every other role to lead", () => {
    expect(homeHrefForRole("steward")).toBe("/fix");
    expect(homeHrefForRole("admin")).toBe("/home/lead");
    expect(homeHrefForRole("manager")).toBe("/home/lead");
    expect(homeHrefForRole("viewer")).toBe("/home/lead");
    expect(homeHrefForRole("analyst")).toBe("/home/lead");
    expect(homeHrefForRole("approver")).toBe("/fix"); // rbac.md 1.1: data_owner -> steward persona, which starts on Fix work
    expect(homeHrefForRole("auditor")).toBe("/home/lead");
    expect(homeHrefForRole("ai_reviewer")).toBe("/home/lead");
  });
});

describe("Inbox licence gating (I8)", () => {
  const inbox = flattenNav(NAV_GROUPS.flatMap((g) => g.items)).find((i) => i.href === "/inbox") as NavItem;

  it("is gated on the findings licence, not stewardship", () => {
    expect(inbox.licenceKey).toBe("findings");
  });

  it("is visible to a view-permission user whose tenant only holds the findings licence", () => {
    const gate = { can: (p: string) => p === "view", isMenuItemEnabled: (k: string) => k === "findings" };
    expect(isItemVisible(inbox, gate)).toBe(true);
  });

  it("is hidden when the tenant lacks the findings licence", () => {
    const gate = { can: (p: string) => p === "view", isMenuItemEnabled: () => false };
    expect(isItemVisible(inbox, gate)).toBe(false);
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

describe("wave 18b gap routes", () => {
  const items = flattenNav(NAV_GROUPS.flatMap((g) => g.items));
  const hrefs = ["/insights/owners", "/insights/exec", "/mdm", "/mdm/survivorship", "/admin/audit", "/admin/notifications", "/admin/jobs", "/admin/reference", "/fix/what-if", "/rules/drafts", "/rules/dictionary"];

  it("lists every new route once, with a requires", () => {
    for (const h of hrefs) {
      const found = items.filter((i) => i.href === h);
      expect(found, h).toHaveLength(1);
      expect(found[0].requires, h).toBeDefined();
    }
  });

  it("gates the audit log on view_audit or manage_users", () => {
    expect(items.find((i) => i.href === "/admin/audit")?.anyOf).toEqual(["view_audit", "manage_users"]);
  });
});
describe("Process entries", () => {
  const flat = flattenNav(NAV_GROUPS.flatMap((g) => g.items));

  it("makes the catalogue a main entry and keeps the runs and the designer under Analysis, all gated on process/view", () => {
    const work = NAV_GROUPS.find((g) => g.main)!;
    const analysis = NAV_GROUPS.find((g) => g.group === "Analysis")!;
    expect(work.items.filter((i) => i.href.startsWith("/process")).map((i) => i.href)).toEqual(["/process"]);
    expect(analysis.items.filter((i) => i.href.includes("process")).map((i) => i.href)).toEqual(["/insights/process/designer", "/process/runs"]);
    for (const item of [...work.items, ...analysis.items].filter((i) => i.href.includes("process"))) {
      expect(item.requires).toEqual({ resource: "process", action: "view" });
    }
  });

  it.each(LEGACY_ROLES)("%s: search and the command palette list the catalogue, the runs and the designer", (role) => {
    const p = permissionsPayload(role);
    const groups = visibleNav({ can: (a) => p.actions.includes(a), isMenuItemEnabled: () => true, has: (r, a) => p.resources[r]?.[a] === true });
    const hrefs = flattenNav(groups.flatMap((g) => g.items)).map((i) => i.href);
    for (const h of ["/process", "/process/runs", "/insights/process/designer"]) expect(hrefs, h).toContain(h);
  });

  it("titles the DQ-driven readiness page Process data readiness, apart from the as-is processes", () => {
    expect(getPageTitle("/insights/process")).toBe("Process data readiness");
    expect(getPageTitle("/process")).toBe("As-is processes");
    expect(getPageTitle("/process/runs")).toBe("Discovery runs");
  });

  it("highlights the runs entry on a run detail and the catalogue on an L1 drill", () => {
    expect(activeHref("/process/runs/abc", new URLSearchParams(), flat)).toBe("/process/runs");
    expect(activeHref("/process/PTP", new URLSearchParams(), flat)).toBe("/process");
    expect(activeHref("/insights/process", new URLSearchParams(), flat)).toBe("/insights/readiness");
  });
});

describe("menu structure", () => {
  it("has five main entries and five More sections", () => {
    const main = NAV_GROUPS.filter((g) => g.main);
    expect(main.flatMap((g) => g.items.map((i) => i.href))).toEqual(["/fix", "/objects", "/process", "/insights/progress", "/inbox"]);
    expect(NAV_GROUPS.filter((g) => !g.main).map((g) => g.group)).toEqual(["Analysis", "Master data", "Rules", "Data in", "Admin"]);
  });

  it("files each page under its section", () => {
    const sectionOf = (href: string) => NAV_GROUPS.find((g) => flattenNav(g.items).some((i) => i.href === href))?.group;
    expect(sectionOf("/insights/exec")).toBe("Analysis");
    expect(sectionOf("/insights/rules")).toBe("Analysis");
    expect(sectionOf("/process")).toBe("Work");
    expect(sectionOf("/process/runs")).toBe("Analysis");
    expect(sectionOf("/insights/process/designer")).toBe("Analysis");
    expect(sectionOf("/fix/what-if")).toBe("Analysis");
    expect(sectionOf("/mdm/glossary")).toBe("Master data");
    expect(sectionOf("/rules/drafts")).toBe("Rules");
    expect(sectionOf("/systems")).toBe("Data in");
    expect(sectionOf("/import")).toBe("Data in");
    expect(sectionOf("/migration")).toBe("Data in");
    expect(sectionOf("/admin/ai")).toBe("Admin");
    expect(sectionOf("/admin/users")).toBe("Admin");
  });

  it("titles /fix as the menu does: Fix work", () => {
    expect(getPageTitle("/fix")).toBe("Fix work");
    expect(getPageTitle("/fix/B1")).toBe("Fix work");
    expect(getPageTitle("/insights/progress")).toBe("Progress");
  });

  it.each(LEGACY_ROLES)("%s: splitNav lists every visible page once, with no resolved href twice", (role) => {
    const p = permissionsPayload(role);
    const groups = visibleNav({ can: (a) => p.actions.includes(a), isMenuItemEnabled: () => true, has: (r, a) => p.resources[r]?.[a] === true });
    const { main, more } = splitNav(groups, (h) => resolveNavHref(h, role));
    const hrefs = [...main, ...more.flatMap((g) => g.items)].map((i) => resolveNavHref(i.href, role));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const visible = new Set(flattenNav(groups.flatMap((g) => g.items)).map((i) => resolveNavHref(i.href, role)));
    const mainChildren = new Set(main.flatMap((i) => (i.children ?? []).map((c) => c.href)));
    for (const h of visible) if (!mainChildren.has(h)) expect(hrefs, h).toContain(h);
  });

  it("gives a steward Fix work as a pill and no separate Home entry", () => {
    const p = permissionsPayload("steward");
    const groups = visibleNav({ can: (a) => p.actions.includes(a), isMenuItemEnabled: () => true, has: (r, a) => p.resources[r]?.[a] === true });
    const { main, more } = splitNav(groups, (h) => resolveNavHref(h, "steward"));
    expect(main.map((i) => i.label)).toEqual(["Fix work", "Objects", "As-is processes", "Progress", "Inbox"]);
    expect(more.flatMap((g) => g.items).some((i) => i.href === "/home/lead")).toBe(false);
  });

  it.each(LEGACY_ROLES)("%s: the process catalogue is a pill, and the strip holds at most MAX_PILLS", (role) => {
    const p = permissionsPayload(role);
    const groups = visibleNav({ can: (a) => p.actions.includes(a), isMenuItemEnabled: () => true, has: (r, a) => p.resources[r]?.[a] === true });
    const { main } = splitNav(groups, (h) => resolveNavHref(h, role));
    expect(main.map((i) => i.href)).toContain("/process");
    expect(main.length).toBeLessThanOrEqual(MAX_PILLS);
  });

  it("hides Fix work from a role that cannot open it", () => {
    const p = permissionsPayload("viewer");
    const groups = visibleNav({ can: (a) => p.actions.includes(a), isMenuItemEnabled: () => true, has: (r, a) => p.resources[r]?.[a] === true });
    const { main } = splitNav(groups);
    expect(main.map((i) => i.href)).not.toContain("/fix");
    expect(main.map((i) => i.href)).toContain("/objects");
  });
});

describe("Reports entry", () => {
  const flat = flattenNav(NAV_GROUPS.flatMap((g) => g.items));

  it("lists the report library once, under Analysis, gated on export", () => {
    const found = flat.filter((i) => i.href === "/insights/reports");
    expect(found).toHaveLength(1);
    expect(found[0].requires).toEqual({ resource: "reports", action: "export" });
    expect(found[0].anyOf).toEqual(["export"]);
    expect(NAV_GROUPS.find((g) => flattenNav(g.items).some((i) => i.href === "/insights/reports"))?.group).toBe("Analysis");
  });

  it("highlights Reports, not Summary, on the reports page", () => {
    expect(activeHref("/insights/reports", new URLSearchParams(), flat)).toBe("/insights/reports");
    expect(getPageTitle("/insights/reports")).toBe("Reports");
  });

  it("shows Reports in More for a user who can export and hides it otherwise", () => {
    const more = (can: (p: string) => boolean) =>
      splitNav(visibleNav({ can, isMenuItemEnabled: () => true })).more.flatMap((g) => g.items.map((i) => i.href));
    expect(more(() => true)).toContain("/insights/reports");
    expect(more((p) => p !== "export")).not.toContain("/insights/reports");
  });
});
