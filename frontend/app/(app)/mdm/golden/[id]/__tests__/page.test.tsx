// frontend/app/(app)/mdm/golden/[id]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as masterRecordsApi from "@/lib/api/master-records";
import * as goldenWritebackApi from "@/lib/api/golden-writeback";
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
// The write-back panel compares the signed-in user with the request's requester.
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: { id: "u1", email: "u1@x.com", name: "U1", role: "admin" } }) }));

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
    vi.spyOn(mergeExplainApi, "getClusterGraph").mockResolvedValue({ golden_record_id: "m1", nodes: [], edges: [], weak_chains: [], auto_merge: 0.95 });
    vi.spyOn(mergeExplainApi, "getMergeEvents").mockResolvedValue([]);
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

  it("shows each value's connected source system, not the upload or merge label", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue({
      ...record,
      source_contributions: {
        MATKL: { value: "FERT", source_system: "upload:aaaa1111", source_system_id: "s-prd", source_system_name: "PRD", extracted_at: "2026-01-01T00:00:00Z", confidence: 0.9 },
        MAKTX: { value: "Bolt", source_system: "merge:MARA-2000", source_system_id: "s-s4p", source_system_name: "S4P", merged_from: "MARA-2000", extracted_at: "2026-01-01T00:00:00Z", confidence: null },
        MEINS: { value: "EA", source_system: "upload:bbbb2222", extracted_at: "2026-01-01T00:00:00Z", confidence: 0.7 },
      },
    });
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    renderWithQuery(<MasterRecordPage />);
    const sources = await screen.findByRole("region", { name: "Source contributions" });
    const row = (f: string) => within(sources).getByText(f).closest("tr") as HTMLElement;
    expect(within(row("MATKL")).getByText("PRD")).toBeInTheDocument();
    expect(within(row("MAKTX")).getByText("S4P")).toBeInTheDocument();
    expect(within(row("MAKTX")).getByText("MARA-2000")).toBeInTheDocument();
    expect(within(row("MAKTX")).getAllByText("None")).toHaveLength(2); // a merged value has no confidence (nor a model pick)
    // an upload attached to no system keeps its upload label
    expect(within(row("MEINS")).getByText("upload:bbbb2222")).toBeInTheDocument();
    expect(within(sources).getByText("3 fields from 3 systems")).toBeInTheDocument();
  });

  it("mounts the SAP write-back for a golden record and opens it with the target systems", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    vi.spyOn(goldenWritebackApi, "getWritebackRequests").mockResolvedValue({ requests: [] });
    const preview = vi.spyOn(goldenWritebackApi, "getWritebackPreview").mockResolvedValue({
      record_id: "m1", domain: "material_master", sap_object_key: "MARA-1000", golden_fields: record.golden_fields,
      writeback_supported: false, live_enabled: false, message: "Write-back is not supported for this object.",
      targets: [{ system_id: "s1", system_name: "ECC PRD", system_type: "ecc", supported: false, method: null,
        reason: "No verified BAPI_MATERIAL_SAVEDATA parameter mapping", fields: [] }],
      unresolved_sources: [],
    });
    renderWithQuery(<MasterRecordPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Write back to SAP" }));
    const drawer = await screen.findByRole("dialog");
    await waitFor(() => expect(preview).toHaveBeenCalledWith("m1"));
    expect(await within(drawer).findByText("ECC PRD")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Simulate" })).toBeDisabled();
  });

  it("offers no write-back before the record is golden", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue({ ...record, status: "candidate" });
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    renderWithQuery(<MasterRecordPage />);
    await screen.findByText("MARA-1000");
    expect(screen.queryByRole("button", { name: "Write back to SAP" })).not.toBeInTheDocument();
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

  it("shows each member's links and warns about a member joined only through another", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    vi.spyOn(mergeExplainApi, "getMergeExplanation").mockResolvedValue({
      golden_record_id: "m1", key: "MARA-1000", domain: "material_master", members: ["MARA-2000", "MARA-3000"],
      golden_fields: {}, steward_overrides: {}, survivorship: {}, pairs: [], thresholds: { auto_merge: 0.95, review_floor: 0.3 },
    });
    vi.spyOn(mergeExplainApi, "getClusterGraph").mockResolvedValue({
      golden_record_id: "m1", auto_merge: 0.95, edges: [],
      nodes: [{ key: "MARA-1000", degree: 1, is_survivor: true }, { key: "MARA-2000", degree: 2, is_survivor: false }, { key: "MARA-3000", degree: 1, is_survivor: false }],
      weak_chains: [{ a: "MARA-1000", via: "MARA-2000", b: "MARA-3000", reason: "no_direct_score" }],
    });
    renderWithQuery(<MasterRecordPage />);
    expect(await screen.findByText("1 pair is joined only through another record", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/they were never scored against each other/)).toBeInTheDocument();
    const merged = screen.getByRole("region", { name: "Merged records" });
    expect(within(merged).getByRole("columnheader", { name: "Links" })).toBeInTheDocument();
    const row = within(merged).getAllByText("MARA-2000").map((el) => el.closest("tr")).find(Boolean) as HTMLElement;
    expect(within(row).getByText("2")).toBeInTheDocument();
  });

  it("lists the merge history on the History tab", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    vi.spyOn(mergeExplainApi, "getMergeEvents").mockResolvedValue([
      { id: "e2", event_type: "unmerge", member_keys: ["MARA-2000"], actor: null, reason: "Different material", before: null, after: null, reverses_event_id: null, reversed: true, created_at: "2026-02-01T10:00:00Z" },
      { id: "e1", event_type: "merge", member_keys: ["MARA-2000"], actor: null, reason: null, before: null, after: null, reverses_event_id: null, reversed: false, created_at: "2026-01-01T10:00:00Z" },
    ]);
    renderWithQuery(<MasterRecordPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "History" }));
    const section = await screen.findByRole("region", { name: "Merge history" });
    expect(await within(section).findByText("Split out")).toBeInTheDocument();
    expect(within(section).getByText("Reversed")).toBeInTheDocument();
    expect(within(section).getByText("Different material")).toBeInTheDocument();
    expect(within(section).getByText("Merged")).toBeInTheDocument();
  });

  it("lets an approver override a golden field with a reason, and shows who chose each value", async () => {
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    vi.spyOn(mergeExplainApi, "getMergeExplanation").mockResolvedValue({
      golden_record_id: "m1", key: "MARA-1000", domain: "material_master", members: [],
      golden_fields: record.golden_fields, steward_overrides: { MEINS: "EA" },
      survivorship: {
        MAKTX: { value: "Bolt", winner_key: "MARA-1000", rule: "source_priority", losers: [] },
        MEINS: { value: "EA", winner_key: null, rule: "steward_override", losers: [] },
      },
      pairs: [], thresholds: { auto_merge: 0.95, review_floor: 0.3 },
    });
    const save = vi.spyOn(mergeExplainApi, "setStewardOverrides").mockResolvedValue({
      golden_record_id: "m1", event_id: "e9", golden_fields: { ...record.golden_fields, MAKTX: "Hex bolt" }, steward_overrides: { MEINS: "EA", MAKTX: "Hex bolt" },
    });
    renderWithQuery(<MasterRecordPage />);
    const fieldsTable = await screen.findByRole("region", { name: "Golden fields" });
    expect(await within(fieldsTable).findByText("Steward override")).toBeInTheDocument();
    expect(within(fieldsTable).getByText(/Source priority/)).toBeInTheDocument();
    expect(within(fieldsTable).getByRole("button", { name: "Clear the override on MEINS" })).toBeInTheDocument();
    fireEvent.click(within(fieldsTable).getByRole("button", { name: "Override MAKTX" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Save override" });
    fireEvent.change(within(dialog).getByLabelText("New value"), { target: { value: "Hex bolt" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason (required), kept in the merge history"), { target: { value: "Supplier catalogue" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(save).toHaveBeenCalledWith("m1", { MAKTX: "Hex bolt" }, "Supplier catalogue"));
  });

  it("offers no override without approve", async () => {
    role.denied = new Set(["approve"]);
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    vi.spyOn(masterRecordsApi, "getMasterRecordHistory").mockResolvedValue([]);
    vi.spyOn(relationshipsApi, "getRelationships").mockResolvedValue({ relationships: [], total: 0 });
    renderWithQuery(<MasterRecordPage />);
    const fieldsTable = await screen.findByRole("region", { name: "Golden fields" });
    await within(fieldsTable).findByText("MAKTX");
    expect(within(fieldsTable).queryByRole("button", { name: /Override/ })).toBeNull();
    role.denied = new Set();
  });

});
