import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as connectivityApi from "@/lib/api/connectivity";
import * as insightsApi from "@/lib/api/insights";
import * as versionsApi from "@/lib/api/versions";
import TrendsPage from "../page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/insights",
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }), useSearchParams: () => new URLSearchParams("run=v2") }));

const run = (id: string, composite: number) => ({
  version_id: id, label: id, run_at: null, baseline: false, composite, dimensions: { completeness: composite, validity: composite - 5 },
  modules: {}, critical: 0, blockers: 0, auto_fixable_pct: null,
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
    vi.spyOn(insightsApi, "getTrends").mockResolvedValue({ lineage: "l", runs: [run("r1", 60), run("r2", 70)], annotations: [] });
    mount();
    expect(await screen.findByText(/rose from 60 to 70 over 2 runs/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Trends" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /score per run/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("grid")).toBeInTheDocument();
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

  it("refetches trends scoped to the chosen system", async () => {
    const spy = vi.spyOn(insightsApi, "getTrends").mockResolvedValue({ lineage: "l", runs: [run("r1", 60), run("r2", 70)], annotations: [] });
    mount();
    await screen.findByText(/rose from 60 to 70/);
    expect(spy).toHaveBeenLastCalledWith({ version_id: "v2", system_id: undefined, limit: 12 });
    fireEvent.click(await screen.findByRole("combobox", { name: "System" }));
    const option = await screen.findByRole("option", { name: "S4" });
    fireEvent.mouseMove(option);
    await waitFor(() => expect(option).toHaveAttribute("data-highlighted"));
    fireEvent.click(option);
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ version_id: "v2", system_id: "s2", limit: 12 }));
  });
});
