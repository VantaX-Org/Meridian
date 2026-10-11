import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const m = vi.hoisted(() => ({ llm: vi.fn(), exec: vi.fn(), compare: vi.fn(), versions: { v: [{ id: "r1", status: "complete" }] }, admin: { v: true } }));
vi.mock("next/navigation", () => ({ usePathname: () => "/objects", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/hooks/use-day-one", () => ({ useDayOne: () => ({ step: undefined }) }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ isAdmin: m.admin.v }) }));
vi.mock("@/lib/api/analytics", () => ({ getLlmHealth: m.llm }));
vi.mock("@/lib/api/insights", () => ({ getExec: m.exec }));
vi.mock("@/lib/api/connectivity", () => ({ getSystems: async () => [] }));
vi.mock("@/lib/api/migration", () => ({ getWaves: async () => [] }));
vi.mock("@/lib/api/stewardship", () => ({ getMetrics: async () => ({}) }));
vi.mock("@/lib/api/versions", () => ({ getVersions: async () => ({ versions: m.versions.v }), compareVersions: m.compare }));
vi.mock("@/lib/api/findings", () => ({
  getFindingsAggregate: async () => ({ dqs: { composite: 70 }, severity: { critical: 1 }, total: 5, affected_records: 3, by_module: [], previous_dqs: 65 }),
}));

import { RouteInsight } from "./route-insight";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><RouteInsight /></QueryClientProvider>);
}

describe("RouteInsight gating", () => {
  beforeEach(() => { m.llm.mockReset(); m.exec.mockReset(); m.admin.v = true; m.compare.mockReset(); m.versions.v = [{ id: "r1", status: "complete" }]; });

  it("does not fetch the exec narrative and shows the admin link when the LLM is off", async () => {
    m.llm.mockResolvedValue({ llm_available: false });
    mount();
    expect(await screen.findByRole("link", { name: /Enable in Admin/ })).toBeTruthy();
    expect(m.exec).not.toHaveBeenCalled();
  });

  it("fetches the exec narrative once the LLM reports available", async () => {
    m.llm.mockResolvedValue({ llm_available: true });
    m.exec.mockResolvedValue({ narrative: "model words" });
    mount();
    await waitFor(() => expect(m.exec).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: /Enable in Admin/ })).toBeNull();
  });

  it("calls compare with a defined previous run as v1 and links current-vs-baseline", async () => {
    m.llm.mockResolvedValue({ llm_available: false });
    m.versions.v = [{ id: "r2", status: "complete" }, { id: "r1", status: "complete" }];
    m.compare.mockResolvedValue({ v1: { id: "r1" }, v2: { id: "r2" }, delta: { material_master: { dqs_change: -4.2 } }, checks: {} });
    mount();
    await waitFor(() => expect(m.compare).toHaveBeenCalledWith("r1", "r2"));
    await waitFor(() => expect(document.querySelector('a[href="/runs/r2/vs/r1"]')).toBeTruthy());
  });

  it("skips compare when there is no earlier finished run", async () => {
    m.llm.mockResolvedValue({ llm_available: false });
    mount();
    await screen.findByRole("link", { name: /Enable in Admin/ });
    expect(m.compare).not.toHaveBeenCalled();
  });
});
