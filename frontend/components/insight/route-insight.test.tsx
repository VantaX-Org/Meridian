import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const m = vi.hoisted(() => ({ llm: vi.fn(), exec: vi.fn(), compare: vi.fn(), versions: { v: [{ id: "r1", status: "complete" }] as { id: string; status: string; metadata?: { system_id?: string } }[] }, path: { v: "/home/lead" } }));
vi.mock("next/navigation", () => ({ usePathname: () => m.path.v, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/hooks/use-day-one", () => ({ useDayOne: () => ({ step: undefined }) }));
vi.mock("@/lib/api/analytics", () => ({ getLlmHealth: m.llm }));
vi.mock("@/lib/api/insights", () => ({ getExec: m.exec }));
vi.mock("@/lib/api/connectivity", () => ({ getSystems: async () => [] }));
vi.mock("@/lib/api/versions", () => ({ getVersions: async () => ({ versions: m.versions.v }), compareVersions: m.compare }));
vi.mock("@/lib/api/findings", () => ({
  getFindingsAggregate: async () => ({ dqs: { composite: 70 }, severity: { critical: 1 }, total: 5, affected_records: 3, by_module: [], previous_dqs: 65 }),
}));

import { RouteInsight } from "./route-insight";

function mount(props: React.ComponentProps<typeof RouteInsight> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><RouteInsight {...props} /></QueryClientProvider>);
}

describe("RouteInsight gating", () => {
  beforeEach(() => { m.llm.mockReset(); m.exec.mockReset(); m.path.v = "/home/lead"; m.compare.mockReset(); m.versions.v = [{ id: "r1", status: "complete" }]; });

  it.each(["/objects", "/runs/r1", "/inbox", "/systems/s1", "/insights", "/insights/trends", "/admin/alerts"])("renders nothing on %s", (path) => {
    m.path.v = path;
    m.llm.mockResolvedValue({ llm_available: false });
    const { container } = mount();
    expect(container.innerHTML).toBe("");
  });

  it("shows the four cells only when the LLM is off: no repeated sentence, no admin link", async () => {
    m.llm.mockResolvedValue({ llm_available: false });
    mount();
    expect(await screen.findByText("Situation")).toBeTruthy();
    expect(m.exec).not.toHaveBeenCalled();
    expect(screen.queryByText(/AI summary off/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Enable in Admin/ })).toBeNull();
  });

  it("shows the AI summary only once the LLM reports available", async () => {
    m.path.v = "/home";
    m.llm.mockResolvedValue({ llm_available: true });
    m.exec.mockResolvedValue({ narrative: "model words" });
    mount();
    expect(await screen.findByText("model words")).toBeTruthy();
    expect(screen.getByText("Summary, written by the model from the findings")).toBeTruthy();
    // The four rule-built cells stay; the model's words are set under them.
    expect(screen.getByText("Situation")).toBeTruthy();
  });

  it("calls compare with a defined previous run as v1 and links current-vs-baseline", async () => {
    m.llm.mockResolvedValue({ llm_available: false });
    m.versions.v = [{ id: "r2", status: "complete" }, { id: "r1", status: "complete" }];
    m.compare.mockResolvedValue({ v1: { id: "r1" }, v2: { id: "r2" }, delta: { material_master: { dqs_change: -4.2 } }, checks: {} });
    mount();
    await waitFor(() => expect(m.compare).toHaveBeenCalledWith("r1", "r2"));
    await waitFor(() => expect(document.querySelector('a[href="/runs/r2/vs/r1"]')).toBeTruthy());
  });

  it("compares only with the previous finished run of the same system", async () => {
    m.llm.mockResolvedValue({ llm_available: false });
    m.versions.v = [
      { id: "r3", status: "complete", metadata: { system_id: "sf" } },
      { id: "r2", status: "complete", metadata: { system_id: "ecc" } },
      { id: "r1", status: "complete", metadata: { system_id: "sf" } },
    ];
    m.compare.mockResolvedValue({ v1: { id: "r1" }, v2: { id: "r3" }, delta: {}, checks: {} });
    mount();
    await waitFor(() => expect(m.compare).toHaveBeenCalledWith("r1", "r3"));
  });

  it("names the given to-do item as the do next step instead of the score's", async () => {
    m.llm.mockResolvedValue({ llm_available: false });
    mount({ doNext: { sentence: "KSA PRD cannot be reached", href: "/systems/s1", label: "Open system" } });
    expect(await screen.findByText(/KSA PRD cannot be reached\./)).toBeTruthy();
    expect(document.querySelector('a[href="/systems/s1"]')).toBeTruthy();
  });

  it("skips compare when there is no earlier finished run", async () => {
    m.llm.mockResolvedValue({ llm_available: false });
    mount();
    await screen.findByText("Situation");
    expect(m.compare).not.toHaveBeenCalled();
  });
});

describe("RouteInsight lineage", () => {
  beforeEach(() => { m.llm.mockReset(); m.exec.mockReset(); m.path.v = "/home/lead"; m.compare.mockReset(); });

  it("never compares an upload with an upload of other objects, and says it is the first run", async () => {
    m.llm.mockResolvedValue({ llm_available: false });
    m.versions.v = [
      { id: "bp", status: "complete", metadata: { modules: ["business_partner"] } } as never,
      { id: "co", status: "complete", metadata: { modules: ["controlling"] } } as never,
    ];
    mount();
    expect(await screen.findByText(/first run of this object/)).toBeTruthy();
    expect(m.compare).not.toHaveBeenCalled();
  });

  it("scores the current state of every object, as the home below it does, not the newest run alone", async () => {
    m.llm.mockResolvedValue({ llm_available: false });
    const scored = (id: string, run_at: string, module: string, composite_score: number) => ({
      id, run_at, status: "complete", metadata: { modules: [module] },
      dqs_summary: { [module]: { composite_score, dimension_scores: {}, critical_count: 0, high_count: 0, medium_count: 0, low_count: 0, total_checks: 1, passing_checks: 1, capped: false, cap_reason: null } },
    }) as never;
    m.versions.v = [scored("co2", "2026-10-16T05:00:00Z", "controlling", 60), scored("co1", "2026-10-16T04:00:00Z", "controlling", 50), scored("mm", "2026-10-15T00:00:00Z", "material_master", 90)];
    m.compare.mockResolvedValue({ v1: { id: "co1" }, v2: { id: "co2" }, delta: {}, checks: {} });
    mount();
    // (60 + 90) / 2 = 75 against (50 + 90) / 2 = 70; the aggregate's own composite (70) is not used
    expect(await screen.findByText(/Quality is at 75/)).toBeTruthy();
    expect(screen.getByText(/Up 5 points since the last run/)).toBeTruthy();
    await waitFor(() => expect(m.compare).toHaveBeenCalledWith("co1", "co2"));
  });

  it("compares uploads of the same objects", async () => {
    m.llm.mockResolvedValue({ llm_available: false });
    m.versions.v = [
      { id: "bp2", status: "complete", metadata: { modules: ["business_partner"] } } as never,
      { id: "co", status: "complete", metadata: { modules: ["controlling"] } } as never,
      { id: "bp1", status: "complete", metadata: { modules: ["business_partner"] } } as never,
    ];
    m.compare.mockResolvedValue({ v1: { id: "bp1" }, v2: { id: "bp2" }, delta: {}, checks: {} });
    mount();
    await waitFor(() => expect(m.compare).toHaveBeenCalledWith("bp1", "bp2"));
  });
});
