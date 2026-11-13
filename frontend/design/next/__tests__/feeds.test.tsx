import { describe, expect, it } from "vitest";
import { objectTrends } from "../monitor/trends";
import type { RunGroup } from "@/lib/api/next/monitor";

const g = (over: Partial<RunGroup>): RunGroup => ({ version_id: "v", baseline_version_id: "b", module: "material_master", label: "Material master", detected_at: "2026-11-01T00:00:00Z", findings: [], newCount: 0, regressedCount: 0, resolvedCount: 0, ...over });

describe("objectTrends", () => {
  it("orders each object's runs oldest first and measures the latest change", () => {
    const t = objectTrends([
      g({ version_id: "v3", detected_at: "2026-11-03T00:00:00Z", newCount: 2 }),
      g({ version_id: "v1", detected_at: "2026-11-01T00:00:00Z", newCount: 5, regressedCount: 1 }),
      g({ version_id: "v2", detected_at: "2026-11-02T00:00:00Z", newCount: 4 }),
      g({ version_id: "c1", module: "customer_master", label: "Customer master", newCount: 9 }),
    ]);
    expect(t[0]).toMatchObject({ module: "customer_master", runs: 1, delta: null });
    expect(t[1]).toMatchObject({ module: "material_master", points: [6, 4, 2], latest: 2, delta: -2, runs: 3 });
  });
});
