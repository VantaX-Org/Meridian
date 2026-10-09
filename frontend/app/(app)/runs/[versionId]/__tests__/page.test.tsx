// frontend/app/(app)/runs/[versionId]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as runsApi from "@/lib/api/v1/runs";
import * as versionsApi from "@/lib/api/versions";
import type { Version } from "@/types/api";
import RunDetailPage from "../page";

vi.mock("next/navigation", () => ({ useParams: () => ({ versionId: "v2" }) }));

const can = vi.fn((action: string) => action === "analyse");
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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(runsApi, "getRunSteps").mockResolvedValue({ version_id: "v2", steps: [] });
});

describe("RunDetailPage", () => {
  it("renders the decisive error of a failed step", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(version({ id: "v2", label: "Oct 8", status: "failed" }));
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(runsApi, "getRunSteps").mockResolvedValue({
      version_id: "v2",
      steps: [{ step_number: 4, step_name: "Generating AI insights", status: "failed", started_at: "t0", finished_at: "t1", duration_ms: 1200, error_detail: "LLM provider timed out after 120s" }],
    });
    renderWithQuery(<RunDetailPage />);
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
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByText("Couldn't load this run. Version not found")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Retry"));
    expect(getVersion).toHaveBeenCalledTimes(2);
  });
});
