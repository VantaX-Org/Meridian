// frontend/app/(app)/mdm/golden/merge/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as masterRecordsApi from "@/lib/api/master-records";
import type { MasterRecordDetail } from "@/types/api";
import GoldenRecordMergePage from "../page";

const searchParams = new URLSearchParams({ id: "m1" });
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

const record: MasterRecordDetail = {
  id: "m1",
  domain: "material_master",
  sap_object_key: "MARA-1000",
  golden_fields: { MATKL: "FERT" },
  source_contributions: {
    ECC: { value: "FERT", source_system: "ECC", extracted_at: "2026-01-01T00:00:00Z", confidence: 0.9 },
    SF: { value: "HALB", source_system: "SF", extracted_at: "2026-01-01T00:00:00Z", confidence: 0.4 },
  },
  overall_confidence: 0.9,
  status: "golden",
  promoted_at: null,
  promoted_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("GoldenRecordMergePage", () => {
  it("renders a field-by-field comparison with the conflicting source highlighted", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    renderWithQuery(<GoldenRecordMergePage />);
    await waitFor(() => expect(screen.getByText("MARA-1000")).toBeInTheDocument());
    expect(screen.getByText("MATKL")).toBeInTheDocument();
    expect(screen.getByText(/HALB/)).toBeInTheDocument();
  });

  it("shows the API error message and retries on click", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockRejectedValue(new Error("master record service unavailable"));
    renderWithQuery(<GoldenRecordMergePage />);
    await screen.findByText("master record service unavailable");
    const calls = (masterRecordsApi.getMasterRecord as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((masterRecordsApi.getMasterRecord as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });
});
