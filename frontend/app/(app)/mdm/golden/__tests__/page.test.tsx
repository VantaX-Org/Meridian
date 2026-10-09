// frontend/app/(app)/mdm/golden/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as masterRecordsApi from "@/lib/api/master-records";
import GoldenRecordsPage from "../page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe("GoldenRecordsPage", () => {
  it("renders one row per master record", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecords").mockResolvedValue({
      records: [
        {
          id: "m1",
          domain: "material_master",
          sap_object_key: "MARA-1000",
          overall_confidence: 0.92,
          status: "golden",
          source_count: 3,
          pending_issues: 0,
          promoted_at: "2026-01-01T00:00:00Z",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      per_page: 100,
    });
    renderWithQuery(<GoldenRecordsPage />);
    await waitFor(() => expect(screen.getByText("MARA-1000")).toBeInTheDocument());
  });

  it("shows an empty state when no records match", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecords").mockResolvedValue({ records: [], total: 0, page: 1, per_page: 100 });
    renderWithQuery(<GoldenRecordsPage />);
    await waitFor(() => expect(screen.getByText(/no golden records/i)).toBeInTheDocument());
  });

  it("shows the API error message and retries on click", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecords").mockRejectedValue(new Error("master records service unavailable"));
    renderWithQuery(<GoldenRecordsPage />);
    await screen.findByText(/could not reach the server/i);
    const calls = (masterRecordsApi.getMasterRecords as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((masterRecordsApi.getMasterRecords as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });

  it("includes max_confidence in the request when set", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecords").mockResolvedValue({ records: [], total: 0, page: 1, per_page: 100 });
    renderWithQuery(<GoldenRecordsPage />);
    await waitFor(() => expect(masterRecordsApi.getMasterRecords).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Max confidence %"), { target: { value: "80" } });
    await waitFor(() =>
      expect(masterRecordsApi.getMasterRecords).toHaveBeenLastCalledWith(
        expect.objectContaining({ max_confidence: 0.8 })
      )
    );
  });
});
