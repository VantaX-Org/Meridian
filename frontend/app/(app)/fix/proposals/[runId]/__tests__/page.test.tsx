import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import ProposalsPage from "../page";
import { approveCleaning, bulkApprove, getCleaningAudit, getCleaningGroups, getCleaningQueue, rejectCleaning, type CleaningQueueItem } from "@/lib/api/cleaning";
import { createBatchFromCleaning } from "@/lib/api/remediation";
import { getVersion } from "@/lib/api/versions";
import { AxiosError, AxiosHeaders } from "axios";

let searchParams = new URLSearchParams("kind=MARA.MEINS");
let routeRun = "R1";
vi.mock("next/navigation", () => ({ useParams: () => ({ runId: routeRun }), useSearchParams: () => searchParams, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/lib/api/cleaning", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/cleaning")>("@/lib/api/cleaning");
  return { ...actual, getCleaningQueue: vi.fn(), getCleaningGroups: vi.fn(), getCleaningAudit: vi.fn(), approveCleaning: vi.fn(), rejectCleaning: vi.fn(), bulkApprove: vi.fn(), downloadCleaningExport: vi.fn() };
});
vi.mock("@/lib/api/versions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/versions")>("@/lib/api/versions");
  return { ...actual, getVersion: vi.fn().mockResolvedValue({ id: "R1", label: "material_master_25k", run_at: "2026-10-16T05:17:00Z" }) };
});
vi.mock("@/lib/api/remediation", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/remediation")>("@/lib/api/remediation");
  return { ...actual, createBatchFromCleaning: vi.fn() };
});

const item = (over: Partial<CleaningQueueItem>): CleaningQueueItem => ({
  id: "i1", object_type: "material_master", status: "detected", confidence: 0.92,
  record_key: "100001", priority: 1, detected_at: "", applied_at: null,
  rollback_deadline: null, rule_id: null, batch_id: null, version_id: "R1",
  merge_preview: null, record_data_before: null, record_data_after: null,
  golden_record_id: null, golden_field_value: null, golden_record_exists: false,
  ...over,
});

/** The open list answers with `items`; the approved-count query (status=approved) with `approved`. */
function queue(items: CleaningQueueItem[], approved = 0) {
  vi.mocked(getCleaningQueue).mockImplementation(async (p) =>
    p.status === "approved" ? { items: [], total: approved, page: 1, per_page: 1 } : { items, total: items.length, page: 1, per_page: 100 });
}

beforeEach(() => {
  vi.mocked(getCleaningQueue).mockReset();
  vi.mocked(approveCleaning).mockReset();
  vi.mocked(getCleaningGroups).mockResolvedValue({
    groups: [{ version_id: "R1", object_type: "material_master", kind: "MARA.MEINS", rule_name: null, records: 1200, avg_confidence: 0.9, confident: 900, run_label: "material_master_25k", run_at: null }],
    records: 1200, confident: 900, runs: 1,
  });
});

describe("ProposalsPage", () => {
  it("asks the server for this run and kind, and names both", async () => {
    queue([item({})]);
    renderWithQuery(<ProposalsPage />);

    await screen.findByText("100001");
    expect(getCleaningQueue).toHaveBeenCalledWith(expect.objectContaining({ version_id: "R1", kind: "MARA.MEINS" }));
    expect(await screen.findByRole("heading", { name: "Fix MARA.MEINS" })).toBeInTheDocument();
    expect(await screen.findByText(/found by material_master_25k/)).toBeInTheDocument();
  });

  it("lists only the waiting proposals, says Waiting, and offers no decision on one already decided", async () => {
    queue([item({}), item({ id: "i2", record_key: "100002", status: "approved" })]);
    renderWithQuery(<ProposalsPage />);
    await screen.findByText("100001");
    expect(getCleaningQueue).toHaveBeenCalledWith(expect.objectContaining({ version_id: "R1", kind: "MARA.MEINS", status: "detected,recommended" }));
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("100002").closest("[role=row], tr")).toHaveTextContent("Approved");
    expect(screen.queryByText("Queued")).toBeNull();
    // One row is waiting, so one Approve and one Reject.
    expect(screen.getAllByRole("button", { name: /^approve$/i })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^reject$/i })).toHaveLength(1);
  });

  it("sends Back to the cleaning queue to the proposals tab, keeping the object and run", async () => {
    searchParams = new URLSearchParams("kind=MARA.MEINS&module=material_master&run=R1");
    queue([]);
    renderWithQuery(<ProposalsPage />);
    expect(await screen.findByText("No proposals waiting")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the cleaning queue" })).toHaveAttribute("href", "/fix?tab=cleaning&module=material_master&run=R1");
    searchParams = new URLSearchParams("kind=MARA.MEINS");
  });

  it("approves one proposal", async () => {
    queue([item({})]);
    vi.mocked(approveCleaning).mockResolvedValue({ id: "i1", status: "approved" });
    renderWithQuery(<ProposalsPage />);

    await screen.findByText("100001");
    await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(approveCleaning).toHaveBeenCalledWith("i1"));
  });

  it("accepts every waiting proposal of the run and kind at 85% or higher, not just this page", async () => {
    queue([item({})]);
    vi.mocked(bulkApprove).mockResolvedValue({ approved_count: 900, skipped_count: 0 });
    renderWithQuery(<ProposalsPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Accept 900 at 85%+ confidence" }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept 900" }));
    await waitFor(() => expect(bulkApprove).toHaveBeenCalledWith({ version_id: "R1", kind: "MARA.MEINS", min_confidence: 0.85, max_count: 5000 }));
  });

  it("drafts a fix batch from the approved proposals", async () => {
    queue([item({ status: "approved" })], 12);
    vi.mocked(createBatchFromCleaning).mockResolvedValue({ id: "b9", status: "draft", items: 12, with_proposal: 12, auto_approvable: 0 });
    renderWithQuery(<ProposalsPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Draft fix batch from 12 approved" }));
    await waitFor(() => expect(createBatchFromCleaning).toHaveBeenCalledWith("Fix MARA.MEINS from material_master_25k", { version_id: "R1", kind: "MARA.MEINS" }));
  });

  it("cannot draft a batch before anything is approved", async () => {
    queue([item({})], 0);
    renderWithQuery(<ProposalsPage />);

    expect(await screen.findByRole("button", { name: "Draft fix batch from 0 approved" })).toBeDisabled();
  });

  it("asks for a reason before rejecting, and rejects the selected rows together", async () => {
    queue([item({}), item({ id: "i2", record_key: "100002" })]);
    vi.mocked(rejectCleaning).mockResolvedValue({ id: "i1", status: "rejected" });
    renderWithQuery(<ProposalsPage />);
    await screen.findByText("100001");
    await userEvent.click(screen.getAllByRole("button", { name: /^reject$/i })[0]);
    const box = await screen.findByLabelText("Reason");
    expect(screen.getByRole("button", { name: "Reject" })).toBeDisabled();
    await userEvent.type(box, "Wrong unit");
    await userEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(rejectCleaning).toHaveBeenCalledWith("i1", "Wrong unit"));
    await userEvent.click(screen.getByLabelText("Select all rows"));
    expect(await screen.findByRole("button", { name: "Approve selected" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject selected" })).toBeInTheDocument();
  });

  it("marks the Proposal step of the fix path", async () => {
    queue([item({})]);
    renderWithQuery(<ProposalsPage />);
    const steps = await screen.findByRole("list", { name: "Fix steps" });
    expect(steps).toHaveTextContent("Proposal");
    expect(steps).toHaveTextContent("Export");
    expect(steps.querySelector("[aria-current='step']")).toHaveTextContent("Proposal");
  });

  it("renders one Export", async () => {
    queue([item({})]);
    renderWithQuery(<ProposalsPage />);

    await screen.findByText("100001");
    expect(screen.getAllByRole("button", { name: "Export" })).toHaveLength(1);
  });

  it("audit tab lists the cleaning audit rows of this run", async () => {
    queue([item({})]);
    vi.mocked(getCleaningAudit).mockResolvedValue({
      items: [{ id: "a1", action: "approved", actor_name: "Steward One", record_key: "100001", data_before: null, data_after: null, metadata: null, created_at: "2026-01-01T10:00:00Z" }],
      total: 1,
    });
    renderWithQuery(<ProposalsPage />);
    await screen.findByText("100001");
    await userEvent.click(screen.getByRole("tab", { name: "Audit" }));

    expect(await screen.findByText("Steward One")).toBeInTheDocument();
    expect(getCleaningAudit).toHaveBeenCalledWith(expect.objectContaining({ version_id: "R1" }));
  });

  it("covers every run for match pairs: no run filter, and no fix batch since nothing changes", async () => {
    routeRun = "all";
    searchParams = new URLSearchParams("kind=match");
    queue([item({ record_key: "BP1|BP1x", version_id: null })]);
    vi.mocked(bulkApprove).mockResolvedValue({ approved_count: 1, skipped_count: 0 });
    renderWithQuery(<ProposalsPage />);

    await screen.findByText("BP1|BP1x");
    expect(getCleaningQueue).toHaveBeenCalledWith(expect.objectContaining({ version_id: undefined, kind: "match" }));
    expect(screen.getByRole("heading", { name: "Match review" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Draft fix batch/ })).not.toBeInTheDocument();
    routeRun = "R1";
    searchParams = new URLSearchParams("kind=MARA.MEINS");
  });
});

describe("ProposalsPage paging and missing runs", () => {
  it("steps back a page when the proposals of the last page are all decided, never a false empty", async () => {
    let total = 101;
    vi.mocked(getCleaningQueue).mockImplementation(async (p) => {
      if (p.status === "approved") return { items: [], total: 0, page: 1, per_page: 1 };
      const pg = p.page ?? 1;
      const n = Math.max(0, Math.min(100, total - (pg - 1) * 100));
      return { items: Array.from({ length: n }, (_, i) => item({ id: `p${pg}-${i}`, record_key: `K${pg}-${i}` })), total, page: pg, per_page: 100 };
    });
    vi.mocked(approveCleaning).mockImplementation(async () => { total = 100; return { id: "p2-0", status: "approved" }; });
    renderWithQuery(<ProposalsPage />);
    await screen.findByText("K1-0");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("K2-0");
    await userEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    expect(await screen.findByText("K1-0")).toBeInTheDocument();
    expect(screen.queryByText("No proposals waiting")).toBeNull();
  });

  it("says the run was not found, with a way back, when the run was deleted", async () => {
    queue([]);
    const res = { status: 404, statusText: "Not Found", headers: {}, config: { headers: new AxiosHeaders() }, data: {} };
    vi.mocked(getVersion).mockRejectedValueOnce(new AxiosError("Not Found", "ERR_BAD_REQUEST", res.config, null, res));
    renderWithQuery(<ProposalsPage />);
    expect(await screen.findByText("Run not found")).toBeInTheDocument();
    expect(screen.queryByText("No proposals waiting")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the cleaning queue" })).toBeInTheDocument();
  });

  it("disables every row decision while an approval is in flight", async () => {
    queue([item({}), item({ id: "i2", record_key: "100002" })]);
    vi.mocked(approveCleaning).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<ProposalsPage />);
    await screen.findByText("100002");
    const approves = screen.getAllByRole("button", { name: /^approve$/i });
    await userEvent.click(approves[0]);
    await waitFor(() => {
      for (const b of screen.getAllByRole("button", { name: /^(approve|reject)$/i })) expect(b).toBeDisabled();
    });
  });
});
