// frontend/__tests__/legacy-redirects.test.ts
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

const EXPECTED: Record<string, string> = {
  "/stewardship": "/workbench?tab=queue",
  "/stewardship/metrics": "/workbench?tab=queue",
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
  "/systems/:id/pilot": "/systems/:id?tab=pilot",
  "/systems/:id/versions/:versionId/profile": "/data/runs/:versionId?tab=profile",
  "/glossary": "/mdm/glossary",
  "/glossary/:id": "/mdm/glossary/:id",
  "/golden-records": "/mdm/golden",
  "/golden-records/:id": "/mdm/golden/:id",
  "/golden-records/:id/merge": "/mdm/golden/merge",
  "/match-rules": "/mdm/match-rules",
  "/match-rules/constraints": "/mdm/match-rules",
  "/match-rules/tuning": "/mdm/match-rules",
  "/business-process": "/insights/process",
  "/process": "/insights/process",
  "/process/designer": "/insights/process/designer",
  "/lineage": "/insights/lineage",
};

describe("legacy route redirects", () => {
  it("redirects every legacy route to its replacement, and nothing else", async () => {
    const redirects = await nextConfig.redirects!();
    const actual = Object.fromEntries(redirects.map((r) => [r.source, r.destination]));
    expect(actual).toEqual(EXPECTED);
    for (const r of redirects) expect(r.permanent).toBe(false);
  });
});
