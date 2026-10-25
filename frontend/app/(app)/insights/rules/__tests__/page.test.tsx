import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as insightsApi from "@/lib/api/insights";
import * as settingsApi from "@/lib/api/settings";
import * as versionsApi from "@/lib/api/versions";
import { rulesFor80 } from "../../_components/rulesFor80";
import RulesPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
let query = "run=v1";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/insights/rules",
  useSearchParams: () => new URLSearchParams(query),
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
    expect(await screen.findByText(/1 rule accounts for 80% of impact/)).toBeInTheDocument();
    expect(screen.getByRole("grid")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /impact/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Failing rules" })).toBeInTheDocument();
  });

  it("shows the field, the cost at risk in the tenant currency and links Open records to the object's records tab", async () => {
    vi.spyOn(settingsApi, "getCostModel").mockResolvedValue({ currency: "ZAR", features: {} } as never);
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [{ ...row("A1", 80), cost_at_risk: 1250 }, row("A2", 20)] });
    mount();
    expect(await screen.findByRole("columnheader", { name: "Field" })).toBeInTheDocument();
    expect(screen.getAllByText("MTART").length).toBeGreaterThan(0);
    expect(await screen.findByRole("columnheader", { name: "Cost at risk (ZAR)" })).toBeInTheDocument();
    expect(screen.getAllByText(/ZAR[\u00a0 ]?1[,. \u00a0]250/).length).toBeGreaterThan(0);
    // Each rule's failing records open in Fix work, filtered to that rule on its object.
    const links = screen.getAllByText("Open records").map((e) => e.closest("a"));
    expect(links[0]).toHaveAttribute("href", "/fix?run=v1&module=material_master&check=A1");
    expect(links[0]?.getAttribute("aria-label")).toMatch(/^Open the [\d,]+ failing records of rule A1 in material master$/);
    expect(screen.getByText("Impact by rule")).toBeInTheDocument();
    // The shared tab strip and action bar come with the frame.
  });

  it("keeps the product's case in Impact by S/4 status", async () => {
    query = "run=v1&axis=s4";
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [{ ...row("A1", 80), s4: "blocking" }] });
    mount();
    expect(await screen.findByText("Impact by S/4 status")).toBeInTheDocument();
    expect(screen.queryByText(/Impact by s\/4/)).toBeNull();
    expect(screen.getByText("1 rule would block an S/4 load")).toBeInTheDocument();
    query = "run=v1";
  });

  it("says why nothing is listed: no rule fails in the run", async () => {
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [] });
    mount();
    expect(await screen.findByText("No rule fails in this run")).toBeInTheDocument();
    for (const a of screen.getAllByRole("link", { name: "Open runs" })) expect(a).toHaveAttribute("href", "/runs");
  });

  it("says the filters hide every rule, and clears them", async () => {
    query = "run=v1&severity=critical";
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [] });
    mount();
    expect(await screen.findByText("No failing rules match")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Clear filters" })[0]).toHaveAttribute("href", "/insights/rules?run=v1");
    query = "run=v1";
  });

  it("puts the rule's plain name first and its check id second, under a one-line purpose", async () => {
    vi.spyOn(insightsApi, "getRuleRanking").mockResolvedValue({ version_id: "v1", rows: [row("A1", 80)] });
    mount();
    expect(await screen.findByTestId("page-purpose")).toHaveTextContent("Which checks cost the most, and where to start.");
    expect(screen.queryByRole("columnheader", { name: "Name" })).toBeNull();
    expect((await screen.findAllByText("A1")).length).toBeGreaterThan(0);
  });

  it("shows an error with retry", async () => {
    vi.spyOn(insightsApi, "getRuleRanking").mockRejectedValue(new Error("network error"));
    mount();
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
