// frontend/app/(app)/mdm/golden/__tests__/page.test.tsx
import { screen, waitFor } from "@testing-library/react";
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
      per_page: 200,
    });
    renderWithQuery(<GoldenRecordsPage />);
    await waitFor(() => expect(screen.getByText("MARA-1000")).toBeInTheDocument());
  });

  it("shows an empty state when no records match", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecords").mockResolvedValue({ records: [], total: 0, page: 1, per_page: 200 });
    renderWithQuery(<GoldenRecordsPage />);
    await waitFor(() => expect(screen.getByText(/no master records/i)).toBeInTheDocument());
  });
});
