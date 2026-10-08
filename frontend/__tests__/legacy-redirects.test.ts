// frontend/__tests__/legacy-redirects.test.ts
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("legacy route redirects", () => {
  it("redirects every Wave 1b legacy route to its replacement", async () => {
    const redirects = await nextConfig.redirects!();
    const bySource = new Map(redirects.map((r) => [r.source, r.destination]));
    expect(bySource.get("/findings")).toBe("/objects");
    expect(bySource.get("/versions")).toBe("/runs");
    expect(bySource.get("/analyse/object/:module")).toBe("/objects/:module");
    expect(bySource.get("/analyse/material/:matnr")).toBe("/objects/material_master/records/:matnr");
  });
});
