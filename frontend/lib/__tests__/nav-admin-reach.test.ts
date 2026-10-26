// The admin sees every feature: each live page under app/(app) is one click from the pills, the More panel or the
// admin's All features index (itself in More).
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { railSplit } from "@/design/shell/Rail";
import { featureIndex, resolveNavHref, visibleNav, type NavGate } from "../nav";
import { personaForRole } from "../persona";
import { LEGACY_PERMISSIONS } from "../../e2e/fixtures/legacy-permissions";
import { resourceMatrix } from "../rbac";

const APP = path.resolve(__dirname, "../../app/(app)");

/** Static routes (no dynamic segment) of every page.tsx under app/(app). */
function liveRoutes(dir = APP, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith("_") || name.startsWith("__") || name.startsWith("[")) continue;
      out.push(...liveRoutes(full, `${prefix}/${name}`));
    } else if (name === "page.tsx" && prefix) {
      out.push(prefix);
    }
  }
  return out.sort();
}

// /home only redirects to the viewer's persona home, which the Home entry opens.
const REDIRECT_ONLY = new Set(["/home"]);

// platform_admin holds the legacy admin's action set (api/services/rbac.py ALL_ACTIONS).
const actions = [...LEGACY_PERMISSIONS.admin];
const matrix = resourceMatrix(actions);
const gate: NavGate = {
  can: (a) => actions.includes(a as (typeof actions)[number]),
  isMenuItemEnabled: () => true,
  has: (r, a) => matrix[r]?.[a] === true,
};
const role = "platform_admin" as const;
const resolve = (h: string) => resolveNavHref(h, role);
const path0 = (h: string) => h.split("?")[0]!;

describe("admin reaches every page", () => {
  const { main, more } = railSplit(visibleNav(gate), personaForRole(role), resolve);
  const railHrefs = [...main, ...more.flatMap((g) => g.items)].map((i) => path0(resolve(i.href)));
  const indexHrefs = featureIndex(gate, resolve).flatMap((g) => g.items.map((i) => path0(i.href)));

  it("finds the pages to check", () => {
    expect(liveRoutes()).toEqual(expect.arrayContaining(["/runs", "/import", "/admin/users", "/insights/reports"]));
  });

  it("lists All features in the More panel", () => {
    expect(more.flatMap((g) => g.items).map((i) => i.href)).toContain("/admin/features");
  });

  it("puts reports, learned rules, the migration dry run and exception billing in the More panel", () => {
    for (const h of ["/insights/reports", "/rules/learned", "/migration/dry-run", "/admin/billing"]) expect(railHrefs, h).toContain(h);
  });

  it.each(liveRoutes().filter((r) => !REDIRECT_ONLY.has(r)))("%s is in the pills, More or All features", (route) => {
    expect([...railHrefs, ...indexHrefs]).toContain(route);
  });

  it("keeps the index-only pages out of a viewer's reach only where the page needs admin", () => {
    const viewer = [...LEGACY_PERMISSIONS.viewer];
    const vm = resourceMatrix(viewer);
    const vg: NavGate = { can: (a) => viewer.includes(a as (typeof viewer)[number]), isMenuItemEnabled: () => true, has: (r, a) => vm[r]?.[a] === true };
    const hrefs = featureIndex(vg).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/insights/trends");
    expect(hrefs).not.toContain("/design");
    expect(hrefs).not.toContain("/admin/features");
  });
});
