import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as connectivityApi from "@/lib/api/connectivity";
import * as insightsApi from "@/lib/api/insights";
import * as versionsApi from "@/lib/api/versions";
import TrendsPage from "../page";

// The shared InsightActions bar (Run analysis) reads the role; no auth provider is mounted here.
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/insights",
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }), useSearchParams: () => new URLSearchParams("run=v2") }));

const run = (id: string, composite: number) => ({
  version_id: id, label: id, run_at: null, baseline: false, composite, dimensions: { completeness: composite, validity: composite - 5 },
  modules: {}, critical: 0, high: 2, failing_rules: 5, affected_records: 1200, blockers: 0, auto_fixable_pct: null,
  change: null as number | null, rules_fixed: null as number | null, rules_new: null as number | null,
});

function mount() {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v2", status: "complete" }] } as never);
  vi.spyOn(connectivityApi, "getSystems").mockResolvedValue([{ id: "s1", name: "ECC" }, { id: "s2", name: "S4" }] as never);
  vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v2", rows: [] });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><TrendsPage /></QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("TrendsPage", () => {
  it("renders the narrative and labelled charts under one header", async () => {
    vi.spyOn(insightsApi, "getTrends").mockResolvedValue({ lineage: "l", runs: [run("v1", 60), run("v2", 70)], annotations: [] });
    mount();
    // The sentence is the header's situation and the composite card's meta.
    expect((await screen.findAllByText(/rose from 60 to 70 over 2 runs/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Trends" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /score per run/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("grid").length).toBeGreaterThan(0);
  });

  it("says a dimension the API omits is not measured, holds the x domain across cards and writes held at for a flat line", async () => {
    const r1 = { ...run("v1", 70), run_at: "2026-10-16T05:00:00Z", label: "business_partner_1k" };
    const r2 = { ...run("v2", 70), run_at: "2026-10-16T17:30:00Z", label: "business_partner_100k" };
    vi.spyOn(insightsApi, "getTrends").mockResolvedValue({ lineage: "l", runs: [r1, r2], annotations: [] });
    mount();
    expect((await screen.findAllByText("Composite score held at 70 over 2 runs.")).length).toBeGreaterThan(0);
    // Four dimensions (timeliness among them) are absent from both runs: an inline note each, never a blank chart.
    expect(screen.getAllByText("Not measured in these runs")).toHaveLength(4);
    expect(screen.queryByRole("img", { name: /Timeliness score per run/ })).toBeNull();
    // Ticks are the date and time (two runs on one day), never the upload labels.
    expect(screen.getByRole("img", { name: "Composite score per run: 16 Oct 2026, 05:00 70, 16 Oct 2026, 17:30 70" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /business_partner_100k/ })).toBeNull();
    // The change heatmap is keyed the same way.
    expect(screen.getByLabelText("Completeness 16 Oct 2026, 17:30: 0")).toBeInTheDocument();
    expect(screen.getByText("The score has not moved across these runs.")).toBeInTheDocument();
  });

  it("lists every run newest first with its change, rules fixed and rules newly failing", async () => {
    const r1 = run("v1", 60);
    const r2 = { ...run("v2", 70), change: 10, rules_fixed: 3, rules_new: 1, critical: 1, affected_records: 900 };
    vi.spyOn(insightsApi, "getTrends").mockResolvedValue({ lineage: "l", runs: [r1, r2], annotations: [] });
    mount();
    await screen.findAllByText(/rose from 60 to 70/);
    expect(screen.getByRole("heading", { level: 2, name: "Run by run" })).toBeInTheDocument();
    expect(screen.getByText("3 rules fixed and 1 newly failing across these runs, each against the run before")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").filter((r) => /^v[12]/.test(r.textContent ?? ""));
    expect(rows.map((r) => r.textContent?.slice(0, 2))).toEqual(["v2", "v1"]);
    expect(rows[0]).toHaveTextContent("This run");
    expect(rows[0]).toHaveTextContent("+10");
    expect(rows[0]).toHaveTextContent("900");
    expect(rows[1]).toHaveTextContent("first run");
    // Each run's counts open that run's failing records in Fix work.
    expect(screen.getByRole("link", { name: "Open the 900 failing records of run v2" })).toHaveAttribute("href", "/fix?run=v2");
    expect(screen.getByRole("link", { name: "Open the critical failing records of run v2" })).toHaveAttribute("href", "/fix?run=v2&sev=critical");
    expect(screen.getByRole("link", { name: "Open the high failing records of run v1" })).toHaveAttribute("href", "/fix?run=v1&sev=high");
    expect(screen.queryByRole("link", { name: "Open the critical failing records of run v1" })).toBeNull();
  });

  it("shows the empty state", async () => {
    vi.spyOn(insightsApi, "getTrends").mockResolvedValue({ lineage: "l", runs: [], annotations: [] });
    mount();
    expect(await screen.findByText("No runs to compare yet")).toBeInTheDocument();
  });

  it("shows an error with retry", async () => {
    vi.spyOn(insightsApi, "getTrends").mockRejectedValue(new Error("network error"));
    mount();
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("reads the trend of the scoped run's own system: no second System choice, the window is the only control", async () => {
    const spy = vi.spyOn(insightsApi, "getTrends").mockResolvedValue({ lineage: "l", runs: [run("v1", 60), run("v2", 70)], annotations: [] });
    mount();
    await screen.findAllByText(/rose from 60 to 70/);
    expect(spy).toHaveBeenLastCalledWith({ version_id: "v2", limit: 12 });
    expect(screen.queryByRole("combobox", { name: "System" })).toBeNull();
    // The ledger's Change column says what it is measured against.
    expect(screen.getByRole("button", { name: "About Previous run" })).toBeInTheDocument();
    expect(screen.getByText("Ranked by the change in failing records since the run before")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("combobox", { name: "Window" }));
    const option = await screen.findByRole("option", { name: "Last 6 runs" });
    fireEvent.mouseMove(option);
    await waitFor(() => expect(option).toHaveAttribute("data-highlighted"));
    fireEvent.click(option);
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ version_id: "v2", limit: 6 }));
  });
});
