// frontend/app/(app)/mdm/golden/merge/__tests__/page.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as cleaningApi from "@/lib/api/cleaning";
import type { DedupCandidate } from "@/lib/api/cleaning";
import * as masterRecordsApi from "@/lib/api/master-records";
import * as matchReviewApi from "@/lib/api/match-review";
import * as mergeExplainApi from "@/lib/api/merge-explain";
import type { ReviewPair, ReviewPairDetail } from "@/lib/api/match-review";
import type { MasterRecordDetail } from "@/types/api";
import GoldenRecordMergePage from "../page";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  usePathname: () => "/mdm/golden/merge",
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
}));
const role = vi.hoisted(() => ({ approve: true }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (p: string) => (p === "approve" ? role.approve : true), loading: false }) }));

const record: MasterRecordDetail = {
  id: "m1",
  domain: "material_master",
  sap_object_key: "MARA-1000",
  golden_fields: { MATKL: "FERT", MAKTX: "Bolt" },
  // Keyed by field, as api/services/golden_record_engine.py writes it.
  source_contributions: {
    MATKL: { value: "FERT", source_system: "ECC", extracted_at: "2026-01-01T00:00:00Z", confidence: 0.9 },
    MAKTX: { value: "Bolt", source_system: "S4HANA_CLOUD", extracted_at: "2026-01-01T00:00:00Z", confidence: 0.4 },
  },
  overall_confidence: 0.9,
  status: "golden",
  promoted_at: null,
  promoted_by: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const pair: ReviewPair = {
  id: "p1", domain: "business_partner", a: "BP-1", b: "BP-2", total: 0.72, band: "review", auto_action: "queued",
  steward_decision: null, constraint: null, field_scores: {}, a_record_id: "ra", b_record_id: "rb", same_cluster: false,
  explanation: {
    attributes: [
      { field: "NAME_ORG1", comparator: "fuzzy", value_a: "North Mill", value_b: "North Mill Ltd", similarity: 0.91, weight: 2, contribution: 1.8, threshold: 0.85, threshold_met: true, skipped: false },
      { field: "TAXNUM", comparator: "exact", value_a: "", value_b: "T1", similarity: 0, weight: 1, contribution: 0, threshold: 1, threshold_met: false, skipped: false },
    ],
    total: 0.72, weight_total: 3, band: "steward_review", auto_action: "queued", fired: "", rules_met: [], rules_failed: [],
  },
};
const detail: ReviewPairDetail = {
  ...pair,
  record_a: { key: "BP-1", record_id: "ra", confidence: 0.9, fields: { NAME_ORG1: "North Mill", CITY: "Durban" } },
  record_b: { key: "BP-2", record_id: "rb", confidence: 0.6, fields: { NAME_ORG1: "North Mill Ltd", CITY: "Durban" } },
  default_survivor: "BP-1",
};
const list = { pairs: [pair], total: 1, bands: { review: 1, auto_merge: 4, low: 2 }, thresholds: { auto_merge: 0.95, review_floor: 0.3 } };
const preview = (name: string, rule: string) => ({
  match_score_id: "p1", survivor_key: "BP-1", merged_key: "BP-2", golden_record_id: "ra",
  golden_fields: { NAME_ORG1: name, CITY: "Durban" },
  survivorship: { NAME_ORG1: { value: name, winner_key: rule === "steward_override" ? null : "BP-1", rule }, CITY: { value: "Durban", winner_key: "BP-1", rule: "source_priority" } },
  filled_fields: [], event_id: null, dry_run: true,
});

const candidate: DedupCandidate = {
  id: "d1", object_type: "material_master", record_key_a: "2", record_key_b: "7", match_score: 90, match_method: "fuzzy",
  match_fields: null, status: "pending", survivor_key: null, merged_at: null, created_at: "2026-10-01T00:00:00Z",
};

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.replace.mockReset();
  role.approve = true;
  vi.restoreAllMocks();
  vi.spyOn(cleaningApi, "getDedupCandidates").mockResolvedValue({ items: [candidate], total: 3 });
});

describe("Match review queue", () => {
  it("lists uncertain pairs first with why they matched, and band counts", async () => {
    const get = vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue(list);
    renderWithQuery(<GoldenRecordMergePage />);
    expect(screen.getByRole("heading", { name: "Match review" })).toBeInTheDocument();
    expect(await screen.findByText("Matched on NAME_ORG1, differs on TAXNUM")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ band: "review" }));
    expect(screen.getByRole("button", { name: "Uncertain (1)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Low score (2)" }));
    expect(nav.replace).toHaveBeenCalledWith("/mdm/golden/merge?band=low", { scroll: false });
  });

  it("explains an empty queue and points to the match rules", async () => {
    vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue({ ...list, pairs: [], total: 0, bands: { review: 0, auto_merge: 0, low: 0 } });
    renderWithQuery(<GoldenRecordMergePage />);
    expect(await screen.findByText("No pairs waiting")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open match rules" })).toHaveAttribute("href", "/mdm/match-rules");
    expect(screen.queryByRole("button", { name: "Merge likely duplicates" })).not.toBeInTheDocument();
  });

  it("bulk merges likely duplicates only after confirming how many", async () => {
    vi.spyOn(matchReviewApi, "getReviewPairs").mockImplementation(async (p) => (p?.min_score ? { ...list, total: 4 } : list));
    const bulk = vi.spyOn(matchReviewApi, "bulkMergePairs").mockResolvedValue({ considered: 4, merged: 4, already_together: 0, blocked: 0, missing_record: 0 });
    renderWithQuery(<GoldenRecordMergePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Merge likely duplicates" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/4 waiting pairs score 95% or more/)).toBeInTheDocument();
    expect(bulk).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge 4 pairs" }));
    await waitFor(() => expect(bulk).toHaveBeenCalledWith(expect.objectContaining({ min_score: 0.95, limit: 500 })));
  });

  it("does not offer bulk merge without the approve permission", async () => {
    role.approve = false;
    vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue(list);
    renderWithQuery(<GoldenRecordMergePage />);
    await screen.findByText("Matched on NAME_ORG1, differs on TAXNUM");
    expect(screen.queryByRole("button", { name: "Merge likely duplicates" })).not.toBeInTheDocument();
  });
});

describe("One review screen for both sources", () => {
  it("counts the cleaning engine's pairs and switches to them", async () => {
    vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue(list);
    renderWithQuery(<GoldenRecordMergePage />);
    expect(await screen.findByRole("button", { name: "Match engine (7)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(await screen.findByRole("button", { name: "Cleaning engine (3)" }));
    expect(nav.replace).toHaveBeenCalledWith("/mdm/golden/merge?source=cleaning", { scroll: false });
  });

  it("lists the cleaning engine's pairs and keeps one record of a pair", async () => {
    nav.params = new URLSearchParams({ source: "cleaning" });
    const counts = vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue(list);
    vi.spyOn(cleaningApi, "getDedupPreview").mockResolvedValue({ merge_preview: { MAKTX: { a: "Bolt", b: "Bolt M8", survivor: "Bolt M8" } } });
    const merge = vi.spyOn(cleaningApi, "mergeDedupCandidate").mockResolvedValue({ id: "d1", status: "merged", survivor_key: "7", merged_at: "2026-10-02T00:00:00Z" });
    renderWithQuery(<GoldenRecordMergePage />);
    expect(screen.getByRole("heading", { name: "Match review" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Match engine (7)" })).toHaveAttribute("aria-pressed", "false");
    expect(counts).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    expect(screen.queryByRole("group", { name: "Score band" })).not.toBeInTheDocument();
    // The object reads by its module name, not a title-cased id.
    expect(await screen.findAllByText("Material master")).not.toHaveLength(0);
    fireEvent.click(await screen.findByText("7"));
    expect(await screen.findByText("Bolt M8")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep B" }));
    // A merge has no undo route, so it asks first and nothing is sent until confirmed.
    const dialog = await screen.findByRole("dialog", { name: /Keep record B/ });
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    expect(merge).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(merge).toHaveBeenCalledWith({ candidate_id: "d1", survivor_key: "7" }));
  });

  it("keeps Merge in view, disabled with the role that grants it, without approve rights", async () => {
    role.approve = false;
    nav.params = new URLSearchParams({ source: "cleaning" });
    vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue(list);
    vi.spyOn(cleaningApi, "getDedupPreview").mockResolvedValue({ merge_preview: {} });
    renderWithQuery(<GoldenRecordMergePage />);
    fireEvent.click(await screen.findByText("7"));
    expect(await screen.findByRole("button", { name: "Merge. Needs Data owner on all systems — Request access" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Keep A" })).not.toBeInTheDocument();
  });

  it("cancelling the keep confirmation merges nothing", async () => {
    nav.params = new URLSearchParams({ source: "cleaning", object: "sd_customer_master" });
    vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue(list);
    vi.spyOn(cleaningApi, "getDedupCandidates").mockResolvedValue({ items: [{ ...candidate, object_type: "sd_customer_master" }], total: 1 });
    vi.spyOn(cleaningApi, "getDedupPreview").mockResolvedValue({ merge_preview: {} });
    const merge = vi.spyOn(cleaningApi, "mergeDedupCandidate");
    renderWithQuery(<GoldenRecordMergePage />);
    fireEvent.click(await screen.findByText("7"));
    expect(await screen.findByText(/SD customer master, 90% match/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep A" }));
    const dialog = await screen.findByRole("dialog", { name: /Keep record A/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep both" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Keep record A/ })).not.toBeInTheDocument());
    expect(merge).not.toHaveBeenCalled();
  });

  it("keeps one record's pairs in both sources, with a chip to clear it", async () => {
    nav.params = new URLSearchParams({ source: "cleaning", object: "material_master", record: "MATNR=2" });
    const counts = vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue({ ...list, pairs: [], total: 0, bands: { review: 0, auto_merge: 0, low: 0 } });
    renderWithQuery(<GoldenRecordMergePage />);
    expect(await screen.findByText("Pairs of")).toBeInTheDocument();
    expect(screen.getByText("MATNR=2")).toBeInTheDocument();
    await waitFor(() => expect(cleaningApi.getDedupCandidates).toHaveBeenCalledWith(expect.objectContaining({ object_type: "material_master", record: "MATNR=2", page: 1 })));
    expect(counts).toHaveBeenCalledWith(expect.objectContaining({ domain: "material_master", record: "MATNR=2" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Pairs of" }));
    expect(nav.replace).toHaveBeenCalledWith("/mdm/golden/merge?source=cleaning", { scroll: false });
  });

  it("says when the match engine has no pair for the record and offers the other source", async () => {
    nav.params = new URLSearchParams({ object: "material_master", record: "MATNR=2" });
    const get = vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue({ ...list, pairs: [], total: 0, bands: { review: 0, auto_merge: 0, low: 0 } });
    renderWithQuery(<GoldenRecordMergePage />);
    expect(await screen.findByText("No match engine pairs for MATNR=2")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(expect.objectContaining({ domain: "material_master", record: "MATNR=2", band: "review" }));
    fireEvent.click(screen.getByRole("button", { name: "Show cleaning engine pairs" }));
    expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("source=cleaning"), { scroll: false });
  });
});

describe("Reviewing one pair", () => {
  it("previews a per-field pick, then merges with it", async () => {
    nav.params = new URLSearchParams({ pair: "p1" });
    vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue(list);
    vi.spyOn(matchReviewApi, "getReviewPair").mockResolvedValue(detail);
    const merge = vi.spyOn(matchReviewApi, "mergePair").mockImplementation(async (_id, body) =>
      body.overrides && Object.keys(body.overrides).length ? preview("North Mill Ltd", "steward_override") : preview("North Mill", "source_priority"));
    renderWithQuery(<GoldenRecordMergePage />);
    const pick = await screen.findByRole("radio", { name: "Use record B value for NAME_ORG1" });
    await waitFor(() => expect(merge).toHaveBeenCalledWith("p1", { survivor: "BP-1", dry_run: true }));
    expect(screen.getByRole("radio", { name: "Use record A value for NAME_ORG1" })).toBeChecked();
    fireEvent.click(pick);
    await waitFor(() => expect(merge).toHaveBeenCalledWith("p1", { survivor: "BP-1", overrides: { NAME_ORG1: "North Mill Ltd" }, dry_run: true }));
    expect(await screen.findByText("Your pick")).toBeInTheDocument();

    const mergeButton = screen.getByRole("button", { name: "Merge" });
    expect(mergeButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not a match" })).toBeDisabled();
    expect(screen.getByText("Reason (required), kept in the merge history")).toBeInTheDocument();
    expect(screen.getByText("Give a reason to merge or mark not a match")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Same company" } });
    await waitFor(() => expect(mergeButton).toBeEnabled());
    fireEvent.click(mergeButton);
    await waitFor(() => expect(merge).toHaveBeenCalledWith("p1", { survivor: "BP-1", overrides: { NAME_ORG1: "North Mill Ltd" }, reason: "Same company" }));
  });

  it("marks a pair not a match with a reason", async () => {
    nav.params = new URLSearchParams({ pair: "p1" });
    vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue(list);
    vi.spyOn(matchReviewApi, "getReviewPair").mockResolvedValue(detail);
    vi.spyOn(matchReviewApi, "mergePair").mockResolvedValue(preview("North Mill", "source_priority"));
    const decide = vi.spyOn(mergeExplainApi, "decidePair").mockResolvedValue({ match_score_id: "p1", constraint_id: "c1", kind: "do_not_match", event_id: "e1" });
    renderWithQuery(<GoldenRecordMergePage />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Different firms" } });
    fireEvent.click(screen.getByRole("button", { name: "Not a match" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("p1", "reject", "Different firms"));
  });

  it("decide later moves on without saving anything", async () => {
    nav.params = new URLSearchParams({ pair: "p1" });
    vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue(list);
    vi.spyOn(matchReviewApi, "getReviewPair").mockResolvedValue(detail);
    vi.spyOn(matchReviewApi, "mergePair").mockResolvedValue(preview("North Mill", "source_priority"));
    const decide = vi.spyOn(mergeExplainApi, "decidePair");
    renderWithQuery(<GoldenRecordMergePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Decide later" }));
    expect(nav.replace).toHaveBeenCalledWith("/mdm/golden/merge", { scroll: false });
    expect(decide).not.toHaveBeenCalled();
  });

  it("shows the comparison read-only and says why without the approve permission", async () => {
    role.approve = false;
    nav.params = new URLSearchParams({ pair: "p1" });
    vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue(list);
    vi.spyOn(matchReviewApi, "getReviewPair").mockResolvedValue(detail);
    const merge = vi.spyOn(matchReviewApi, "mergePair");
    renderWithQuery(<GoldenRecordMergePage />);
    expect(await screen.findByRole("button", { name: "Merge. Needs Data owner on all systems — Request access" })).toBeDisabled();
    expect(screen.getByText("Merging a pair or marking it not a match needs Data owner on all systems")).toBeInTheDocument();
    expect(screen.queryByText(/approve permission/)).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(merge).not.toHaveBeenCalled();
  });
});

describe("Comparing one golden record against its sources", () => {
  it("lists one row per field with its golden value, source system and confidence", async () => {
    nav.params = new URLSearchParams({ id: "m1" });
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockResolvedValue(record);
    renderWithQuery(<GoldenRecordMergePage />);
    await screen.findByRole("heading", { name: /Sources of MARA-1000/ });
    expect(screen.getByText("2 fields from 2 source systems")).toBeInTheDocument();
    const matkl = screen.getByText("MATKL").closest("tr");
    expect(matkl).not.toBeNull();
    expect(within(matkl as HTMLElement).getByText("FERT")).toBeInTheDocument();
    expect(within(matkl as HTMLElement).getByText("ECC")).toBeInTheDocument();
    expect(within(matkl as HTMLElement).getByText("90%")).toBeInTheDocument();
    const maktx = screen.getByText("MAKTX").closest("tr") as HTMLElement;
    expect(within(maktx).getByText("S4HANA_CLOUD")).toBeInTheDocument();
    expect(within(maktx).getByText("40%")).toBeInTheDocument();
    // Field names are never read as systems: no field-by-field grid of differing sources.
    expect(screen.queryByRole("columnheader", { name: "MATKL" })).not.toBeInTheDocument();
    expect(screen.queryByText(/differs/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use this value" })).not.toBeInTheDocument();
  });

  it("shows the API error message and retries on click", async () => {
    nav.params = new URLSearchParams({ id: "m1" });
    vi.spyOn(masterRecordsApi, "getMasterRecord").mockRejectedValue(new Error("master record service unavailable"));
    renderWithQuery(<GoldenRecordMergePage />);
    await screen.findByText(/could not reach the server/i);
    const calls = (masterRecordsApi.getMasterRecord as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect((masterRecordsApi.getMasterRecord as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls));
  });
});
