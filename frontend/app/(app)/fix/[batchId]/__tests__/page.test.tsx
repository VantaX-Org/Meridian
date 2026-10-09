import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "../../../../../__tests__/render";
import BatchPage from "../page";
import { approveCleaning, getCleaningQueue, type CleaningQueueItem } from "@/lib/api/cleaning";

vi.mock("next/navigation", () => ({ useParams: () => ({ batchId: "B1" }) }));
vi.mock("@/lib/api/cleaning", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/cleaning")>("@/lib/api/cleaning");
  return { ...actual, getCleaningQueue: vi.fn(), approveCleaning: vi.fn(), rejectCleaning: vi.fn(), bulkApprove: vi.fn(), downloadCleaningExport: vi.fn() };
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
    vi.mocked(getCleaningQueue).mockResolvedValue({ items: [item({})], total: 1, page: 1, per_page: 500 });
    vi.mocked(approveCleaning).mockResolvedValue({ id: "i1", status: "approved" });

    renderWithQuery(<BatchPage />);

    await screen.findByText("100001");
    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(approveCleaning).toHaveBeenCalledWith("i1"));
  });

  it("filters out items from other batches", async () => {
    vi.mocked(getCleaningQueue).mockResolvedValue({
      items: [item({}), item({ id: "i2", record_key: "200002", batch_id: "B2" })],
      total: 2, page: 1, per_page: 500,
    });

    renderWithQuery(<BatchPage />);

    await screen.findByText("100001");
    expect(screen.queryByText("200002")).not.toBeInTheDocument();
  });
});
