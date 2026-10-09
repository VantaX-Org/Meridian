// frontend/app/(app)/mdm/golden/[id]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as masterRecordsApi from "@/lib/api/master-records";
import * as relationshipsApi from "@/lib/api/relationships";
import type { MasterRecordDetail } from "@/types/api";
import MasterRecordPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "m1" }),
}));
vi.mock("@/hooks/use-role", () => ({
  useRole: () => ({ can: () => true }),
}));

const record: MasterRecordDetail = {
  id: "m1",
  domain: "material_master",
  sap_object_key: "MARA-1000",
  golden_fields: { MATKL: "FERT" },
  source_contributions: {
    ECC: { value: "FERT", source_system: "ECC", extracted_at: "2026-01-01T00:00:00Z", confidence: 0.9 },
  },
  overall_confidence: 0.9,
  status: "golden",
  promoted_at: null,
  promoted_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("MasterRecordPage", () => {
  it("renders the record's SAP key and golden fields", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    renderWithQuery(<MasterRecordPage />);
    await waitFor(() => expect(screen.getByText("MARA-1000")).toBeInTheDocument());
    expect(screen.getAllByText("FERT").length).toBeGreaterThan(0);
  });

  it("shows an empty state when the record does not exist", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(null as unknown as MasterRecordDetail);
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    renderWithQuery(<MasterRecordPage />);
    await waitFor(() => expect(screen.getByText(/record not found/i)).toBeInTheDocument());
  });

  it("shows the API error message and retries on click", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockRejectedValue({ isAxiosError: true, response: { data: { detail: "master record service unavailable" } } });
    renderWithQuery(<MasterRecordPage />);
    await screen.findByText("master record service unavailable");
    const calls = (masterRecordsApi.getMasterRecord as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((masterRecordsApi.getMasterRecord as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });

  it("disables Promote when the record is superseded", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue({ ...record, status: "superseded" });
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    renderWithQuery(<MasterRecordPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Promote" })).toBeDisabled());
  });
});
