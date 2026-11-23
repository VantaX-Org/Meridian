import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import * as mining from "@/lib/api/v2/mining";
import { MiningByObject, MiningSteps } from "./MiningRun";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/lib/api/v2/mining", async (orig) => ({ ...(await orig<typeof mining>()), getMiningGraph: vi.fn() }));

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/x?fixture=1"); });
afterEach(() => undo());
const wrap = (n: React.ReactNode) => renderWithQuery(<AletheiaProvider>{n}</AletheiaProvider>);

describe("mining run views", () => {
  it("shows findings per object", async () => {
    wrap(<MiningByObject />);
    expect(await screen.findByRole("group", { name: "Findings by object" }, { timeout: 5000 })).toBeTruthy();
    expect(document.body.textContent).not.toContain(String.fromCharCode(0xb7));
  });

  it("shows process steps and retries a failed graph", async () => {
    vi.mocked(mining.getMiningGraph).mockRejectedValueOnce(new Error("boom")).mockResolvedValue({
      version_id: "v", module: "material_master", cases: [], cases_supported: false, transitions: [],
      activities: [{ id: "a1", label: "Create material", l4_id: "L4-1", l4_name: "Create", tcode: "MM01", step_status: "amber", affected_records: 10, finding_count: 3, avg_pass_rate: 0.8 }],
      variants: [{ id: "v1", label: "Standard", tcode: null, activity_count: 1, coverage: 0.9, readiness: "green", quality: 0.95, activity_ids: ["a1"] }],
    });
    wrap(<MiningSteps />);
    fireEvent.click(await screen.findByRole("button", { name: /Try again/ }, { timeout: 5000 }));
    expect(await screen.findByRole("group", { name: "Process steps" }, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByRole("group", { name: "Process variants" })).toBeTruthy();
  });

  it("empty graph shows empty state", async () => {
    vi.mocked(mining.getMiningGraph).mockResolvedValue({ version_id: "v", module: "m", activities: [], transitions: [], variants: [], cases: [], cases_supported: false });
    wrap(<MiningSteps />);
    expect(await screen.findByText("No process steps mined for this object", undefined, { timeout: 5000 })).toBeTruthy();
  });
});
