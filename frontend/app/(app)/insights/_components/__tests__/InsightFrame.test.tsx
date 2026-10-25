import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as versionsApi from "@/lib/api/versions";
import { InsightFrame } from "../InsightFrame";

let path = "/insights";
let query = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => path,
  useSearchParams: () => new URLSearchParams(query),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const summary = (score: number) => ({
  composite_score: score,
  dimension_scores: { completeness: score, accuracy: score, consistency: score, timeliness: score, uniqueness: score, validity: score },
  critical_count: 0, high_count: 0, medium_count: 0, low_count: 0, total_checks: 1, passing_checks: 1, capped: false, cap_reason: null,
});
const versions = [
  { id: "co2", label: "controlling_1k", status: "complete", run_at: "2026-10-16T05:17:00Z", dqs_summary: { controlling: summary(60) }, metadata: { modules: ["controlling"] } },
  { id: "co1", label: "controlling_1k", status: "complete", run_at: "2026-10-15T05:17:00Z", dqs_summary: { controlling: summary(55) }, metadata: { modules: ["controlling"] } },
  { id: "mm1", label: "material_master_25k", status: "complete", run_at: "2026-10-16T03:05:00Z", dqs_summary: { material_master: summary(80) }, metadata: { modules: ["material_master"] } },
];

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><InsightFrame title="Insights" scope /></QueryClientProvider>);
}

beforeEach(() => {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("InsightFrame scope line", () => {
  it("describes the current state of every object on the overview without ?run=", async () => {
    path = "/insights";
    query = "";
    mount();
    const line = await screen.findByTestId("insight-scope");
    expect(line).toHaveAttribute("data-scope", "current");
    expect(screen.getByTestId("run-scope")).toHaveTextContent("Current state of 2 objects, latest run 16 Oct 2026");
    // one run can still be opened from here, and nothing claims a single run
    expect(screen.getByRole("combobox", { name: "Showing" })).toBeInTheDocument();
    expect(line).not.toHaveTextContent("As of");
    expect(line).not.toHaveTextContent("One run");
  });

  it("names one run, with the picker, when ?run= pins it, and offers the way back to the current state", async () => {
    path = "/insights";
    query = "run=co1";
    mount();
    const line = await screen.findByTestId("insight-scope");
    expect(line).toHaveAttribute("data-scope", "run");
    expect(line).toHaveTextContent("One run");
    expect(line).toHaveTextContent("As of");
    expect(screen.getByRole("combobox", { name: "Showing run" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to current state" })).toHaveAttribute("href", "/insights");
    expect(line).not.toHaveTextContent(/all objects|current state of/i);
  });

  it("names the object's latest run when ?module= pins one lineage", async () => {
    path = "/insights";
    query = "module=material_master";
    mount();
    const line = await screen.findByTestId("insight-scope");
    expect(line).toHaveAttribute("data-scope", "run");
    expect(line).toHaveTextContent("One run");
  });

  it("describes the current state on the executive summary, the same scope as Home", async () => {
    path = "/insights/exec";
    query = "";
    mount();
    const line = await screen.findByTestId("insight-scope");
    expect(line).toHaveAttribute("data-scope", "current");
    expect(screen.getByRole("combobox", { name: "Showing" })).toBeInTheDocument();
  });

  it("hides the scope pickers and the way back in presentation mode", async () => {
    path = "/insights";
    query = "run=co1&present=1";
    mount();
    const line = await screen.findByTestId("insight-scope");
    expect(line).toHaveTextContent("As of controlling_1k, 15 Oct 2026");
    expect(screen.queryByRole("combobox", { name: "Showing run" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to current state" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Present" })).toBeNull();
  });

  it.each(["/insights/trends", "/insights/rules", "/insights/readiness"])("labels %s as one run even without ?run=", async (p) => {
    path = p;
    query = "";
    mount();
    const line = await screen.findByTestId("insight-scope");
    expect(line).toHaveAttribute("data-scope", "run");
    expect(line).toHaveTextContent("One run");
    expect(line).toHaveTextContent("As of");
    // the newest run of the tenant, with every other lineage's latest run in the picker
    expect(screen.getByRole("combobox", { name: "Showing run" })).toBeInTheDocument();
    expect(line).not.toHaveTextContent(/all objects|current state/i);
  });
});
