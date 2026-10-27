import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChartPoint } from "@/design";

const seen = vi.hoisted(() => ({ data: [] as ChartPoint[], height: 0 }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/design", async (orig) => ({
  ...(await orig<typeof import("@/design")>()),
  Bar: ({ data, height }: { data: ChartPoint[]; height: number }) => { seen.data = data; seen.height = height; return null; },
}));

import { S4Chart } from "../RunAnalyses";

describe("S4Chart axis labels", () => {
  it("hands Bar the whole area name, which Bar wraps to two lines rather than cutting it", () => {
    const area = (label: string, n: number) => ({ area: label, label, failing: n, blocking_failing: n, warning_failing: 0 }) as never;
    render(<S4Chart areas={[area("Universal Journal / General Ledger", 7), area("Purchasing info records and source lists", 2), area("Quality management", 1)]} />);
    expect(seen.data.map((p) => p.x)).toEqual(["Universal Journal / General Ledger", "Purchasing info records and source lists", "Quality management"]);
    expect(seen.data.every((p) => p.label === undefined)).toBe(true);
    expect(seen.height).toBeGreaterThanOrEqual(3 * 28);
  });
});
