// frontend/app/(app)/runs/[versionId]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as findingsApi from "@/lib/api/findings";
import * as objectsApi from "@/lib/api/v1/objects";
import * as runsApi from "@/lib/api/v1/runs";
import * as versionsApi from "@/lib/api/versions";
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
  vi.spyOn(findingsApi, "getScoreHistory").mockResolvedValue({ history: [] });
  vi.spyOn(findingsApi, "getFindings").mockResolvedValue({ findings: [], total: 0, filters_applied: {} });
  vi.spyOn(objectsApi, "getObjects").mockResolvedValue({ run_id: "v2", objects: [] });
  vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
});

describe("RunDetailPage", () => {
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

  it("shows the no-findings empty state on the summary tab", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    renderWithQuery(<RunDetailPage />);
    await waitFor(() =>
      expect(screen.getByText("No findings were produced for this run. Open the steps tab to see what ran.")).toBeInTheDocument(),
    );
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
    fireEvent.click(screen.getByText("Material Master"));
    expect(push).toHaveBeenCalledWith("/objects/material_master?run=v2");
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
});
