// frontend/__tests__/legacy-redirects.test.ts
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

const EXPECTED: Record<string, string> = {
  "/stewardship": "/inbox",
  "/stewardship/metrics": "/inbox",
  "/workbench": "/inbox",
  "/workbench/triage": "/inbox",
  "/workbench/progress": "/inbox",
  "/workbench/report": "/inbox",
  "/workbench/record/:issueId": "/inbox",
  "/exceptions": "/inbox?kind=exception",
  "/exceptions/rules": "/inbox?kind=exception",
  "/findings": "/objects",
  "/versions": "/runs",
  "/analyse/object/:module": "/objects/:module",
  "/analyse/material/:matnr": "/objects/material_master/records/:matnr",
  "/command-centre": "/home/basis",
  "/executive-report": "/insights/exec",
  "/connectivity": "/systems",
  "/contracts": "/rules/contracts",
  "/settings/scoring": "/rules/scoring",
  "/settings/exception-billing": "/admin/billing",
  "/run-sync": "/systems",
  "/analytics": "/insights/forecast",
  "/systems/:id/pilot": "/systems/:id?tab=pilot",
  "/systems/:id/versions/:versionId/profile": "/runs/:versionId",
  "/glossary": "/mdm/glossary",
  "/glossary/:id": "/mdm/glossary/:id",
  "/golden-records": "/mdm/golden",
  "/golden-records/:id": "/mdm/golden/:id",
  "/golden-records/:id/merge": "/mdm/golden/merge?id=:id",
  "/match-rules": "/mdm/match-rules",
  "/match-rules/constraints": "/mdm/match-rules",
  "/match-rules/tuning": "/mdm/match-rules",
  "/business-process": "/insights/process",
  "/process/designer": "/insights/process/designer",
  "/lineage": "/insights/lineage",
  "/mining": "/insights/mining",
  "/relationships": "/insights/mining",
  "/upload": "/import",
  "/settings/rules": "/rules",
  "/": "/home",
  "/data": "/systems",
  "/data/runs/:id": "/runs/:id",
  "/sync": "/systems",
  "/analyse": "/objects",
  "/analyse/coverage": "/objects",
  "/analyse/finding/:id": "/objects",
  "/analyse/rule/:checkId": "/rules/:checkId",
  "/notifications": "/inbox",
  "/issues": "/fix?mine=1",
  "/dedup": "/insights/duplicates",
  "/ai/rules": "/rules",
  "/config-impact": "/insights/impact",
  "/reports": "/insights/reports",
  "/cleaning": "/fix",
  "/remediation": "/fix?tab=batches",
  "/fix/:id((?!what-if$|proposals$|proposals/).*)": "/fix/proposals/:id",
  "/settings/field-mapping": "/admin/mappings",
  "/settings/ai": "/admin/ai",
  "/settings/licence": "/admin/licence",
  "/settings": "/admin/settings",
  "/admin": "/admin/users",
  "/admin/notifications": "/admin/alerts",
};

// Retired pages whose redirect is a 301; every other legacy route is a 307 until its replacement settles.
const PERMANENT = new Set(["/admin/notifications"]);

describe("legacy route redirects", () => {
  it("redirects every legacy route to its replacement, and nothing else", async () => {
    const redirects = await nextConfig.redirects!();
    // The /workbench?tab=batches deep link (notification/digest links, #5) is a
    // `has`-gated rule sharing the `/workbench` source with the generic catch-all
    // below it, so it's excluded from the plain source->destination map and
    // checked on its own.
    const plain = redirects.filter((r) => !r.has);
    const actual = Object.fromEntries(plain.map((r) => [r.source, r.destination]));
    expect(actual).toEqual(EXPECTED);
    for (const r of redirects) expect(r.permanent).toBe(PERMANENT.has(r.source));
  });

  it("sends old /fix/{run} links to /fix/proposals/{run} without catching /fix/what-if or the new path", async () => {
    const redirects = await nextConfig.redirects!();
    const rule = redirects.find((r) => r.destination === "/fix/proposals/:id")!;
    const pattern = new RegExp(`^${rule.source.replace(/:id\((.*)\)$/, "($1)")}$`);
    expect("/fix/R1").toMatch(pattern);
    expect("/fix/what-if").not.toMatch(pattern);
    expect("/fix/proposals").not.toMatch(pattern);
    expect("/fix/proposals/R1").not.toMatch(pattern);
  });

  it("sends /admin/notifications permanently to the Alerts page", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects.filter((r) => r.source === "/admin/notifications")).toEqual([
      { source: "/admin/notifications", destination: "/admin/alerts", permanent: true },
    ]);
  });

  it("sends the retired Fix work Monitor tab to the Objects list's monitoring view", async () => {
    const redirects = await nextConfig.redirects!();
    const rules = redirects.filter((r) => r.source === "/fix");
    expect(rules).toHaveLength(1);
    expect(rules[0].has).toEqual([{ type: "query", key: "tab", value: "monitor" }]);
    expect(rules[0].destination).toBe("/objects?view=monitoring");
  });

  // TODO (later work packages, each with the page it needs; add the rule to EXPECTED when it lands):
  //  - /fix?tab=cleaning -> /fix?sugg=1 (after the cleaning-proposal parity check passes)
  it("does not redirect /fix?tab=cleaning yet", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects.some((r) => r.source === "/fix" && r.has?.some((h) => h.type === "query" && "value" in h && h.value === "cleaning"))).toBe(false);
  });

  it("sends legacy /workbench?tab=batches deep links to /fix?tab=batches, ahead of the generic /workbench rule", async () => {
    const redirects = await nextConfig.redirects!();
    const workbenchRules = redirects.filter((r) => r.source === "/workbench");
    expect(workbenchRules).toHaveLength(2);
    const [tabRule, catchAllRule] = workbenchRules;
    expect(tabRule.has).toEqual([{ type: "query", key: "tab", value: "batches" }]);
    expect(tabRule.destination).toBe("/fix?tab=batches");
    expect(catchAllRule.has).toBeUndefined();
    expect(catchAllRule.destination).toBe("/inbox");
  });
});
