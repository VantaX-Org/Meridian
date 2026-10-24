import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as simApi from "@/lib/api/simulation";
import * as remediationApi from "@/lib/api/remediation";
import * as versionsApi from "@/lib/api/versions";
import WhatIfPage from "../page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/fix/what-if",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("@/lib/permissions")>()),
  usePermissions: () => ({ can: () => true, has: () => true }),
  usePermissionsContext: () => null,
}));

function mount() {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v1", label: "Run 1", status: "complete" }] } as never);
  vi.spyOn(simApi, "createSimulation").mockResolvedValue({ simulation_id: "s1" } as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><WhatIfPage /></QueryClientProvider>);
}

const counts = (failing: number) => ({ failing, total: 100, pass_rate: 1 - failing / 100, passed: failing === 0 });
const COMPLETED: simApi.SimulationCompleted = {
  simulation_id: "s1", status: "completed", version_id: "v1", modules: ["business_partner"],
  fixes: { groups: 1, cells_changed: 5, by_field: {}, unmatched_records: 0, tables: [] },
  dqs: { overall: { before: 70, after: 80, delta: 10, capped_before: false, capped_after: false }, modules: [], dimensions: [] },
  impact: [],
  rules: [
    { module: "business_partner", check_id: "BP-1", field: "LFA1.STCD1", severity: "high", dimension: "completeness", targeted: true, before: counts(10), after: counts(0), records_resolved: 10, records_introduced: 0, status: "resolved" },
  ],
  unchanged_rules: 0,
  side_effects: [
    { module: "business_partner", check_id: "BP-9", field: "LFA1.LAND1", severity: "low", dimension: "validity", targeted: false, before: counts(0), after: counts(2), records_resolved: 0, records_introduced: 2, status: "newly_failing" },
  ],
  findings: { before: 3, after: 1, resolved: 2, introduced: 1 },
  records: { resolved: 10, introduced: 2 },
  record_fixes: [{ check_id: "BP-1", module: "business_partner", field: "LFA1.STCD1", record_key: "LIFNR=100", new_value: "DE123", current_value: null }],
};

beforeEach(() => { vi.restoreAllMocks(); push.mockReset(); });

describe("WhatIfPage", () => {
  it("sends the user to Runs when there is no finished run to simulate", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><WhatIfPage /></QueryClientProvider>);
    const empty = (await screen.findByText("No finished run to simulate")).closest("[data-state='empty']") as HTMLElement;
    expect(within(empty).getByRole("link", { name: "Open runs" })).toHaveAttribute("href", "/runs");
  });

  it("shows the worker error instead of crashing when a simulation fails", async () => {
    vi.spyOn(simApi, "getSimulation").mockResolvedValue({ simulation_id: "s1", status: "failed", error: "worker exploded" });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /run simulation/i }));
    expect(await screen.findByText("worker exploded")).toBeInTheDocument();
    expect(screen.getByText("Simulation did not produce fixes")).toBeInTheDocument();
    expect(screen.queryByText(/could not reach the server/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("says the simulation expired when the lookup fails", async () => {
    vi.spyOn(simApi, "getSimulation").mockRejectedValue(new Error("404"));
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /run simulation/i }));
    expect(await screen.findByText(/has expired/i)).toBeInTheDocument();
  });

  it("lists the rules and side effects and opens a rule's record fixes", async () => {
    vi.spyOn(simApi, "getSimulation").mockResolvedValue(COMPLETED);
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /run simulation/i }));
    expect(await screen.findByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Introduced")).toBeInTheDocument();
    await userEvent.click(screen.getByText("BP-1"));
    expect(await screen.findByText("LIFNR=100")).toBeInTheDocument();
    expect(screen.getByText("DE123")).toBeInTheDocument();
  });

  it("creates a fix batch from the simulation and opens it", async () => {
    vi.spyOn(simApi, "getSimulation").mockResolvedValue(COMPLETED);
    const create = vi.spyOn(remediationApi, "createBatchFromSimulation").mockResolvedValue({ id: "b1", status: "draft", items: 10, with_proposal: 10, auto_approvable: 4 });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: /run simulation/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Create fix batch from this simulation" }));
    const buttons = await screen.findAllByRole("button", { name: "Create fix batch" });
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.stringContaining("What-if fixes"), "s1"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/fix?tab=batches&batch=b1"));
  });
});
