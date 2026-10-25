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
const can = vi.fn((action: string) => action === "apply" || action === "export");
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
  can.mockImplementation((action: string) => action === "apply" || action === "export");
});

describe("CompareRunsPage", () => {
  it("renders the narrative, three stats and the changed-rule table", async () => {
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("DQS moved from 71.2 to 74.8 (+3.6) across 1 module.")).toBeInTheDocument());
    expect(screen.getByText(/^Oct 8, .* vs Oct 1, /)).toBeInTheDocument();
    expect(screen.getAllByText("74.8").length).toBeGreaterThan(0);
    expect(screen.getByText(/^DQS Oct 1, /)).toBeInTheDocument();
    const rules = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    expect(rules.findIndex((t) => t.includes("MM041"))).toBeLessThan(rules.findIndex((t) => t.includes("MM002"))); // largest regression first
  });

  it("narrows the ledger to the newly failing or the fixed rules from ?change=, under the Progress view tabs", async () => {
    searchParams.set("change", "new");
    try {
      renderWithQuery(<CompareRunsPage />);
      await waitFor(() => expect(screen.getByText("MM041")).toBeInTheDocument());
      expect(screen.queryByText("MM002")).toBeNull();
      expect(screen.getByRole("combobox", { name: "Change" })).toHaveTextContent("Newly failing");
      // A lead can step back to the Progress view, the compared run carried along.
      expect(screen.getByRole("navigation", { name: "Progress views" })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Progress" })).toHaveAttribute("href", "/insights/progress?run=v2");
      expect(screen.getAllByText("Mean of 1 object in both runs; objects in only one run are left out").length).toBe(2);
    } finally {
      searchParams.delete("change");
    }
  });

  it("lists rules failing in both runs whose records moved as worse and better, with the rule's words beside its id", async () => {
    vi.spyOn(versionsApi, "compareVersions").mockResolvedValue({
      ...cmp,
      checks: {
        ...cmp.checks,
        worse: [{ check_id: "MM010", module: "material_master", severity: "high", message: "Material has no base unit", v1_affected: 100, v2_affected: 50_000 }],
        better: [{ check_id: "MM020", module: "material_master", severity: "medium", message: null, v1_affected: 5_000, v2_affected: 4_000 }],
      },
    });
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("MM010")).toBeInTheDocument());
    const rows = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    // Ranked by the change in failing records: 100 -> 50,000 first, 5,000 -> 4,000 last.
    expect(rows.findIndex((t) => t.includes("MM010"))).toBeLessThan(rows.findIndex((t) => t.includes("MM041")));
    expect(rows.find((t) => t.includes("MM010"))).toContain("Material has no base unit");
    expect(rows.find((t) => t.includes("MM010"))).toContain("Worse");
    expect(rows.find((t) => t.includes("MM020"))).toContain("Better");
    expect(rows.findIndex((t) => t.includes("MM020"))).toBe(rows.length - 1);
  });

  it("narrows the ledger to the worse rules from ?change=worse", async () => {
    vi.spyOn(versionsApi, "compareVersions").mockResolvedValue({
      ...cmp,
      checks: { ...cmp.checks, worse: [{ check_id: "MM010", module: "material_master", severity: "high", v1_affected: 100, v2_affected: 50_000 }], better: [] },
    });
    searchParams.set("change", "worse");
    try {
      renderWithQuery(<CompareRunsPage />);
      await waitFor(() => expect(screen.getByText("MM010")).toBeInTheDocument());
      expect(screen.queryByText("MM041")).toBeNull();
      expect(screen.queryByText("MM002")).toBeNull();
      expect(screen.getByRole("combobox", { name: "Change" })).toHaveTextContent("Worse");
    } finally {
      searchParams.delete("change");
    }
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument());
    // a report page's export menu also offers Print, so the single PDF option sits in the menu
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /PDF/ }));
    await waitFor(() => expect(dl).toHaveBeenCalledWith("/api/v1/reports/compare.pdf?v2=v2&v1=v1", expect.stringMatching(/^Meridian run comparison – Oct 8 vs Oct 1 – \d{4}-\d{2}-\d{2}\.pdf$/)));
  });

  it("names the PDF without characters a file name cannot hold", async () => {
    vi.spyOn(versionsApi, "compareVersions").mockResolvedValue({ ...cmp, v1: version("v1", "Q3: ECC/PRD"), v2: version("v2", 'Run "B" <new>') });
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /PDF/ }));
    await waitFor(() => expect(dl).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/^Meridian run comparison – Run -B- -new- vs Q3- ECC-PRD – \d{4}-\d{2}-\d{2}\.pdf$/)));
  });

  it("creates a fix batch for a newly failing rule from its drawer", async () => {
    const create = vi.spyOn(remediationApi, "createBatch").mockResolvedValue({ id: "b1", name: "Regressions MM041", status: "draft", item_count: 1240 });
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("MM041")).toBeInTheDocument());
    fireEvent.click(screen.getByText("MM041"));
    fireEvent.click(await screen.findByRole("button", { name: "Create fix batch" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("Regressions MM041", { version_id: "v2", check_id: "MM041", module: "material_master" }));
  });

  it("lists the first 50 newly failing records in the drawer", async () => {
    const keys = vi.spyOn(versionsApi, "compareRecordKeys").mockResolvedValue({ record_keys: ["000000000001"] });
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("MM041")).toBeInTheDocument());
    fireEvent.click(screen.getByText("MM041"));
    expect(await screen.findByText("000000000001")).toBeInTheDocument();
    expect(keys).toHaveBeenCalledWith("MM041", { v1: "v1", v2: "v2", change: "new", limit: 50, offset: 0 });
  });

  it("hides fix batch actions without the apply permission", async () => {
    can.mockImplementation(() => false);
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText(/^Oct 8, .* vs Oct 1, /)).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText("Run not found")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Retry"));
    expect(compareVersions).toHaveBeenCalledTimes(2);
  });

  it("re-queries the comparison with the chosen module and keeps all modules as Select options", async () => {
    const multiModuleCmp: VersionComparison = {
      ...cmp,
      delta: {
        ...cmp.delta,
        accounts_payable: { dqs_change: 1, v1_score: 80, v2_score: 81, dimensions: {} },
      },
    };
    // The unfiltered call (no module param) returns both modules; a filtered call returns only
    // the requested one, mirroring what the API actually does.
    const compareVersions = vi
      .spyOn(versionsApi, "compareVersions")
      .mockImplementation((_v1, _v2, module) => Promise.resolve(module ? cmp : multiModuleCmp));
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText(/^Oct 8, .* vs Oct 1, /)).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Object" }));
    expect(await screen.findByRole("option", { name: "Material master" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Accounts payable" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Material master" }));

    await waitFor(() => expect(compareVersions).toHaveBeenCalledWith("v1", "v2", "material_master"));
    expect(screen.getByRole("combobox", { name: "Object" })).toHaveTextContent("Material master");

    // The Select's options still list every module, even though the filtered response only
    // carries material_master — proving the options come from the unfiltered query, not `cmp`.
    await user.click(screen.getByRole("combobox", { name: "Object" }));
    expect(await screen.findByRole("option", { name: "Material master" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Accounts payable" })).toBeInTheDocument();
  });

  it("creates fix batches in bulk for selected rules, reporting partial success", async () => {
    vi.spyOn(versionsApi, "compareVersions").mockResolvedValue({
      ...cmp,
      checks: {
        newly_failing: [
          { check_id: "MM041", module: "material_master", severity: "critical", v1_affected: 0, v2_affected: 1240 },
          { check_id: "MM050", module: "material_master", severity: "critical", v1_affected: 0, v2_affected: 10 },
        ],
        fixed: [],
      },
    });
    const create = vi
      .spyOn(remediationApi, "createBatch")
      .mockResolvedValueOnce({ id: "b1", name: "r1", status: "draft", item_count: 1240 })
      .mockRejectedValueOnce(new Error("failed"));
    const { toast } = await import("sonner");
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("MM041")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Select row MM041"));
    fireEvent.click(screen.getByLabelText("Select row MM050"));
    fireEvent.click(await screen.findByRole("button", { name: "Create fix batches" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Created 1 of 2 fix batches; 1 failed"));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("filters record keys in the drawer and shows filter-specific copy", async () => {
    const keys = vi.spyOn(versionsApi, "compareRecordKeys").mockResolvedValue({ record_keys: [] });
    const user = userEvent.setup();
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("MM041")).toBeInTheDocument());
    fireEvent.click(screen.getByText("MM041"));
    await waitFor(() => expect(screen.getByText("No new records")).toBeInTheDocument());
    await user.type(screen.getByLabelText("Filter record keys"), "zzz");
    await waitFor(() => expect(screen.getByText("No records match")).toBeInTheDocument());
    expect(keys).toHaveBeenCalledWith("MM041", expect.objectContaining({ search: "zzz", offset: 0 }));
  });

  it("shows a loading skeleton while the comparison loads", async () => {
    vi.spyOn(versionsApi, "compareVersions").mockReturnValue(new Promise(() => {}));
    const { container } = renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
  });
});
