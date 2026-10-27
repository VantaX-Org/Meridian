// frontend/app/(app)/insights/progress/__tests__/page.test.tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as versionsApi from "@/lib/api/versions";
import * as wa from "@/lib/api/work-analytics";
import type { Burndown } from "@/lib/api/work-analytics";
import type { Version } from "@/types/api";
import ProgressPage from "../page";

const nav = vi.hoisted(() => ({ qs: "run=bp2" }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/insights/progress",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.qs),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/hooks/use-day-one", () => ({
  useDayOne: () => ({ status: "ready", step: null, error: null, refetch: () => {} }),
  DayOneAction: () => null,
}));

const upload = (id: string, label: string, at: string): Version => ({
  id, label, status: "complete", run_at: at, dqs_summary: null, metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 1 },
});
const RUNS = [upload("bp2", "material_master_100k", "2026-10-16T05:00:00Z"), upload("bp1", "material_master_1k", "2026-10-02T05:00:00Z")];

const days = (open: (i: number) => number) => Array.from({ length: 90 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 6, 28 + i));
  return { day: d.toISOString().slice(0, 10), open: open(i), opened: 0, closed: 0 };
});

const BURN: Burndown = {
  version_id: "bp2", today: "2026-10-25", days: days((i) => 200 - i * 2), open_now: 22, open_records: 9, fixed_7d: 14,
  pace_per_day: 2, pace_window_days: 28, projected_finish: "2026-11-05",
  runs: [{ version_id: "bp1", label: "material_master_1k", run_at: "2026-10-02T05:00:00Z", issues: 40, open_records: null },
    { version_id: "bp2", label: "material_master_100k", run_at: "2026-10-16T05:00:00Z", issues: 22, open_records: 9 }],
};

function mockAll(over: Partial<{ burn: Burndown | Error; previous: boolean; throughput: Error; assignee: boolean }> = {}) {
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: RUNS });
  const burn = over.burn ?? BURN;
  const burndown = vi.spyOn(wa, "getBurndown");
  if (burn instanceof Error) burndown.mockRejectedValue(burn);
  else burndown.mockResolvedValue(burn);
  vi.spyOn(wa, "getTimeToFix").mockResolvedValue({
    window_days: 180, overall: { fixed: 3, median_days: 9, p90_days: 24.2 },
    by_object: [{ module: "fi_gl", fixed: 1, median_days: 28, p90_days: 28 }, { module: "material_master", fixed: 2, median_days: 7.5, p90_days: 8.7 }],
    by_check: [{ check_id: "GL002", module: "fi_gl", fixed: 1, median_days: 28, p90_days: 28 }],
    by_severity: [{ severity: "critical", fixed: 2, median_days: 7.5, p90_days: 8.7 }],
  });
  const thr = vi.spyOn(wa, "getThroughput");
  if (over.throughput) thr.mockRejectedValue(over.throughput);
  else thr.mockResolvedValue({
    window_days: 30, days: [], totals: { accept: 2, edit: 1, not_an_issue: 1, accept_risk: 0, approve: 1, total: 5 },
    people: [{ person: "Ann", total: 3, accept: 1, edit: 1, not_an_issue: 1, accept_risk: 0, approve: 0 }],
    workload: [
      { assignee_id: null, name: null, email: null, open: 3, critical: 1, overdue: 0 },
      ...(over.assignee ? [{ assignee_id: "u-7", name: "Bea", email: null, open: 4, critical: 2, overdue: 1 }] : []),
    ],
  });
  vi.spyOn(wa, "getRecurrence").mockResolvedValue({
    totals: { issues: 8, reopened: 2, reopens: 3, rate_pct: 25 },
    by_check: [{ check_id: "MM001", module: "material_master", issues: 4, reopened: 1, reopens: 1, rate_pct: 25 }],
    by_system: [{ scope: "upload", name: "Uploads", issues: 1, reopened: 1, reopens: 2, rate_pct: 100 }],
  });
  vi.spyOn(wa, "getRootCauses").mockResolvedValue({
    version_id: "bp2", source: "work_records", total_records: 3,
    dimensions: [{ field: "WERKS", label: "Plant", records: 2, values: 2, top: [{ value: "1000", records: 1, issues: 2, open: 1, critical: 1, share_pct: 33.3 }] }],
  });
  vi.spyOn(wa, "getProposalQuality").mockResolvedValue({
    sources: [{ source: "rule", proposed: 2, approved: 1, exported: 1, fixed: 1, still_failing: 0, approval_rate_pct: 50, fix_rate_pct: 100 }],
    totals: { proposed: 2, approved: 1, exported: 1, fixed: 1, still_failing: 0 },
  });
  const change = vi.spyOn(wa, "getRunChange").mockResolvedValue(over.previous === false
    ? { version_id: "bp2", previous: null, objects: [], totals: { new: 0, fixed: 0, still_failing: 0 }, not_comparable_checks: 0 }
    : {
      version_id: "bp2", previous: { version_id: "bp1", label: "material_master_1k", run_at: "2026-10-02T05:00:00Z" },
      objects: [{ module: "material_master", new: 1, fixed: 2, still_failing: 1, not_comparable_checks: 2 }],
      totals: { new: 1, fixed: 2, still_failing: 1 }, not_comparable_checks: 2,
    });
  return { burndown, change };
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ProgressPage /></QueryClientProvider>);
}

afterEach(() => { nav.qs = "run=bp2"; vi.restoreAllMocks(); });

describe("ProgressPage without ?run=: the current state", () => {
  it("reads every object at its own latest run, drills into Fix work in the same scope and pins no baseline", async () => {
    nav.qs = "";
    const { burndown, change } = mockAll({ assignee: true });
    change.mockResolvedValue({
      version_id: null, previous: null,
      compared: [{ version_id: "bp2", previous: { version_id: "bp1", label: "material_master_1k", run_at: "2026-10-02T05:00:00Z" } }],
      objects: [{ module: "material_master", new: 1, fixed: 2, still_failing: 1, not_comparable_checks: 0 }],
      totals: { new: 1, fixed: 2, still_failing: 1 }, not_comparable_checks: 0,
    });
    burndown.mockResolvedValue({ ...BURN, version_id: null, runs: [] });
    mount();
    expect(await screen.findByText("Records to fix")).toBeInTheDocument();
    expect(burndown).toHaveBeenCalledWith({ versionId: undefined, module: undefined });
    expect(change).toHaveBeenCalledWith({ versionId: undefined, module: undefined });
    // Every drill opens Fix work on the same current state: no ?run= of the newest run.
    expect(screen.getByText("Records to fix").closest("a")?.getAttribute("href")).toBe("/fix");
    expect(screen.getByRole("link", { name: "Open the records assigned to Bea" }).getAttribute("href")).toBe("/fix?assignee=u-7");
    expect(screen.queryByTestId("baseline-line")).toBeNull();
    expect(await screen.findByText(/Each object compared with the run before its own latest run \(1 run\): 2 fixed, 1 new, 1 still failing/)).toBeInTheDocument();
  });

  it("never shows one run's figures under the current-state header, even if a run's bars come back", async () => {
    nav.qs = "";
    const { burndown } = mockAll();
    // An answer for one run (the e2e mock used to send this for scope=current): its per-run bars must not show.
    burndown.mockResolvedValue({ ...BURN, version_id: null });
    mount();
    expect(await screen.findByText("Records to fix")).toBeInTheDocument();
    expect(screen.queryByText("Rule failures in each run of this system")).toBeNull();
    expect(screen.queryByRole("img", { name: "Rule failures per run" })).toBeNull();
  });
});

describe("ProgressPage", () => {
  it("says what the page is for and shows the lead's four numbers for the scoped run", async () => {
    const { burndown, change } = mockAll();
    mount();
    expect(await screen.findByText("How fast the data is getting fixed, and what is slowing it down.")).toBeInTheDocument();
    expect(screen.getAllByText("Progress").length).toBeGreaterThan(0);
    expect(await screen.findByText("Records to fix")).toBeInTheDocument();
    expect(screen.getByText("Fixed this week")).toBeInTheDocument();
    expect(screen.getByText("Median time to fix")).toBeInTheDocument();
    expect(screen.getByText("Projected finish")).toBeInTheDocument();
    expect(screen.getAllByText("5 Nov 2026").length).toBeGreaterThan(0);
    expect(burndown).toHaveBeenCalledWith({ versionId: "bp2", module: undefined });
    expect(change).toHaveBeenCalledWith({ versionId: "bp2", module: undefined });
    expect(screen.getAllByText(/At 2 a day net, the backlog clears on 5 Nov 2026/).length).toBeGreaterThan(0);
    expect(screen.getByRole("img", { name: /Rule failures open per day/ })).toBeInTheDocument();
    expect(screen.getByText(/FI general ledger takes longest to fix: typically 28 days/)).toBeInTheDocument();
  });

  it("fills every analysis card", async () => {
    mockAll();
    mount();
    expect(await screen.findByText("Decisions by person")).toBeInTheDocument();
    // Decisions by person leads, ahead of the burn-down
    expect(screen.getByText("Decisions by person").compareDocumentPosition(screen.getByText("Burn-down")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await screen.findByText("Ann")).toBeInTheDocument();
    expect(screen.getByText("Nobody yet")).toBeInTheDocument();
    expect(await screen.findByText("GL002")).toBeInTheDocument();
    expect(screen.getByText("MM001")).toBeInTheDocument();
    expect(screen.getByText(/2 rule failures failed again after a fix: 25% of 8 tracked/)).toBeInTheDocument();
    expect(screen.getByText(/Plant: 2 failing records across 2 values/)).toBeInTheDocument();
    expect(screen.getByText("Rule suggestion")).toBeInTheDocument();
    const change = screen.getByText("Change since the previous run").closest("section, div") as HTMLElement;
    expect(within(change.parentElement ?? change).getByText(/Compared with material_master_1k: 2 fixed, 1 new, 1 still failing; 2 rules not in both runs left out/)).toBeInTheDocument();
  });

  it("says there is nothing earlier to compare with on the first run, with an action", async () => {
    mockAll({ previous: false });
    mount();
    expect(await screen.findByText("No earlier run of this system to compare with")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open runs" }).length).toBeGreaterThan(0);
  });

  it("states that there is no finish date when the backlog is not shrinking", async () => {
    mockAll({ burn: { ...BURN, pace_per_day: -0.5, projected_finish: null } });
    mount();
    expect(await screen.findByText("No date yet")).toBeInTheDocument();
    expect(screen.getAllByText(/More is opening than closing: 0.5 a day net over 28 days/).length).toBeGreaterThan(0);
  });

  it("shows the empty state for a tenant with no run and no issues", async () => {
    mockAll({ burn: { ...BURN, version_id: null, days: days(() => 0), open_now: 0, open_records: null, fixed_7d: 0, pace_per_day: 0, projected_finish: null, runs: [] } });
    mount();
    expect(await screen.findByText("Nothing to track yet")).toBeInTheDocument();
  });

  it("shows a real error with Retry when the burn-down fails", async () => {
    mockAll({ burn: new Error("network error") });
    mount();
    expect(await screen.findByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText("Nothing to track yet")).toBeNull();
  });

  it("keeps one failing card to itself with its own Retry", async () => {
    mockAll({ throughput: new Error("boom") });
    mount();
    expect(await screen.findByText(/Decisions by person did not load/)).toBeInTheDocument();
    expect(screen.getByText("GL002")).toBeInTheDocument();
  });

  it("drills every number into exactly its records in Fix work", async () => {
    mockAll({ assignee: true });
    mount();
    const link = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href");
    expect(await screen.findByText("GL002")).toBeInTheDocument();
    expect(screen.getByText("Fixed this week").closest("a")?.getAttribute("href")).toBe("/fix?run=bp2&st=fixed");
    expect(screen.getByText("Records to fix").closest("a")?.getAttribute("href")).toBe("/fix?run=bp2");
    // Fix work has no date filter: the tile says its drill opens every fixed record, and one noun is used throughout.
    expect(screen.getByText("Rule failures fixed in the last 7 days; opens all fixed records")).toBeInTheDocument();
    // lib/help/glossary.ts: the burn-down counts rule failures; records to fix are the distinct records they sit on.
    expect(screen.getAllByText(/^[\d,]+ rule failures? open on [\d,]+ records? to fix$/).length).toBeGreaterThan(0);
    expect(screen.getByText(/open rule failures? on them$/)).toBeInTheDocument();
    expect(screen.queryByText(/failing records? open/)).toBeNull();
    expect(screen.queryByText(/\d issues?\b/)).toBeNull();
    expect(screen.queryAllByRole("link", { name: /fix list|fix queue/i })).toHaveLength(0);
    expect(screen.getByText("Projected finish").closest("a")?.getAttribute("href")).toBe("#burndown");
    expect(document.getElementById("burndown")).not.toBeNull();
    expect(link("Open the open records of rule GL002 in FI general ledger")).toBe("/fix?run=bp2&module=fi_gl&check=GL002");
    expect(link("Open the fixed records of rule GL002 in FI general ledger in this run")).toBe("/fix?run=bp2&module=fi_gl&check=GL002&st=fixed");
    expect(link("Open the open records of rule MM001 in material master")).toBe("/fix?run=bp2&module=material_master&check=MM001");
    expect(link("Open the records assigned to Bea")).toBe("/fix?run=bp2&assignee=u-7");
    expect(link("Open the 2 critical records assigned to Bea")).toBe("/fix?run=bp2&sev=critical&assignee=u-7");
    expect(link("Open the 1 overdue record assigned to Bea")).toBe("/fix?run=bp2&assignee=u-7&due=overdue");
    expect(screen.queryByRole("link", { name: /assigned to this person/ })).toBeNull();
    // the unassigned row opens the records nobody has taken
    expect(screen.getAllByRole("link", { name: /assigned to nobody/ })[0].getAttribute("href")).toContain("assignee=unassigned");
    expect(link("Open the open records of WERKS 1000")).toBe("/fix?run=bp2&part=WERKS%3D1000");
    expect(link("Open the critical open records of WERKS 1000")).toBe("/fix?run=bp2&sev=critical&part=WERKS%3D1000");
    expect(link("Open the 2 fixed records of material master")).toBe("/fix?run=bp2&module=material_master&st=fixed");
    expect(link("Open approvals and export for rule suggestion values")).toBe("/fix?tab=batches");
  });

  it("names the pinned baseline and pins the shown run as baseline", async () => {
    mockAll();
    const pin = vi.spyOn(versionsApi, "pinBaseline").mockResolvedValue({ baseline: true });
    mount();
    expect(await screen.findByText("No baseline pinned")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Pin as baseline" }));
    await waitFor(() => expect(pin).toHaveBeenCalledWith("bp2", true));
  });

  it("offers Unpin on the pinned run itself", async () => {
    mockAll();
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [{ ...RUNS[0], metadata: { ...RUNS[0].metadata, baseline: true } }, RUNS[1]] });
    const pin = vi.spyOn(versionsApi, "pinBaseline").mockResolvedValue({ baseline: false });
    mount();
    expect(await screen.findByText("Baseline: material_master_100k, 16 Oct 2026")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unpin baseline" }));
    await waitFor(() => expect(pin).toHaveBeenCalledWith("bp2", false));
  });
});
