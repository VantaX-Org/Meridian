import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "../../../../__tests__/render";
import FixPage from "../page";
import { getCleaningQueue, type CleaningQueueItem } from "@/lib/api/cleaning";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api/cleaning", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/cleaning")>("@/lib/api/cleaning");
  return { ...actual, getCleaningQueue: vi.fn() };
});

const item = (over: Partial<CleaningQueueItem>): CleaningQueueItem => ({
  id: "1", object_type: "material_master", status: "recommended", confidence: 0.9,
  record_key: "100001", priority: 1, detected_at: "", applied_at: null,
  rollback_deadline: null, rule_id: null, batch_id: "B1", version_id: null,
  merge_preview: null, record_data_before: null, record_data_after: null,
  golden_record_id: null, golden_field_value: null, golden_record_exists: false,
  ...over,
});

beforeEach(() => {
  push.mockClear();
  vi.mocked(getCleaningQueue).mockReset();
});

describe("FixPage", () => {
  it("shows one row per batch and navigates to the batch on click", async () => {
    vi.mocked(getCleaningQueue).mockResolvedValue({
      items: [item({}), item({ id: "2", confidence: 0.7 })],
      total: 2, page: 1, per_page: 500,
    });
    renderWithQuery(<FixPage />);

    const cell = await screen.findByText("B1");
    await userEvent.click(cell);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/fix/B1"));
  });

  it("shows an empty state when there are no batches", async () => {
    vi.mocked(getCleaningQueue).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 500 });
    renderWithQuery(<FixPage />);

    expect(await screen.findByText("No batches yet")).toBeInTheDocument();
  });
});
