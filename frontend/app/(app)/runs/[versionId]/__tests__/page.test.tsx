// frontend/app/(app)/runs/[versionId]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as analyticsApi from "@/lib/api/analytics";
import * as downloadApi from "@/lib/api/download";
import * as findingsApi from "@/lib/api/findings";
import { getAnalysisReportUrl, getReportDownloadUrl } from "@/lib/api/reports";
import * as objectsApi from "@/lib/api/v1/objects";
import * as runsApi from "@/lib/api/v1/runs";
import * as versionsApi from "@/lib/api/versions";
import * as systemObjectsApi from "@/lib/api/system-objects";
import { toast } from "sonner";
import type { Version } from "@/types/api";
import RunDetailPage from "../page";

let searchParams = new URLSearchParams();
const push = vi.fn((href: string) => {
  const q = href.split("?")[1] ?? "";
  searchParams = new URLSearchParams(q);
});
vi.mock("next/navigation", () => ({
  useParams: () => ({ versionId: "v2" }),
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const can = vi.fn((action: string) => action === "analyse" || action === "export");
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ role: "analyst", can, isAdmin: false, isManager: false, isViewer: false }) }));

function version(over: Partial<Version> & { id: string }): Version {
  return {
    label: null, status: "complete", run_at: "2026-10-08T00:00:00Z", dqs_summary: null,
    metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 1, system_id: "sys-1" },
    ...over,
  };
}

const current = version({ id: "v2", label: "Oct 8" });
const previous = version({ id: "v1", label: "Oct 1", run_at: "2026-10-01T00:00:00Z" });
const baseline = version({ id: "v0", label: "Go-live baseline", run_at: "2026-09-01T00:00:00Z", metadata: { modules: [], file_name: "f.csv", row_count: 1, system_id: "sys-1", baseline: true } });

const EMPTY_AGGREGATE: findingsApi.FindingsAggregate = {
  version_ids: ["v2"],
  total: 0,
  affected_records: 0,
  severity: { critical: 0, high: 0, medium: 0, low: 0 },
  by_module: [],
  by_dimension: [],
  avg_pass_rate: null,
  dqs: { composite: null, dimension_scores: {}, modules: {} },
  previous_dqs: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  searchParams = new URLSearchParams();
  push.mockClear();
  vi.spyOn(runsApi, "getRunSteps").mockResolvedValue({ version_id: "v2", steps: [] });
  vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue(EMPTY_AGGREGATE);
  vi.spyOn(findingsApi, "getScoreHistory").mockResolvedValue({ history: [], modules: {} });
  vi.spyOn(findingsApi, "getFindings").mockResolvedValue({ findings: [], total: 0, filters_applied: {} });
  vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v2", objects: [] });
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
});

describe("RunDetailPage", () => {
  describe("next actions slot", () => {
    const withFindings = () => {
      vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
      vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue({ ...EMPTY_AGGREGATE, total: 1 });
    };

    it("is reserved while the query loads", async () => {
      withFindings();
      vi.spyOn(analyticsApi, "getPrescriptiveAnalytics").mockReturnValue(new Promise(() => {}));
      renderWithQuery(<RunDetailPage />);
      const slot = await screen.findByTestId("next-actions-slot");
      expect(slot).toHaveClass("[min-height:124px]");
    });

    it("shows a muted line when there are no actions", async () => {
      withFindings();
      vi.spyOn(analyticsApi, "getPrescriptiveAnalytics").mockResolvedValue({
        actions: [], sprints: [], basis: { version_id: "v2", findings: 0, cleaning_items: 0, exceptions: 0 },
      } as unknown as Awaited<ReturnType<typeof analyticsApi.getPrescriptiveAnalytics>>);
      renderWithQuery(<RunDetailPage />);
      expect(await screen.findByText("No next actions for this run")).toBeInTheDocument();
      expect(screen.getByTestId("next-actions-slot")).toBeInTheDocument();
    });
  });

  it("renders the decisive error of a failed step", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(version({ id: "v2", label: "Oct 8", status: "failed" }));
    vi.spyOn(runsApi, "getRunSteps").mockResolvedValue({
      version_id: "v2",
      steps: [{ step_number: 4, step_name: "Generating AI insights", status: "failed", started_at: "t0", finished_at: "t1", duration_ms: 1200, error_detail: "LLM provider timed out after 120s" }],
    });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Steps" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Steps" }));
    await waitFor(() => expect(screen.getByText("LLM provider timed out after 120s")).toBeInTheDocument());
  });

  it("links to the previous run and the baseline", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [current, previous, baseline] });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Compare with previous" })).toHaveAttribute("href", "/runs/v2/vs/v1"));
    expect(screen.getByRole("link", { name: "Compare with baseline" })).toHaveAttribute("href", "/runs/v2/vs/baseline");
  });

  it("hides compare links when there is nothing to compare with", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [current] });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByText("Oct 8")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /Compare with/ })).toBeNull();
  });

  it("pins the run as baseline and shows the pill", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [current] });
    const pin = vi.spyOn(versionsApi, "pinBaseline").mockResolvedValue({ baseline: true });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pin as baseline" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Pin as baseline" }));
    await waitFor(() => expect(pin).toHaveBeenCalledWith("v2", true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Pinned as baseline"));
  });

  it("unpins the baseline and confirms with the matching toast", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(baseline);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [baseline] });
    const pin = vi.spyOn(versionsApi, "pinBaseline").mockResolvedValue({ baseline: false });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Unpin baseline" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Unpin baseline" }));
    await waitFor(() => expect(pin).toHaveBeenCalledWith("v2", false));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Baseline unpinned"));
  });

  it("renames the run from the header and shows the new name", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    const patch = vi.spyOn(versionsApi, "patchVersionLabel").mockResolvedValue({ ...current, label: "Go-live baseline" });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const input = await screen.findByLabelText("Name");
    fireEvent.change(input, { target: { value: "Go-live baseline" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("v2", "Go-live baseline"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Go-live baseline" })).toBeInTheDocument());
  });

  it("re-runs analysis on the stored data from the header", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    const analyse = vi.spyOn(systemObjectsApi, "analyseVersion").mockResolvedValue({ status: "pending" });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Re-run analysis" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Re-run analysis" }));
    await waitFor(() => expect(analyse).toHaveBeenCalledWith("v2"));
  });

  it("shows the Baseline pill and the unpin action for a pinned run", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(baseline);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [baseline] });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByText("Baseline")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Unpin baseline" })).toBeInTheDocument();
  });

  it("shows an error state with Try again when the run fails to load", async () => {
    const error = { response: { data: { detail: "Version not found" } } };
    const getVersion = vi.spyOn(versionsApi, "getVersion").mockRejectedValue(error);
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByText("Version not found")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Retry"));
    expect(getVersion).toHaveBeenCalledTimes(2);
  });

  it("shows the no-findings empty state on the findings tab", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Findings" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Findings" }));
    await waitFor(() => expect(screen.getByText("No findings in this run")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open steps" })).toBeInTheDocument();
  });

  it("lists objects on the objects tab and navigates to the object page on row click", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v2",
      objects: [{ module: "material_master", label: "Material master", composite_score: 91.2, readiness: "pass", failing_checks: 2, affected_records: 10 }],
    });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Objects" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Objects" }));
    await waitFor(() => expect(screen.getByText("Material Master")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Material Master" })).toHaveAttribute("href", "/objects/material_master?run=v2");
  });

  it("renders a sparkline trend column on the objects tab from the per-module score history", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    vi.spyOn(objectsApi, "getObjects").mockResolvedValue({
      run_id: "v2",
      objects: [{ module: "material_master", label: "Material master", composite_score: 91.2, readiness: "pass", failing_checks: 2, affected_records: 10 }],
    });
    vi.spyOn(findingsApi, "getScoreHistory").mockResolvedValue({
      history: [],
      modules: {
        material_master: [
          { version_id: "v0", composite: 80 },
          { version_id: "v1", composite: 85 },
          { version_id: "v2", composite: 91.2 },
        ],
      },
    });
    renderWithQuery(<RunDetailPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Objects" }));
    await waitFor(() => expect(screen.getByText("Material Master")).toBeInTheDocument());
    expect(screen.getByRole("columnheader", { name: "Trend" })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".recharts-wrapper")).toBeInTheDocument());
  });

  it("prints the finding count in every heatmap cell with the severity as its tone", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue({
      ...EMPTY_AGGREGATE, total: 7,
      by_module: [{ module: "material_master", findings: 7, critical: 2, high: 0, medium: 5, low: 0, affected_records: 9 }] as never,
    });
    renderWithQuery(<RunDetailPage />);
    const critical = await screen.findByLabelText("Material Master Critical: 2, no go");
    expect(critical).toHaveTextContent("2");
    expect(screen.getByLabelText("Material Master High: 0, go")).toHaveTextContent("0");
    expect(screen.getByLabelText("Material Master Medium: 5, at risk")).toHaveTextContent("5");
  });

  it("draws the composite line for an upload from the scored runs of the same objects, keyed by run id", async () => {
    const dqs = (composite_score: number) => ({
      composite_score, dimension_scores: { completeness: 0, accuracy: 0, consistency: 0, timeliness: 0, uniqueness: 0, validity: 0 },
      critical_count: 0, high_count: 0, medium_count: 0, low_count: 0, total_checks: 1, passing_checks: 1, capped: false, cap_reason: null,
    });
    const up = (id: string, run_at: string, score: number) => version({ id, run_at, dqs_summary: { material_master: dqs(score) }, metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 1 } });
    const other = version({ id: "co", run_at: "2026-10-05T00:00:00Z", dqs_summary: { controlling: dqs(95) }, metadata: { modules: ["controlling"], file_name: "g.csv", row_count: 1 } });
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(up("v2", "2026-10-08T00:00:00Z", 80));
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [up("v2", "2026-10-08T00:00:00Z", 80), other, up("v1", "2026-10-01T00:00:00Z", 70)] });
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue({ ...EMPTY_AGGREGATE, total: 1 });
    renderWithQuery(<RunDetailPage />);
    // Two runs of the same objects make a line; the controlling upload is not on it, and the ticks are dates.
    expect(await screen.findByRole("img", { name: "Composite over runs: 1 Oct 2026 70, 8 Oct 2026 80" })).toBeInTheDocument();
    expect(screen.queryByText("Only one run so far")).toBeNull();
  });

  it("draws the composite line from runs whose agents finished or failed, not only status complete", async () => {
    const dqs = (composite_score: number) => ({
      composite_score, dimension_scores: { completeness: 0, accuracy: 0, consistency: 0, timeliness: 0, uniqueness: 0, validity: 0 },
      critical_count: 0, high_count: 0, medium_count: 0, low_count: 0, total_checks: 1, passing_checks: 1, capped: false, cap_reason: null,
    });
    const up = (id: string, run_at: string, score: number, status: Version["status"]) => version({ id, run_at, status, dqs_summary: { controlling: dqs(score) }, metadata: { modules: ["controlling"], file_name: "f.csv", row_count: 1 } });
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(up("v2", "2026-10-08T00:00:00Z", 80, "agents_complete"));
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [up("v2", "2026-10-08T00:00:00Z", 80, "agents_complete"), up("v1", "2026-10-01T00:00:00Z", 70, "agents_failed")] });
    vi.spyOn(findingsApi, "getFindingsAggregate").mockResolvedValue({ ...EMPTY_AGGREGATE, total: 1 });
    renderWithQuery(<RunDetailPage />);
    expect(await screen.findByRole("img", { name: "Composite over runs: 1 Oct 2026 70, 8 Oct 2026 80" })).toBeInTheDocument();
    expect(screen.queryByText("Only one run so far")).toBeNull();
  });

  it("downloads the narrative report from the Narrative report (PDF) export option, distinct from the Analysis report URL", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(version({ id: "v2", label: "Oct 8", status: "ai_enriched" }));
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue(undefined);
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Export" }).length).toBeGreaterThan(0));
    // The header's ExportMenu renders first in the DOM, ahead of the per-tab single-option export buttons.
    fireEvent.click(screen.getAllByRole("button", { name: "Export" })[0]);
    const narrativeItem = await screen.findByRole("menuitem", { name: "Narrative report (PDF)" });
    fireEvent.click(narrativeItem);
    await waitFor(() => expect(dl).toHaveBeenCalled());
    const narrativeUrl = dl.mock.calls[0][0];
    expect(narrativeUrl).toBe(getReportDownloadUrl("v2"));
    expect(narrativeUrl).not.toBe(getAnalysisReportUrl("v2"));
  });

  it("lists findings on the findings tab", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    vi.spyOn(findingsApi, "getFindings").mockResolvedValue({
      findings: [{
        id: "f1", version_id: "v2", module: "material_master", check_id: "mm_missing_desc", severity: "high", dimension: "completeness",
        affected_count: 5, total_count: 50, pass_rate: 0.9, details: {}, remediation_text: "", rule_context: null,
        value_fix_map: null, record_fixes: null, created_at: "2026-01-01T00:00:00Z",
      }],
      total: 1,
      filters_applied: {},
    });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Findings" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("tab", { name: "Findings" }));
    await waitFor(() => expect(screen.getByText("mm_missing_desc")).toBeInTheDocument());
  });

  it("shows a loading skeleton while the run loads", async () => {
    vi.spyOn(versionsApi, "getVersion").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(screen.queryByText(/^Run…$/)).toBeNull();
  });

  it("starts steps, aggregate and findings before the version resolves", async () => {
    vi.spyOn(versionsApi, "getVersion").mockReturnValue(new Promise(() => {}));
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(runsApi.getRunSteps).toHaveBeenCalled());
    expect(findingsApi.getFindingsAggregate).toHaveBeenCalled();
  });
});
