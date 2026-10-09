import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as connectivityApi from "@/lib/api/connectivity";
import * as miningApi from "@/lib/api/process-mining";
import * as versionsApi from "@/lib/api/versions";
import ProcessInsightsPage from "../page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/insights/process",
}));

// useDayOne() needs LocalAuthProvider context, which this test does not set up;
// mock it wholesale so the page renders without an auth provider.
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null }),
  DayOneAction: () => null,
}));

const LATEST = {
  id: "v1", label: "Run 1", status: "complete", run_at: "2026-01-01T00:00:00Z",
  dqs_summary: { material_master: 90 },
};

describe("ProcessInsightsPage", () => {
  it("renders readiness for the latest version's first object", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [LATEST as never] });
    vi.spyOn(connectivityApi, "getBusinessProcess").mockResolvedValue([
      {
        l1_id: "l1", l1_name: "Procure to pay", l1_description: "", system: "ecc",
        l2_groups: [{
          l2_id: "l2", l2_name: "Source", l3_processes: [{
            l3_id: "l3", l3_name: "Create PO", description: "", overall_readiness: "green",
            l4_subprocesses: [{
              l4_id: "l4", l4_name: "ME21N", tcode: "ME21N", description: "", config_dependency: null,
              step_status: "green",
              activities: [{ l5_id: "l5", l5_name: "Create", description: "", tcode: "ME21N", fields: [], check_ids: [], activity_status: "green" }],
            }],
          }],
        }],
      },
    ]);
    vi.spyOn(connectivityApi, "getConfigImpact").mockResolvedValue({
      results: [], summary: { total_features_assessed: 0, features_blocked: 0, features_degraded: 0, features_ok: 0, top_blocked_features: [] },
    });
    vi.spyOn(miningApi, "getMiningGraph").mockResolvedValue({
      version_id: "v1", module: "material_master", activities: [], transitions: [], variants: [], cases: [], cases_supported: false,
    });
    vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<ProcessInsightsPage />);
    await waitFor(() => expect(screen.getByText("Procure to pay — gates")).toBeInTheDocument());
    expect(screen.getByText("Readiness")).toBeInTheDocument();
    expect(screen.getByText("Map")).toBeInTheDocument();
  });

  it("shows the API error message for readiness and retries on click", async () => {
    vi.spyOn(versionsApi, "getVersions").mockRejectedValue(new Error("versions service unavailable"));
    renderWithQuery(<ProcessInsightsPage />);
    await screen.findByText("versions service unavailable");
    const calls = (versionsApi.getVersions as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((versionsApi.getVersions as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });
});
