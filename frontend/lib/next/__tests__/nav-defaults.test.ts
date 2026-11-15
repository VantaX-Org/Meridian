import { describe, expect, it } from "vitest";
import { PATHS, TABS, redirectFor } from "../nav-defaults";

describe("nav defaults", () => {
  it("has five tabs", () => {
    expect(TABS.map((t) => PATHS[t])).toEqual(["/", "/work", "/load", "/runs", "/more"]);
  });
  it("redirects legacy and preview addresses", () => {
    expect(redirectFor("/cleansing/")).toBe("/work/approvals");
    expect(redirectFor("/fix-drafts")).toBe("/work/drafts");
    expect(redirectFor("/requests/new")).toBe("/work/requests/new");
    expect(redirectFor("/requests/analytics")).toBe("/work/requests/analytics");
    expect(redirectFor("/data-requests")).toBe("/work/data-requests");
    expect(redirectFor("/rule-dry-run")).toBe("/more/rules?tab=dryrun");
    expect(redirectFor("/anomaly-rules")).toBe("/more/rules?tab=anomaly");
    expect(redirectFor("/rule-promotion")).toBe("/more/rules?tab=promotion");
    expect(redirectFor("/monitors")).toBe("/work/monitor?tab=learned");
    expect(redirectFor("/entry-gate")).toBe("/more/master-data?tab=entry-gate");
    expect(redirectFor("/issues")).toBe("/more/master-data?tab=issues");
    expect(redirectFor("/attention")).toBe("/work");
    expect(redirectFor("/r/abc")).toBe("/more/rules/abc");
    expect(redirectFor("/s/abc")).toBe("/more/systems/abc");
    expect(redirectFor("/s/new")).toBe("/more/systems?sheet=connect");
    expect(redirectFor("/portfolio")).toBe("/");
    expect(redirectFor("/monitor")).toBe("/work/monitor");
    expect(redirectFor("/next/work/approve")).toBe("/work/approve");
    expect(redirectFor("/load/compare")).toBe("/load?tab=compare");
    // Administration has one entry, under More.
    expect(redirectFor("/admin")).toBe("/more/admin");
    expect(redirectFor("/admin/users")).toBe("/more/admin/users");
  });
  it("leaves screens that stay", () => {
    for (const p of ["/", "/work", "/work/triage", "/work/monitor", "/work/exceptions", "/work/analytics", "/work/data-requests", "/runs", "/run/a", "/run/a/vs/b", "/o/a/b", "/share/x", "/status", "/more", "/more/rules", "/more/admin", "/more/admin/users"]) {
      expect(redirectFor(p)).toBeNull();
    }
  });
});
