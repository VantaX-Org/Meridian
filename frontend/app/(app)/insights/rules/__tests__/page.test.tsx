import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as versionsApi from "@/lib/api/versions";
import { rulesFor80 } from "../../_components/rulesFor80";
import RulesPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/insights/rules",
  useSearchParams: () => new URLSearchParams("run=v1"),
}));

const row = (id: string, impact: number) => ({
  check_id: id, name: `Rule ${id}`, module: "material_master", severity: "high", dimension: "validity", field: "MTART",
  affected: impact, total: 100, pass_rate: 0.5, impact, auto_fix_pct: 10, s4: "none", delta_affected: null, cost_at_risk: null,
});

function mount() {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ id: "v1", label: "Run 1", status: "complete" }] } as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><RulesPage /></QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

describe("rulesFor80", () => {
  it("counts the rules that reach 80 percent", () => {
    expect(rulesFor80([50, 30, 10, 10])).toBe(2);
    expect(rulesFor80([])).toBe(0);
  });
});

describe("RulesPage", () => {
  it("renders the ranking with the 80 percent caption and no h1", async () => {
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [row("A1", 80), row("A2", 20)] });
    mount();
    expect(await screen.findByText(/1 rule accounts for 80 % of impact/)).toBeInTheDocument();
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /impact/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Rule ranking" })).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [] });
    mount();
    expect(await screen.findByText("No failing rules")).toBeInTheDocument();
  });

  it("shows an error with retry", async () => {
    vi.spyOn(insightsApi, "getRuleRanking").mockRejectedValue(new Error("network error"));
    mount();
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
