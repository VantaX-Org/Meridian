// frontend/app/(app)/insights/__tests__/page.test.tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as versionsApi from "@/lib/api/versions";
import InsightsIndexPage from "../page";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, prefetch: vi.fn() }) }));
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null }),
  DayOneAction: () => null,
}));

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const exec = {
  version_id: "v1",
  narrative: "",
  readiness_cells: [{ module: "m", wave: "w1", verdict: "no_go" as const, blocker_count: 1, dqs: 50, score: 50, records_blocked: 3 }],
  waterfall: [],
  impact_rows: [],
  owner_rows: [],
};

describe("InsightsIndexPage", () => {
  it("lists every insight with the no-go one first and one exec fetch", async () => {
    const getExec = vi.spyOn(insightsApi, "getExec").mockResolvedValue(exec);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    renderWithQuery(<InsightsIndexPage />);
    expect(await screen.findByText("1 wave and module cells are no-go")).toBeInTheDocument();
    const names = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(names[0]).toMatch(/^Readiness/);
    expect(screen.getByText("Duplicates")).toBeInTheDocument();
    expect(getExec).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when there is no run", async () => {
    vi.spyOn(insightsApi, "getExec").mockResolvedValue({ ...exec, version_id: null, readiness_cells: [] });
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    renderWithQuery(<InsightsIndexPage />);
    expect(await screen.findByText("No insights yet")).toBeInTheDocument();
  });

  it("shows a retry control when the load fails", async () => {
    vi.spyOn(insightsApi, "getExec").mockRejectedValue(new Error("network error"));
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    renderWithQuery(<InsightsIndexPage />);
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
