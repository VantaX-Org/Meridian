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
  "/home": "/home/lead",
  "/findings": "/objects",
  "/versions": "/runs",
  "/analyse/object/:module": "/objects/:module",
  "/analyse/material/:matnr": "/objects/material_master/records/:matnr",
  "/command-centre": "/?tab=live",
  "/executive-report": "/insights/exec",
  "/connectivity": "/data",
  "/run-sync": "/data",
  "/migration": "/data?tab=migration",
  "/analytics": "/",
  "/golden-records/:id/merge": "/golden-records/:id?tab=merge",
  "/systems/:id/pilot": "/systems/:id?tab=pilot",
  "/systems/:id/versions/:versionId/profile": "/data/runs/:versionId?tab=profile",
};

describe("legacy route redirects", () => {
  it("redirects every legacy route to its replacement, and nothing else", async () => {
    const redirects = await nextConfig.redirects!();
    const actual = Object.fromEntries(redirects.map((r) => [r.source, r.destination]));
    expect(actual).toEqual(EXPECTED);
    for (const r of redirects) expect(r.permanent).toBe(false);
  });
});
