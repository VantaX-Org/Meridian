// frontend/app/(app)/mdm/golden/[id]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { toast } from "@/design";
import * as masterRecordsApi from "@/lib/api/master-records";
import * as relationshipsApi from "@/lib/api/relationships";
import * as mergeExplainApi from "@/lib/api/merge-explain";
import * as matchReviewApi from "@/lib/api/match-review";
import type { MasterRecordDetail } from "@/types/api";
import MasterRecordPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "m1" }),
}));
const role = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock("@/hooks/use-role", () => ({
  useRole: () => ({ can: (p: string) => !role.denied.has(p) }),
}));

const record: MasterRecordDetail = {
  id: "m1",
  domain: "material_master",
  sap_object_key: "MARA-1000",
  golden_fields: { MATKL: "FERT", MAKTX: "Bolt", MEINS: "EA" },
  // Keyed by field, as api/services/golden_record_engine.py writes it; two fields came from ECC, one from S/4HANA Cloud.
  source_contributions: {
    MATKL: { value: "FERT", source_system: "ECC", extracted_at: "2026-01-01T00:00:00Z", confidence: 0.9 },
    MAKTX: { value: "Bolt", source_system: "S4HANA_CLOUD", extracted_at: "2026-01-01T00:00:00Z", confidence: 0.8 },
    MEINS: { value: "EA", source_system: "ECC", extracted_at: "2026-01-01T00:00:00Z", confidence: 0.7 },
  },
  overall_confidence: 0.9,
  status: "golden",
  promoted_at: null,
  promoted_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("MasterRecordPage", () => {
  beforeEach(() => {
    vi.spyOn(mergeExplainApi, "getMergeExplanation").mockResolvedValue({
      golden_record_id: "m1", key: "MARA-1000", domain: "material_master", members: [], golden_fields: {},
      steward_overrides: {}, survivorship: {}, pairs: [], thresholds: { auto_merge: 0.95, review_floor: 0.3 },
    });
  });

  it("renders the record's SAP key and golden fields", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    renderWithQuery(<MasterRecordPage />);
    await waitFor(() => expect(screen.getByText("MARA-1000")).toBeInTheDocument());
    expect(screen.getAllByText("FERT").length).toBeGreaterThan(0);
    // The merge comparison is reachable from the record.
    expect(screen.getByRole("link", { name: "Compare sources" })).toHaveAttribute("href", `/mdm/golden/merge?id=${record.id}`);
  });

  it("counts distinct source systems and lists one source row per field", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    renderWithQuery(<MasterRecordPage />);
    expect(await screen.findByText(/built from 2 source systems\./)).toBeInTheDocument();
    const sources = screen.getByRole("region", { name: "Source contributions" });
    expect(within(sources).getByText("3 fields from 2 systems")).toBeInTheDocument();
    expect(within(sources).getByRole("columnheader", { name: "Source system" })).toBeInTheDocument();
    const maktx = within(sources).getByText("MAKTX").closest("tr") as HTMLElement;
    expect(within(maktx).getByText("S4HANA_CLOUD")).toBeInTheDocument();
    expect(within(maktx).getByText("80%")).toBeInTheDocument();
  });

  it("names the real target systems before a write-back and reports the outcome", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    const history = vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    const writeback = vi.spyOn(masterRecordsApi, "writebackMasterRecord").mockResolvedValue({
      record_id: "m1", domain: "material_master", golden_fields: record.golden_fields, writeback_supported: true, message: "Written",
    });
    const success = vi.spyOn(toast, "success");
    renderWithQuery(<MasterRecordPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Write back" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Target systems: ECC, S4HANA_CLOUD")).toBeInTheDocument();
    expect(within(dialog).queryByText(/Target systems?: .*MATKL/)).not.toBeInTheDocument();
    const before = history.mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Write back" }));
    await waitFor(() => expect(writeback).toHaveBeenCalledWith("m1"));
    await waitFor(() => expect(success).toHaveBeenCalledWith("MARA-1000 written back to ECC, S4HANA_CLOUD"));
    // The history refreshes so the write-back shows up there.
    await waitFor(() => expect(history.mock.calls.length).toBeGreaterThan(before));
  });

  it("says when the API only returned the values instead of claiming a write", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    vi.spyOn(masterRecordsApi, "writebackMasterRecord").mockResolvedValue({
      record_id: "m1", domain: "material_master", golden_fields: {}, writeback_supported: false, message: "Apply the findings via 4-eyes.",
    });
    const success = vi.spyOn(toast, "success");
    const info = vi.spyOn(toast, "info");
    renderWithQuery(<MasterRecordPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Write back" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Write back" }));
    await waitFor(() => expect(info).toHaveBeenCalledWith("Not written to ECC, S4HANA_CLOUD. Apply the findings via 4-eyes."));
    expect(success).not.toHaveBeenCalled();
  });

  it.each([
    ["candidate", "Candidate"],
    ["pending_review", "Pending review"],
    ["golden", "Golden"],
    ["superseded", "Superseded"],
  ] as const)("labels a %s record by its lifecycle", async (status, label) => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue({ ...record, status });
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    renderWithQuery(<MasterRecordPage />);
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByText(/in batch/i)).not.toBeInTheDocument();
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

  it("offers Promote only while the record is not golden or merged away", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue({ ...record, status: "superseded" });
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    renderWithQuery(<MasterRecordPage />);
    await screen.findByText(/merged into another golden record/);
    expect(screen.queryByRole("button", { name: "Promote" })).not.toBeInTheDocument();
  });

  it("keeps Promote in view, disabled with the role that grants it, without approve rights", async () => {
    role.denied = new Set(["approve"]);
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue({ ...record, status: "candidate" });
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    try {
      renderWithQuery(<MasterRecordPage />);
      const promote = await screen.findByRole("button", { name: /^Promote\. Needs Data owner on all systems — Request access$/ });
      expect(promote).toBeDisabled();
    } finally {
      role.denied = new Set();
    }
  });

  it("promotes a candidate after a confirmation", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue({ ...record, status: "candidate" });
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    const promote = vi.spyOn(masterRecordsApi, "promoteMasterRecord").mockResolvedValue(undefined as never);
    renderWithQuery(<MasterRecordPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Promote" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Promote" }));
    await waitFor(() => expect(promote).toHaveBeenCalledWith("m1", true));
  });

  it("lists merged records with why they matched, and previews a split before saving it", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    vi.spyOn(mergeExplainApi, "getMergeExplanation").mockResolvedValue({
      golden_record_id: "m1", key: "MARA-1000", domain: "material_master", members: ["MARA-2000"],
      golden_fields: { MATKL: "FERT", MAKTX: "Pump" }, steward_overrides: {}, survivorship: {},
      pairs: [{ id: "p1", a: "MARA-1000", b: "MARA-2000", total: 0.97, auto_action: "merged", steward_decision: null, steward_reason: null, constraint: null, field_scores: {},
        explanation: { attributes: [{ field: "MAKTX", comparator: "fuzzy", value_a: "Pump", value_b: "Pump", similarity: 1, weight: 1, contribution: 1, threshold: 0.8, threshold_met: true, skipped: false }], total: 0.97, weight_total: 1, band: "auto_merge", auto_action: "merged", fired: "", rules_met: [], rules_failed: [] } }],
      thresholds: { auto_merge: 0.95, review_floor: 0.3 },
    });
    const preview = vi.spyOn(matchReviewApi, "previewUnmerge").mockResolvedValue({
      golden_record_id: "m1", event_id: "", split_keys: ["MARA-2000"], remaining_keys: [], do_not_match_pairs: 1,
      golden_fields: { MATKL: "FERT", MAKTX: "" }, dry_run: true,
    });
    const unmerge = vi.spyOn(mergeExplainApi, "unmergeRecords").mockResolvedValue({
      golden_record_id: "m1", event_id: "e1", split_keys: ["MARA-2000"], remaining_keys: [], do_not_match_pairs: 1, golden_fields: {},
    });
    renderWithQuery(<MasterRecordPage />);
    expect(await screen.findByText("Matched on MAKTX", undefined, { timeout: 4000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Split MARA-2000 out" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Pump");
    expect(preview).toHaveBeenCalledWith("m1", ["MARA-2000"], "Preview");
    expect(unmerge).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("button", { name: "Split out" })).toBeDisabled();
    expect(within(dialog).getByText("Give a reason to split it out")).toBeInTheDocument();
    expect(within(dialog).getByText("Reason (required), kept in the merge history")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Different material" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Split out" }));
    await waitFor(() => expect(unmerge).toHaveBeenCalledWith("m1", ["MARA-2000"], "Different material"));
  });

});
