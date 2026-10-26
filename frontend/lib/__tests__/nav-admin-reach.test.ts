// The admin sees every feature: each live page under app/(app) is one click from the pills, the More panel or
// All features (/features, which leads the More panel).
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { railSplit } from "@/design/shell/Rail";
import {
  FEATURE_AREAS, FEATURE_DESC, INDEX_ONLY_GROUPS, MAX_PILLS, NAV_GROUPS, featureArea, featureIndex, flattenNav,
  resolveNavHref, visibleNav, type NavGate,
} from "../nav";
import { pillSetFor } from "../persona";
import { LEGACY_PERMISSIONS } from "../../e2e/fixtures/legacy-permissions";
import { resourceMatrix } from "../rbac";

const APP = path.resolve(__dirname, "../../app/(app)");

/** Static routes (no dynamic segment) of every page.tsx under app/(app). */
function liveRoutes(dir = APP, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith("_") || name.startsWith("[")) continue;
      out.push(...liveRoutes(full, `${prefix}/${name}`));
    } else if (name === "page.tsx" && prefix) {
      out.push(prefix);
    }
  }
  return out.sort();
}

// /home only redirects to the viewer's persona home, which the Home entry opens; /features is All features itself,
// linked at the top of the More panel and in the command palette.
// /home and /insights only redirect (to the viewer's home; /insights was the retired overview).
const NOT_LISTED = new Set(["/home", "/features", "/insights"]);

const gateFor = (actions: readonly string[]): NavGate => {
  const matrix = resourceMatrix(actions);
  return { can: (a) => actions.includes(a), isMenuItemEnabled: () => true, has: (r, a) => matrix[r]?.[a] === true };
};
// platform_admin holds the legacy admin's action set (api/services/rbac.py ALL_ACTIONS).
const gate = gateFor(LEGACY_PERMISSIONS.admin);
const role = "platform_admin" as const;
const resolve = (h: string) => resolveNavHref(h, role);
const path0 = (h: string) => h.split("?")[0]!;
const allItems = [...flattenNav(NAV_GROUPS.flatMap((g) => g.items)), ...INDEX_ONLY_GROUPS.flatMap((g) => g.items)];

describe("admin reaches every page", () => {
  const { main, more } = railSplit(visibleNav(gate), pillSetFor(role), resolve);
  const railHrefs = [...main, ...more.flatMap((g) => g.items)].map((i) => path0(resolve(i.href)));
  const index = featureIndex(gate, resolve);
  const indexHrefs = index.flatMap((a) => a.items.map((i) => path0(i.href)));

  it("finds the pages to check", () => {
    expect(liveRoutes()).toEqual(expect.arrayContaining(["/runs", "/import", "/admin/users", "/insights/reports", "/features"]));
  });

  it("makes Runs a pill, in order, within MAX_PILLS", () => {
    expect(main.map((i) => i.href)).toEqual(["/home/lead", "/objects", "/fix", "/inbox", "/insights/progress", "/runs"]);
    // Processes, the main entry the lead's strip leaves out, leads More
    expect(more[0]?.items[0]?.href).toBe("/process");
    expect(main.length).toBeLessThanOrEqual(MAX_PILLS);
  });

  it("gives every insight view, reports, what-if, the designer, migration and the admin pages their own More entry", () => {
    for (const h of ["/insights/reports", "/insights/trends", "/insights/forecast", "/insights/impact", "/insights/lineage", "/insights/mining", "/insights/duplicates", "/insights/readiness", "/insights/process", "/insights/operations", "/insights/process/designer", "/migration", "/fix/what-if", "/rules/learned", "/migration/dry-run", "/admin/jobs"]) expect(railHrefs, h).toContain(h);
    // Exception billing is a Settings tab (Settings stands for its tabs in More), listed on All features.
    expect(indexHrefs).toContain("/admin/billing");
  });

  it("reaches the role-audit entries: Approvals for auditors, Migration for data owners, Triage for leads, Jobs for analysts", () => {
    const hrefsFor = (actions: readonly string[]) => featureIndex(gateFor(actions)).flatMap((a) => a.items.map((i) => i.href));
    // The auditor reads the four-eyes evidence on the one approvals page (view_audit), not a second Fix entry.
    expect(hrefsFor(LEGACY_PERMISSIONS.auditor)).toContain("/inbox?kind=approvals");
    expect(hrefsFor(LEGACY_PERMISSIONS.auditor)).not.toContain("/fix?tab=batches");
    expect(hrefsFor(LEGACY_PERMISSIONS.approver)).toContain("/migration");
    expect(hrefsFor(LEGACY_PERMISSIONS.approver)).toContain("/inbox?kind=approvals");
    expect(hrefsFor(LEGACY_PERMISSIONS.manager)).toContain("/admin/triage");
    expect(hrefsFor(LEGACY_PERMISSIONS.analyst)).toContain("/admin/jobs");
    expect(featureArea("/admin/jobs")).toBe("Systems and import");
  });

  it.each(liveRoutes().filter((r) => !NOT_LISTED.has(r)))("%s is in the pills, More or All features", (route) => {
    expect([...railHrefs, ...indexHrefs]).toContain(route);
  });

  it("lists every nav item on All features for an admin, each once", () => {
    const listed = index.flatMap((a) => a.items.map((i) => i.source));
    for (const i of allItems) expect(listed, i.href).toContain(i.href);
    const full = index.flatMap((a) => a.items.map((i) => i.href));
    expect(new Set(full).size).toBe(full.length);
  });

  it("describes every item and files it under a known area, areas in page order", () => {
    for (const i of allItems) {
      expect(FEATURE_DESC[i.href], i.href).toBeTruthy();
      expect(FEATURE_AREAS, i.href).toContain(featureArea(i.href));
    }
    expect(index.map((a) => a.area)).toEqual([...FEATURE_AREAS]);
    expect(featureArea("/runs")).toBe("Objects and runs");
    expect(featureArea("/insights/process/designer")).toBe("Processes");
  });

  it("filters All features by the viewer's permissions", () => {
    const hrefs = featureIndex(gateFor(LEGACY_PERMISSIONS.viewer)).flatMap((a) => a.items.map((i) => i.href));
    expect(hrefs).toContain("/insights/trends");
    expect(hrefs).toContain("/runs");
    expect(hrefs).not.toContain("/design");
    expect(hrefs).not.toContain("/admin/users");
    expect(hrefs).not.toContain("/import");
  });
});
