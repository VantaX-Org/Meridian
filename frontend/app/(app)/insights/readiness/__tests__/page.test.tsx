import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as migrationApi from "@/lib/api/migration";
import ReadinessPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/insights",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("run=v1"),
}));

// useDayOne() needs LocalAuthProvider context, which this test does not set up;
// mock it wholesale so the page renders without an auth provider.
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null, error: null, refetch: () => {} }),
  DayOneAction: () => null,
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("ReadinessPage", () => {
  it("renders a verdict badge per module/wave cell", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({
      version_id: "v1",
      threshold: 70,
      cells: [{ module: "material_master", wave: "Wave 1", verdict: "go", blocker_count: 0, dqs: 92, score: 100, records_blocked: 0 }],
      configured: true,
    });
    renderWithQuery(<ReadinessPage />);
    expect(await screen.findByRole("button", { name: "Material master Wave 1: go" })).toBeInTheDocument();
    expect(screen.getByText("No blockers in this run")).toBeInTheDocument();
  });

  it("lists blocked cells worst first in the blockers table", async () => {
    vi.spyOn(migrationApi, "getWaves").mockResolvedValue([{ id: "w2", name: "Wave 2" }] as never);
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({
      version_id: "v1",
      threshold: 70,
      cells: [
        { module: "material_master", wave: "Wave 1", verdict: "go", blocker_count: 0, dqs: 92, score: 100, records_blocked: 0 },
        { module: "material_master", wave: "Wave 2", verdict: "at_risk", blocker_count: 1, dqs: 80, score: 90, records_blocked: 3 },
      ],
      configured: true,
    });
    renderWithQuery(<ReadinessPage />);
    expect(await screen.findByRole("button", { name: "Material master Wave 2: at-risk" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Records blocked" })).toBeInTheDocument();
    expect(screen.getByText("At risk")).toBeInTheDocument();
    // The object opens its records in Fix work; the count is migration gaps (not rules) and opens the wave's gap view.
    expect(screen.getByRole("link", { name: "Open the open records of material master" })).toHaveAttribute("href", "/fix?run=v1&module=material_master");
    expect(screen.getByRole("columnheader", { name: "Migration gaps" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Blocking findings" })).toBeNull();
    expect(await screen.findByRole("link", { name: "Open the 1 migration gap of Material master in Wave 2" })).toHaveAttribute("href", "/migration/w2?tab=blockers");
    expect(screen.getByRole("link", { name: "Open the migration gaps behind the 3 blocked records of Material master in Wave 2" })).toHaveAttribute("href", "/migration/w2?tab=blockers");
  });

  it("shows a loading skeleton while the request is in flight", () => {
    vi.spyOn(insightsApi, "getReadiness").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<ReadinessPage />);
    expect(container.querySelector("table")).not.toBeInTheDocument();
  });

  it("with a run but no wave, the grid offers Create wave into the migration cockpit and the S/4 strip still renders", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({ version_id: "v1", threshold: 70, cells: [], configured: true });
    vi.spyOn(migrationApi, "getS4Readiness").mockResolvedValue({
      version_id: "v1", status: "ok", ready: false, rules: 5, evaluated: 5, failing: 3, failing_records: 9, blocking_failing: 2, warning_failing: 1,
      areas: [{ area: "bp", label: "Business partner / CVI", simplification_item: null, rules: 5, evaluated: 5, failing: 3, failing_records: 9, blocking_failing: 2, warning_failing: 1, status: "x", checks: [] }],
    });
    renderWithQuery(<ReadinessPage />);
    expect(await screen.findByText("No waves yet")).toBeInTheDocument();
    // The grid's empty state and the header's next step both lead to the migration cockpit.
    const links = screen.getAllByRole("link", { name: "Create wave" });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute("href", "/migration");
    expect(screen.queryByText(/no readiness data/i)).toBeNull();
    const strip = await screen.findByTestId("s4-strip");
    await waitFor(() => expect(strip).toHaveTextContent("Blockers2"));
    // Without waves the blockers table lists the failing S/4 areas instead of an empty line.
    expect(await screen.findByRole("columnheader", { name: "S/4 area" })).toBeInTheDocument();
    expect(screen.getByText("Business partner / CVI")).toBeInTheDocument();
    // S/4-blocking rules only, so the header says so; not the blocking findings set.
    expect(screen.getByRole("columnheader", { name: "S/4 blocking rules" })).toBeInTheDocument();
    expect(screen.getByText(/2 rules would block an S\/4 load, and no wave is set up yet/)).toBeInTheDocument();
  });

  it("shows the no-data empty state only when there is no run at all", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({ version_id: null, threshold: 70, cells: [], configured: true });
    renderWithQuery(<ReadinessPage />);
    // The route carries run=v1, so the S/4 strip is scoped to it and the page is not empty; the grid carries the wave empty state.
    expect(await screen.findByText("No waves yet")).toBeInTheDocument();
  });

  it("shows a not-configured empty state when readiness waves aren't set", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({ version_id: null, threshold: 70, cells: [], configured: false });
    renderWithQuery(<ReadinessPage />);
    await waitFor(() => expect(screen.getByText(/readiness is not set up yet/i)).toBeInTheDocument());
    // Waves are what readiness needs, and they are created in the migration cockpit (not under Scoring and alerts).
    expect(screen.getByRole("link", { name: "Open migration cockpit" })).toHaveAttribute("href", "/migration");
    expect(screen.queryByText(/scoring and alerts/i)).not.toBeInTheDocument();
  });

  it("shows an error state when the request fails", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockRejectedValue(new Error("network error"));
    renderWithQuery(<ReadinessPage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
  });

  it("retries the readiness request when the retry button is clicked", async () => {
    const getReadiness = vi
      .spyOn(insightsApi, "getReadiness")
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ version_id: "v1", threshold: 70, cells: [], configured: true });
    renderWithQuery(<ReadinessPage />);

    const retry = await screen.findByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByText("No waves yet")).toBeInTheDocument());
    expect(getReadiness).toHaveBeenCalledTimes(2);
  });

  it("shows blockers and warnings from the S/4 areas", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({ version_id: "v1", threshold: 70, cells: [{ module: "material_master", wave: "Wave 1", verdict: "go", blocker_count: 0, dqs: 92, score: 100, records_blocked: 0 }], configured: true });
    vi.spyOn(migrationApi, "getS4Readiness").mockResolvedValue({
      version_id: "v1", status: "ok", ready: false, rules: 5, evaluated: 5, failing: 5, failing_records: 9, blocking_failing: 2, warning_failing: 3,
      areas: [{ area: "a", label: "A", simplification_item: null, rules: 5, evaluated: 5, failing: 5, failing_records: 9, blocking_failing: 2, warning_failing: 3, status: "x", checks: [] }],
    });
    renderWithQuery(<ReadinessPage />);
    const strip = await screen.findByTestId("s4-strip");
    await waitFor(() => expect(strip).toHaveTextContent("Blockers2"));
    expect(strip).toHaveTextContent("Warnings3");
    // Each count opens the rules it counts: the blocking S/4 rules and the warning S/4 rules, not every S/4 or medium rule.
    expect(within(strip).getByRole("link", { name: /Blockers/ })).toHaveAttribute("href", "/insights/rules?run=v1&s4=blocking");
    expect(within(strip).getByRole("link", { name: /Warnings/ })).toHaveAttribute("href", "/insights/rules?run=v1&s4=warning");
  });

  it("opens an object's blocking rules without a wave parameter the object page never reads", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({
      version_id: "v1", threshold: 70, configured: true,
      cells: [{ module: "material_master", wave: "Wave 2", verdict: "no_go", blocker_count: 1, dqs: 60, score: 50, records_blocked: 3 }],
    });
    renderWithQuery(<ReadinessPage />);
    const fix = await screen.findByRole("link", { name: "Fix the critical and high rules of Material master in wave Wave 2" });
    expect(fix).toHaveAttribute("href", "/objects/material_master?run=v1&tab=rules&blocking=true");
  });
});
