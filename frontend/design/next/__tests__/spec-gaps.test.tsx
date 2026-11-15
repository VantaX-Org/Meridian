import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { downloadWorkbooks, type PortfolioRow } from "@/lib/api/next/portfolio";
import { ToastProvider, useToast } from "../kit";
import { BulkActions, loadHref, type PortfolioActions } from "../portfolio/BulkBar";
import { runScore } from "../screens/Monitor";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
const dl = vi.fn(async () => "file");
vi.mock("@/lib/api/v2/download", () => ({ v2Download: (...a: unknown[]) => dl(...(a as [])) }));

const row = (o: Partial<PortfolioRow> = {}): PortfolioRow => ({
  module: "material_master", label: "Material master", version_id: "v1", run_at: null, system_id: null,
  composite_score: 80, raw_score: 80, measured_score: 80, capped: false, readiness: "pass", step: "compare", cycle: null,
  run_number: 3, owner: null, trend: [70, 75, 80], previous_score: 75, new_issues: 0, regressed: 0, resolved: 0, freshness: "fresh", ...o,
});

describe("runScore", () => {
  it("shows the score and the change since the run before", () => {
    expect(runScore(row())).toBe("DQS 80.0 (+5.0)");
    expect(runScore(row({ composite_score: 70 }))).toBe("DQS 70.0 (-5.0)");
    expect(runScore(row({ previous_score: null }))).toBe("DQS 80.0");
    expect(runScore(undefined)).toBeNull();
  });
});

describe("downloadWorkbooks", () => {
  it("asks for one ZIP for many runs and the plain workbook for one", async () => {
    await downloadWorkbooks([row(), row({ version_id: "v2", module: "customer_master" })]);
    expect(dl).toHaveBeenLastCalledWith("/reports/cleaning.zip", { runs: "v1:material_master,v2:customer_master" }, "cleaning-workbooks.zip");
    await downloadWorkbooks([row()]);
    expect(dl).toHaveBeenLastCalledWith("/reports/v1/cleaning/material_master.xlsx", undefined, "material_master-cleaning.xlsx");
  });
});

describe("Add to load", () => {
  it("links to load prepare with each object once", () => {
    expect(loadHref([row(), row({ version_id: "v2" }), row({ module: "customer_master" })])).toBe("/load?objs=material_master,customer_master");
    const act = { pull: vi.fn(), download: vi.fn(), upload: vi.fn(), compare: vi.fn(), score: vi.fn(), sysName: () => "ERP", can: () => true, scoring: new Set<string>() } as unknown as PortfolioActions;
    render(<BulkActions rows={[row()]} act={act} />);
    expect(screen.getByRole("link", { name: "Add to load" }).getAttribute("href")).toContain("/load?objs=material_master");
  });
});

describe("toast action", () => {
  it("runs the action and closes the toast", () => {
    const onClick = vi.fn();
    function Fire() {
      const toast = useToast();
      useEffect(() => toast({ text: "Done", tone: "good", action: { label: "Open Upload", onClick } }), [toast]);
      return null;
    }
    render(<ToastProvider><Fire /></ToastProvider>);
    act(() => fireEvent.click(screen.getByRole("button", { name: "Open Upload" })));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByText("Done")).toBeNull();
  });
});
