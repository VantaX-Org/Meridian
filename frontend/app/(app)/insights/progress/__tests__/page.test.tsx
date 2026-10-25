// frontend/app/(app)/insights/progress/__tests__/page.test.tsx
import { AxiosError, AxiosHeaders } from "axios";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as findingsApi from "@/lib/api/findings";
import * as versionsApi from "@/lib/api/versions";
import type { Version } from "@/types/api";
import ProgressPage from "../page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/insights/progress",
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams("run=bp2"),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null }),
  DayOneAction: () => null,
}));

const upload = (id: string, label: string, at: string, modules: string[]): Version => ({
  id, label, status: "complete", run_at: at, dqs_summary: null, metadata: { modules, file_name: "f.csv", row_count: 1 },
});
// Two uploads of business partners, one of controlling: the controlling run is another object, never a baseline.
const RUNS = [
  upload("bp2", "business_partner_100k", "2026-10-16T05:00:00Z", ["business_partner"]),
  upload("co1", "controlling_1k", "2026-10-15T05:00:00Z", ["controlling"]),
  upload("bp1", "business_partner_1k", "2026-10-02T05:00:00Z", ["business_partner"]),
];

function noBaseline() {
  return new AxiosError("not found", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 404, data: { detail: { reason: "no_baseline", message: "No earlier run of this system" } }, statusText: "", headers: {}, config: { headers: new AxiosHeaders() },
  });
}

function mount(versions: Version[] = RUNS) {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions });
  vi.spyOn(findingsApi, "getScoreHistory").mockResolvedValue({ history: [], modules: {} });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProgressPage /></QueryClientProvider>);
}

afterEach(() => { vi.restoreAllMocks(); replace.mockClear(); });

describe("ProgressPage", () => {
  it("asks the API for the comparison without v1 and shows the empty state on no_baseline, not an error", async () => {
    const compare = vi.spyOn(versionsApi, "compareVersions").mockRejectedValue(noBaseline());
    vi.spyOn(versionsApi, "compareRecords").mockRejectedValue(noBaseline());
    mount();
    expect(await screen.findByText("Nothing to compare yet")).toBeInTheDocument();
    expect(screen.getByText(/first finished run of its system/)).toBeInTheDocument();
    expect(compare).toHaveBeenCalledWith(undefined, "bp2", undefined);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    expect(screen.queryByText(/could not reach the server/i)).toBeNull();
  });

  it("lists only runs of the same lineage under Compare with", async () => {
    vi.spyOn(versionsApi, "compareVersions").mockResolvedValue({
      v1: { id: "bp1", label: "business_partner_1k", run_at: "2026-10-02T05:00:00Z", dqs_summary: null },
      v2: { id: "bp2", label: "business_partner_100k", run_at: "2026-10-16T05:00:00Z", dqs_summary: null },
      delta: {}, checks: { newly_failing: [], fixed: [], persisting: [] },
    } as never);
    vi.spyOn(versionsApi, "compareRecords").mockResolvedValue({ v1: "bp1", v2: "bp2", totals: { new: 0, resolved: 0, persisting: 0 }, checks: [] });
    mount();
    const select = await screen.findByRole("combobox", { name: "Compare with" });
    fireEvent.click(select);
    expect(await screen.findByRole("option", { name: "business_partner_1k" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "controlling_1k" })).toBeNull();
    expect(screen.queryByRole("option", { name: "business_partner_100k" })).toBeNull();
  });

  it("lists only comparable rules under Rules that moved and says how many were not in both runs", async () => {
    vi.spyOn(versionsApi, "compareVersions").mockResolvedValue({
      v1: { id: "bp1", label: "business_partner_1k", run_at: "2026-10-02T05:00:00Z", dqs_summary: null },
      v2: { id: "bp2", label: "business_partner_100k", run_at: "2026-10-16T05:00:00Z", dqs_summary: null },
      delta: {}, checks: { newly_failing: [], fixed: [], persisting: [] },
    } as never);
    vi.spyOn(versionsApi, "compareRecords").mockResolvedValue({
      v1: "bp1", v2: "bp2", totals: { new: 5, resolved: 1, persisting: 9 },
      checks: [
        { check_id: "BP002", module: "business_partner", severity: "high", new: 5, resolved: 0, persisting: 9, comparable: true },
        { check_id: "BP019", module: "business_partner", severity: "high", new: 0, resolved: 1, persisting: 0, comparable: false },
      ],
    });
    mount();
    expect(await screen.findByText("BP002")).toBeInTheDocument();
    expect(screen.queryByText("BP019")).toBeNull();
    expect(screen.getByText(/1 rule was not evaluated in both runs and is left out/)).toBeInTheDocument();
    expect(screen.getByText(/1 record fixed, 5 new failures, 9 still failing; 1 rule not in both runs/)).toBeInTheDocument();
  });

  it("knows a run older than the run list: labels, lineage and Compare with never fall back to the previous run", async () => {
    const summary = { business_partner: { composite_score: 70 } };
    vi.spyOn(versionsApi, "compareVersions").mockResolvedValue({
      v1: { id: "bp1a", label: "business_partner_1k", run_at: "2026-10-02T05:17:01Z", dqs_summary: summary },
      v2: { id: "bp2", label: "business_partner_100k", run_at: "2026-10-16T05:00:00Z", dqs_summary: summary },
      delta: { business_partner: { v1_score: 70, v2_score: 70, dqs_change: 0 } }, checks: { newly_failing: [], fixed: [], persisting: [] },
    } as never);
    vi.spyOn(versionsApi, "compareRecords").mockResolvedValue({ v1: "bp1a", v2: "bp2", totals: { new: 0, resolved: 10521, persisting: 0 }, checks: [] });
    // bp2 is not in the newest runs the list holds: it is read by id.
    const getVersion = vi.spyOn(versionsApi, "getVersion").mockResolvedValue(upload("bp2", "business_partner_100k", "2026-10-16T05:00:00Z", ["business_partner"]));
    mount([
      upload("co1", "controlling_1k", "2026-10-17T05:00:00Z", ["controlling"]),
      upload("bp1b", "business_partner_1k", "2026-10-02T05:17:02Z", ["business_partner"]),
      upload("bp1a", "business_partner_1k", "2026-10-02T05:17:01Z", ["business_partner"]),
    ]);
    // The header names the run shown (picked from its lineage) and what it is compared with.
    expect(await screen.findByText(/^compared with business_partner_1k, /)).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "Showing run" })).toHaveTextContent("business_partner_100k, 16 Oct 2026");
    expect(screen.getByRole("link", { name: "Back to latest" })).toHaveAttribute("href", "/insights/progress");
    expect(getVersion).toHaveBeenCalledWith("bp2");
    expect(screen.queryByText(/the previous run/)).toBeNull();
    expect(await screen.findByText(/^DQS unchanged since business_partner_1k, /)).toBeInTheDocument();
    expect(screen.getByText("Unchanged since baseline")).toBeInTheDocument();
    // Hero numbers carry thousands separators, as the sentences do.
    expect(screen.getByLabelText("10,521")).toBeInTheDocument();
    expect(screen.getByText("1 object")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("combobox", { name: "Compare with" }));
    expect(await screen.findByRole("option", { name: "business_partner_1k, 2 Oct 2026, 05:17:01" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "business_partner_1k, 2 Oct 2026, 05:17:02" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /controlling_1k/ })).toBeNull();
  });

  it("shows a real error with Retry when the comparison fails for another reason", async () => {
    vi.spyOn(versionsApi, "compareVersions").mockRejectedValue(new Error("network error"));
    vi.spyOn(versionsApi, "compareRecords").mockRejectedValue(new Error("network error"));
    mount();
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText("Nothing to compare yet")).toBeNull();
  });
});
