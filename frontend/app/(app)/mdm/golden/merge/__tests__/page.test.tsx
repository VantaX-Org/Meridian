// frontend/app/(app)/mdm/golden/merge/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as masterRecordsApi from "@/lib/api/master-records";
import * as mergeExplainApi from "@/lib/api/merge-explain";
import type { MasterRecordDetail } from "@/types/api";
import GoldenRecordMergePage from "../page";

const searchParams = new URLSearchParams({ id: "m1" });
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

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
  it("without a record, keeps its header and points to the golden records", async () => {
    searchParams.delete("id");
    renderWithQuery(<GoldenRecordMergePage />);
    expect(screen.getByRole("heading", { name: "Merge conflicts" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open golden records" })).toHaveAttribute("href", "/mdm/golden");
    searchParams.set("id", "m1");
  });

  it("renders a field-by-field comparison with the conflicting source highlighted", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    renderWithQuery(<GoldenRecordMergePage />);
    await waitFor(() => expect(screen.getByText(/MARA-1000/)).toBeInTheDocument());
    expect(screen.getByText("MATKL")).toBeInTheDocument();
    expect(screen.getByText(/HALB/)).toBeInTheDocument();
    // The conflicting source offers its value; the agreeing one does not.
    expect(screen.getAllByRole("button", { name: "Use this value" })).toHaveLength(1);
  });

  it("records a chosen value as a steward override", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    const override = vi.spyOn(mergeExplainApi, "setStewardOverrides").mockResolvedValue({ golden_record_id: "m1", event_id: "e1", golden_fields: {}, steward_overrides: {} });
    renderWithQuery(<GoldenRecordMergePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Use this value" }));
    await waitFor(() => expect(override).toHaveBeenCalledWith("m1", { MATKL: "HALB" }, expect.any(String)));
  });

  it("shows the API error message and retries on click", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockRejectedValue(new Error("master record service unavailable"));
    renderWithQuery(<GoldenRecordMergePage />);
    await screen.findByText(/could not reach the server/i);
    const calls = (masterRecordsApi.getMasterRecord as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((masterRecordsApi.getMasterRecord as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });
});
