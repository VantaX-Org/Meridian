import { describe, expect, it, vi } from "vitest";

const getFindings = vi.fn();
vi.mock("@/lib/api/findings", () => ({ getFindings: (p: unknown) => getFindings(p) }));
vi.mock("./fixture", () => ({ fixtureActive: () => false }));

import { getObjectRules } from "./landscape";

const finding = (i: number) => ({ check_id: `R${i}`, details: {}, severity: "high", affected_count: 1, total_count: 10, pass_rate: 0.9 });

describe("getObjectRules", () => {
  it("reads every page of failing rules, not just the first 200", async () => {
    const all = Array.from({ length: 450 }, (_, i) => finding(i));
    getFindings.mockImplementation(async ({ limit, offset }: { limit: number; offset: number }) => ({ findings: all.slice(offset, offset + limit), total: all.length, filters_applied: {} }));
    const rules = await getObjectRules("material_master", "v1");
    expect(rules).toHaveLength(450);
    expect(rules[449].check_id).toBe("R449");
    expect(getFindings.mock.calls.map((c) => c[0].offset)).toEqual([0, 200, 400]);
  });
});
