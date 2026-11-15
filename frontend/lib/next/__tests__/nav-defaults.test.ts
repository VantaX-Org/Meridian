import { describe, expect, it } from "vitest";
import { PATHS, TABS, redirectFor } from "../nav-defaults";

describe("nav defaults", () => {
  it("has five tabs", () => {
    expect(TABS.map((t) => PATHS[t])).toEqual(["/", "/work", "/load", "/runs", "/more"]);
  });
  it("redirects legacy and preview addresses", () => {
    expect(redirectFor("/cleansing/")).toBe("/work/approvals");
    expect(redirectFor("/fix-drafts")).toBe("/work/drafts");
    expect(redirectFor("/requests/new")).toBe("/work/requests");
    expect(redirectFor("/r/abc")).toBe("/more/rules/abc");
    expect(redirectFor("/s/abc")).toBe("/more/systems/abc");
    expect(redirectFor("/s/new")).toBe("/more/systems?sheet=connect");
    expect(redirectFor("/portfolio")).toBe("/");
    expect(redirectFor("/monitor")).toBe("/work/monitor");
    expect(redirectFor("/next/work/approve")).toBe("/work/approve");
    expect(redirectFor("/load/compare")).toBe("/load?tab=compare");
    // Configuration is a page under Systems; reference data and links are Master data tabs.
    expect(redirectFor("/config")).toBe("/more/systems/config");
    expect(redirectFor("/reference-data")).toBe("/more/master-data?tab=reference");
    expect(redirectFor("/links")).toBe("/more/master-data?tab=links");
    expect(redirectFor("/people")).toBe("/more/people");
    // Administration has one entry, under More.
    expect(redirectFor("/admin")).toBe("/more/admin");
    expect(redirectFor("/admin/users")).toBe("/more/admin/users");
  });
  it("leaves screens that stay", () => {
    for (const p of ["/", "/work", "/work/triage", "/work/monitor", "/runs", "/run/a", "/run/a/vs/b", "/o/a/b/records/K", "/share/x", "/status", "/more", "/more/rules", "/more/admin", "/more/admin/users"]) {
      expect(redirectFor(p)).toBeNull();
    }
  });
});
