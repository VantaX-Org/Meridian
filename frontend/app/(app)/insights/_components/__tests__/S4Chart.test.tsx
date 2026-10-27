import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChartPoint } from "@/design";

const seen = vi.hoisted(() => ({ data: [] as ChartPoint[], height: 0 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/design", async (orig) => ({
  ...(await orig<typeof import("@/design")>()),
  Bar: ({ data, height }: { data: ChartPoint[]; height: number }) => { seen.data = data; seen.height = height; return null; },
}));

import { S4Chart, axisLabel } from "../RunAnalyses";

describe("S4Chart axis labels", () => {
  it("cuts a long area name to one axis line and keeps the whole name as the point", () => {
    const area = (label: string, n: number) => ({ area: label, label, failing: n, blocking_failing: n, warning_failing: 0 }) as never;
    render(<S4Chart areas={[area("Warehouse Management to EWM", 7), area("Purchasing info records and source lists", 2), area("Quality management", 1)]} />);
    expect(seen.data.map((p) => p.x)).toEqual(["Warehouse Management to EWM", "Purchasing info records and source lists", "Quality management"]);
    expect(seen.data.map((p) => p.label)).toEqual(["Warehouse Management to…", "Purchasing info records…", "Quality management"]);
    for (const p of seen.data) expect((p.label ?? "").length).toBeLessThanOrEqual(24);
    expect(seen.height).toBeGreaterThanOrEqual(3 * 28);
  });

  it("leaves a short label whole", () => {
    expect(axisLabel("Business Partner / CVI")).toBe("Business Partner / CVI");
  });
});
