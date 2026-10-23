import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "../../../../../__tests__/render";
import BatchPage from "../page";
import { approveCleaning, bulkApprove, getCleaningAudit, getCleaningQueue, type CleaningQueueItem } from "@/lib/api/cleaning";

vi.mock("next/navigation", () => ({ useParams: () => ({ batchId: "B1" }) }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("@/lib/api/cleaning", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/cleaning")>("@/lib/api/cleaning");
  return { ...actual, getCleaningQueue: vi.fn(), getCleaningAudit: vi.fn(), approveCleaning: vi.fn(), rejectCleaning: vi.fn(), bulkApprove: vi.fn(), downloadCleaningExport: vi.fn() };
});

const item = (over: Partial<CleaningQueueItem>): CleaningQueueItem => ({
  id: "i1", object_type: "material_master", status: "recommended", confidence: 0.92,
  record_key: "100001", priority: 1, detected_at: "", applied_at: null,
  rollback_deadline: null, rule_id: null, batch_id: "B1", version_id: null,
  merge_preview: null, record_data_before: null, record_data_after: null,
  golden_record_id: null, golden_field_value: null, golden_record_exists: false,
  ...over,
});

beforeEach(() => {
  vi.mocked(getCleaningQueue).mockReset();
  vi.mocked(approveCleaning).mockReset();
});

describe("BatchPage", () => {
  it("shows every item in the batch and approves one", async () => {
    vi.mocked(getCleaningQueue).mockResolvedValue({ items: [item({})], total: 1, page: 1, per_page: 100 });
    vi.mocked(approveCleaning).mockResolvedValue({ id: "i1", status: "approved" });

    renderWithQuery(<BatchPage />);

    await screen.findByText("100001");
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(approveCleaning).toHaveBeenCalledWith("i1"));
  });

  it("accepts exactly this batch's waiting proposals at 85% or higher", async () => {
    vi.mocked(getCleaningQueue).mockResolvedValue({
      items: [
        item({ id: "hi", record_key: "100001", confidence: 0.92, status: "detected" }),
        item({ id: "edge", record_key: "100002", confidence: 0.85, status: "recommended" }),
        item({ id: "low", record_key: "100003", confidence: 0.6, status: "detected" }),
        item({ id: "done", record_key: "100004", confidence: 0.95, status: "approved" }),
      ],
      total: 4, page: 1, per_page: 100,
    });
    vi.mocked(bulkApprove).mockResolvedValue({ approved_count: 2, skipped_count: 0 });

    renderWithQuery(<BatchPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Accept 2 at 85% or higher" }));
    await waitFor(() => expect(bulkApprove).toHaveBeenCalledWith({ ids: ["hi", "edge"] }));
  });

  it("renders one Export for the batch", async () => {
    vi.mocked(getCleaningQueue).mockResolvedValue({ items: [item({})], total: 1, page: 1, per_page: 100 });

    renderWithQuery(<BatchPage />);

    await screen.findByText("100001");
    expect(screen.getAllByRole("button", { name: "Export" })).toHaveLength(1);
  });

  it("asks the server for this batch only, not a client-side filter over one page", async () => {
    // Regression for I11: a client-side filter over a fixed 100-item page missed
    // batches further back in the queue. The filter must be server-side now.
    vi.mocked(getCleaningQueue).mockResolvedValue({ items: [item({})], total: 1, page: 1, per_page: 100 });

    renderWithQuery(<BatchPage />);

    await screen.findByText("100001");
    expect(getCleaningQueue).toHaveBeenCalledWith(expect.objectContaining({ batch_id: "B1" }));
  });

  it("audit tab lists the cleaning audit rows of this batch", async () => {
    vi.mocked(getCleaningQueue).mockResolvedValue({ items: [item({})], total: 1, page: 1, per_page: 100 });
    vi.mocked(getCleaningAudit).mockResolvedValue({
      items: [{ id: "a1", action: "approved", actor_name: "Steward One", record_key: "100001", data_before: null, data_after: null, metadata: null, created_at: "2026-01-01T10:00:00Z" }],
      total: 1,
    });

    renderWithQuery(<BatchPage />);
    await screen.findByText("100001");
    await userEvent.click(screen.getByRole("tab", { name: "Audit" }));

    expect(await screen.findByText("Steward One")).toBeInTheDocument();
    expect(getCleaningAudit).toHaveBeenCalledWith(expect.objectContaining({ batch_id: "B1" }));
  });
});
