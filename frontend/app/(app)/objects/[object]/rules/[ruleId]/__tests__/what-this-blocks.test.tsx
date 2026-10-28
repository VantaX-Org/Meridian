import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as analytics from "@/lib/api/analytics";
import * as findings from "@/lib/api/findings";
import type { Finding, FindingList } from "@/types/api";
import { WhatThisBlocks } from "../what-this-blocks";

const bucket = (category: string, annual_risk: number, mitigated = 0): analytics.ImpactBucket => ({
  category, annual_risk, mitigated, finding_count: 1, calculation_method: "records x unit cost", currency: "ZAR",
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(findings, "getFindings").mockResolvedValue({ findings: [{ id: "f-1" } as Finding] } as FindingList);
});

describe("WhatThisBlocks", () => {
  it("lists the priced buckets of the rule's finding, largest first, and leaves the empty ones out", async () => {
    const impact = vi.spyOn(analytics, "getFindingImpact").mockResolvedValue({
      finding_id: "f-1", finding: {} as Finding,
      impacts: [bucket("blocked_invoice", 0), bucket("inventory_write_off", 1200, 300), bucket("compliance_penalty", 5000, 1000)],
    });
    renderWithQuery(<WhatThisBlocks run="v1" object="material_master" checkId="MM001" />);
    const table = await screen.findByRole("table", { name: "Cost at risk by category" });
    const rows = Array.from(table.querySelectorAll("tbody tr")).map((r) => r.querySelector("th")?.textContent);
    expect(rows).toEqual(["Compliance penalty", "Inventory write off"]);
    expect(findings.getFindings).toHaveBeenCalledWith({ version_id: "v1", module: "material_master", check_id: "MM001", limit: 1 });
    expect(impact).toHaveBeenCalledWith("f-1");
    expect(screen.getByText("What this blocks")).toBeInTheDocument();
  });

  it("says no cost is attached when nothing is priced", async () => {
    vi.spyOn(analytics, "getFindingImpact").mockResolvedValue({ finding_id: "f-1", finding: {} as Finding, impacts: [bucket("blocked_invoice", 0)] });
    renderWithQuery(<WhatThisBlocks run="v1" object="material_master" checkId="MM001" />);
    expect(await screen.findByText(/No cost is attached to this rule/)).toBeInTheDocument();
  });

  it("shows nothing when the rule has no finding in the run or the impact cannot be read", async () => {
    vi.spyOn(findings, "getFindings").mockResolvedValue({ findings: [] } as unknown as FindingList);
    const impact = vi.spyOn(analytics, "getFindingImpact");
    const { container } = renderWithQuery(<WhatThisBlocks run="v1" object="material_master" checkId="MM001" />);
    await vi.waitFor(() => expect(findings.getFindings).toHaveBeenCalled());
    expect(impact).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });
});
