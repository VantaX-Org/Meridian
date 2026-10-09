// frontend/app/(app)/runs/[versionId]/vs/[b]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as downloadApi from "@/lib/api/download";
import * as remediationApi from "@/lib/api/remediation";
import * as versionsApi from "@/lib/api/versions";
import type { RecordDiff } from "@/lib/api/versions";
import type { VersionComparison } from "@/types/api";
import CompareRunsPage from "../page";

let params = { versionId: "v2", b: "v1" };
const push = vi.fn();
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useParams: () => params,
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/runs/v2/vs/v1",
  useSearchParams: () => searchParams,
}));
const can = vi.fn((action: string) => action === "apply");
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ role: "steward", can, isAdmin: false, isManager: true, isViewer: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const version = (id: string, label: string) => ({ id, label, status: "complete" as const, run_at: "2026-10-08T00:00:00Z", dqs_summary: null, metadata: null });

const cmp: VersionComparison = {
  v1: version("v1", "Oct 1"),
  v2: version("v2", "Oct 8"),
  delta: {
    material_master: { dqs_change: 3.6, v1_score: 71.2, v2_score: 74.8, dimensions: { validity: { v1: 60, v2: 69, change: 9 } } },
  },
  checks: {
    newly_failing: [{ check_id: "MM041", module: "material_master", severity: "critical", v1_affected: 0, v2_affected: 1240 }],
    fixed: [{ check_id: "MM002", module: "material_master", severity: "low", v1_affected: 7, v2_affected: 0 }],
  },
};

const diff: RecordDiff = {
  v1: "v1",
  v2: "v2",
  totals: { new: 1240, resolved: 7, persisting: 20 },
  checks: [{ check_id: "MM041", module: "material_master", severity: "critical", new: 1240, resolved: 0, persisting: 20, comparable: true }],
};

beforeEach(() => {
  vi.restoreAllMocks();
  params = { versionId: "v2", b: "v1" };
  vi.spyOn(versionsApi, "compareVersions").mockResolvedValue(cmp);
  vi.spyOn(versionsApi, "compareRecords").mockResolvedValue(diff);
  vi.spyOn(versionsApi, "compareRecordKeys").mockResolvedValue({ record_keys: [] });
  can.mockImplementation((action: string) => action === "apply");
});

describe("CompareRunsPage", () => {
  it("renders the narrative, module card and record diff table", async () => {
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("DQS moved from 71.2 to 74.8 (+3.6) across 1 module.")).toBeInTheDocument());
    expect(screen.getByText("Oct 8 vs Oct 1")).toBeInTheDocument();
    expect(screen.getByText("74.8")).toBeInTheDocument();
    expect(screen.getAllByText("MM041").length).toBeGreaterThan(0);
    expect(screen.getByText("MM002")).toBeInTheDocument();
  });

  it("asks the API to resolve the baseline when b is the literal", async () => {
    params = { versionId: "v2", b: "baseline" };
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(versionsApi.compareVersions).toHaveBeenCalledWith(undefined, "v2", undefined));
    expect(versionsApi.compareRecords).toHaveBeenCalledWith("v2", undefined, undefined);
    await waitFor(() => expect(screen.getByText("Baseline")).toBeInTheDocument());
  });

  it("downloads the comparison PDF", async () => {
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Download PDF" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(dl).toHaveBeenCalledWith("/api/v1/reports/compare.pdf?v2=v2&v1=v1", "comparison.pdf");
  });

  it("creates a fix batch for a newly failing check", async () => {
    const create = vi.spyOn(remediationApi, "createBatch").mockResolvedValue({ id: "b1", name: "Regressions MM041 Oct 8", status: "draft", item_count: 1240 });
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create fix batch" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create fix batch" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("Regressions MM041 Oct 8", { version_id: "v2", check_id: "MM041", module: "material_master" }));
  });

  it("hides fix batch actions without the apply permission", async () => {
    can.mockImplementation(() => false);
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 vs Oct 1")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Create fix batch/ })).toBeNull();
  });

  it("shows an empty state when there is nothing to compare", async () => {
    vi.spyOn(versionsApi, "compareVersions").mockResolvedValue({ ...cmp, delta: {}, checks: { newly_failing: [], fixed: [] } });
    vi.spyOn(versionsApi, "compareRecords").mockResolvedValue({ ...diff, totals: { new: 0, resolved: 0, persisting: 0 }, checks: [] });
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText(/no differences/i)).toBeInTheDocument());
  });

  it("shows an error state with Try again when the comparison fails to load", async () => {
    const error = { response: { data: { detail: "Run not found" } } };
    const compareVersions = vi.spyOn(versionsApi, "compareVersions").mockRejectedValue(error);
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("Couldn't compare these runs. Run not found")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Retry"));
    expect(compareVersions).toHaveBeenCalledTimes(2);
  });

  it("re-queries the comparison with the chosen module and keeps all modules as Select options", async () => {
    const compareVersions = vi.spyOn(versionsApi, "compareVersions").mockResolvedValue(cmp);
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 vs Oct 1")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Module" }));
    const option = await screen.findByRole("option", { name: "Material Master" });
    await user.click(option);
    await waitFor(() => expect(compareVersions).toHaveBeenCalledWith("v1", "v2", "material_master"));
    expect(screen.getByRole("combobox", { name: "Module" })).toHaveTextContent("Material Master");
  });

  it("creates fix batches in bulk, reporting partial success", async () => {
    const twoChecks: VersionComparison = {
      ...cmp,
      checks: {
        newly_failing: [
          { check_id: "MM041", module: "material_master", severity: "critical", v1_affected: 0, v2_affected: 1240 },
          { check_id: "MM050", module: "material_master", severity: "critical", v1_affected: 0, v2_affected: 10 },
        ],
        fixed: [],
      },
    };
    vi.spyOn(versionsApi, "compareVersions").mockResolvedValue(twoChecks);
    const create = vi
      .spyOn(remediationApi, "createBatch")
      .mockResolvedValueOnce({ id: "b1", name: "r1", status: "draft", item_count: 1240 })
      .mockRejectedValueOnce(new Error("failed"));
    const { toast } = await import("sonner");
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create fix batches" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create fix batches" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Created 1 of 2 fix batches"));
    expect(toast.error).toHaveBeenCalledWith("1 fix batch failed to create");
  });
});
