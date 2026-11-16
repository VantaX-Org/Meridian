import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "lead", label: "Administrator", name: "Test", email: null, id: "u-me", fixture: false, shared: false, viewAs: null, can: () => true }) };
});
vi.mock("@/lib/v2/runs-queries", () => ({
  useVersionHead: () => ({ data: { id: "v2", run_at: "2026-11-10T08:00:00Z", status: "complete", metadata: { baseline: true } }, isLoading: false, isError: false, refetch: vi.fn() }),
  useTimeline: () => ({ data: { runs: [{ id: "v1", run_at: "2026-11-01T08:00:00Z" }, { id: "v2", run_at: "2026-11-10T08:00:00Z", kind: "manual", records_checked: 1200, duration_s: 75 }] } }),
  useCompareSummary: () => ({ data: { totals: { newly_failing: 2, fixed: 3, worse: 1, better: 4 } }, isError: false, refetch: vi.fn() }),
}));
const refill = vi.fn().mockResolvedValue({});
vi.mock("@/lib/api/v2/extract-target", () => ({
  getRunExtractTarget: () => Promise.resolve({ target_system_id: "s4", templates: [{ module: "material_master", template_id: "t1", template_name: "Material load", status: "failed", error: "No extraction" }] }),
  openExtractTargetFile: vi.fn(),
  refillExtractTarget: (...a: unknown[]) => refill(...a),
}));
vi.mock("@/lib/api/v2/migration", () => ({ getTemplates: () => Promise.resolve({ templates: [{ id: "t1" }] }) }));

import { RUN_BODIES, RunInspectorNative } from "../run";

afterEach(() => vi.clearAllMocks());

describe("run inspector (next)", () => {
  it("registers the run kind", () => {
    expect(Object.keys(RUN_BODIES)).toEqual(["run"]);
  });

  it("shows the run, the change since the run before, its output, and refills a template", async () => {
    renderWithQuery(<RunInspectorNative id="v2" onClose={vi.fn()} />);
    expect(screen.getByText("Baseline")).toBeInTheDocument();
    expect(screen.getByText("1 m 15 s")).toBeInTheDocument();
    expect(screen.getByTestId("run-since")).toHaveTextContent("2 rules started failing, 3 stopped");
    expect(screen.getByRole("link", { name: "Compare with the run before" })).toHaveAttribute("href", expect.stringContaining("/run/v1/vs/v2"));
    expect(await screen.findByTestId("run-output-status-material_master")).toHaveTextContent("Failed");
    fireEvent.click(screen.getByTestId("run-output-refill-material_master"));
    await waitFor(() => expect(refill).toHaveBeenCalledWith("v2", "material_master"));
  });
});
