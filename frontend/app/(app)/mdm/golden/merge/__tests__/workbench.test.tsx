// The match review workbench: the pair list beside the selected pair, the keyboard (j / k move, m merge,
// n not a match, s skip), the next pair after each verdict, and the approve gate on every verdict.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as cleaningApi from "@/lib/api/cleaning";
import * as matchReviewApi from "@/lib/api/match-review";
import * as mergeExplainApi from "@/lib/api/merge-explain";
import type { ReviewPair, ReviewPairDetail } from "@/lib/api/match-review";
import GoldenRecordMergePage from "../page";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  usePathname: () => "/mdm/golden/merge",
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
}));
const role = vi.hoisted(() => ({ approve: true }));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: (p: string) => (p === "approve" ? role.approve : true), loading: false }) }));

const pairOf = (id: string, a: string, b: string, total: number): ReviewPair => ({
  id, domain: "business_partner", a, b, total, band: "review", auto_action: "queued", steward_decision: null, constraint: null,
  field_scores: {}, a_record_id: `r-${a}`, b_record_id: `r-${b}`, same_cluster: false,
  explanation: {
    attributes: [{ field: "NAME_ORG1", comparator: "fuzzy", value_a: "North Mill", value_b: "North Mill Ltd", similarity: 0.91, weight: 2, contribution: 1.8, threshold: 0.85, threshold_met: true, skipped: false }],
    total, weight_total: 2, band: "steward_review", auto_action: "queued", fired: "", rules_met: [], rules_failed: [],
  },
});
const p1 = pairOf("p1", "BP-1", "BP-2", 0.8);
const p2 = pairOf("p2", "BP-1", "BP-3", 0.7);
const list = { pairs: [p1, p2], total: 2, bands: { review: 2, auto_merge: 0, low: 0 }, thresholds: { auto_merge: 0.95, review_floor: 0.3 } };
const detailOf = (p: ReviewPair): ReviewPairDetail => ({
  ...p,
  record_a: { key: p.a, record_id: p.a_record_id, confidence: 0.9, fields: { NAME_ORG1: "North Mill", CITY: "Durban" } },
  record_b: { key: p.b, record_id: p.b_record_id, confidence: 0.6, fields: { NAME_ORG1: "North Mill Ltd", CITY: "Durban" } },
  default_survivor: p.a,
});
const preview = {
  match_score_id: "p1", survivor_key: "BP-1", merged_key: "BP-2", golden_record_id: "g1",
  golden_fields: { NAME_ORG1: "North Mill", CITY: "Durban" },
  survivorship: { NAME_ORG1: { value: "North Mill", winner_key: "BP-1", rule: "source_priority" } },
  filled_fields: [], event_id: null, dry_run: true,
};

const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key: k, ...init });

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.replace.mockReset();
  role.approve = true;
  vi.restoreAllMocks();
  vi.spyOn(cleaningApi, "getDedupCandidates").mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(matchReviewApi, "getReviewPairs").mockResolvedValue(list);
  vi.spyOn(matchReviewApi, "getReviewPair").mockImplementation(async (id) => detailOf(id === "p2" ? p2 : p1));
});

describe("Match review workbench", () => {
  it("lists the pairs beside the first one, side by side, with identical fields folded away", async () => {
    vi.spyOn(matchReviewApi, "mergePair").mockResolvedValue(preview);
    renderWithQuery(<GoldenRecordMergePage />);
    const pairs = await screen.findByRole("list", { name: "Pairs to review" });
    expect(within(pairs).getAllByTestId("match-pair")).toHaveLength(2);
    expect(within(pairs).getAllByTestId("match-pair")[0]).toHaveAttribute("aria-current", "true");
    const grid = await screen.findByRole("table", { name: "Field comparison" });
    const name = within(grid).getByText("NAME_ORG1").closest("tr") as HTMLElement;
    expect(name).toHaveAttribute("data-differs", "true");
    expect(within(name).getByText("Differs")).toBeInTheDocument();
    expect(within(grid).queryByText("CITY")).not.toBeInTheDocument();
    fireEvent.click(within(grid).getByRole("button", { name: "Show 1 identical field" }));
    expect(within(grid).getByText("CITY")).toBeInTheDocument();
  });

  it("moves with j and k", async () => {
    vi.spyOn(matchReviewApi, "mergePair").mockResolvedValue(preview);
    renderWithQuery(<GoldenRecordMergePage />);
    await screen.findByRole("table", { name: "Field comparison" });
    key("k"); // already at the top
    expect(nav.replace).not.toHaveBeenCalled();
    key("j");
    expect(nav.replace).toHaveBeenCalledWith("/mdm/golden/merge?pair=p2", { scroll: false });
  });

  it("m with a reason merges, then selects the next pair", async () => {
    const merge = vi.spyOn(matchReviewApi, "mergePair").mockResolvedValue(preview);
    renderWithQuery(<GoldenRecordMergePage />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Same company" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Merge" })).toBeEnabled());
    key("m");
    await waitFor(() => expect(merge).toHaveBeenCalledWith("p1", { survivor: "BP-1", overrides: {}, reason: "Same company" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/mdm/golden/merge?pair=p2", { scroll: false }));
  });

  it("m without a reason sends nothing, asks for one, and Ctrl Enter then merges", async () => {
    const merge = vi.spyOn(matchReviewApi, "mergePair").mockResolvedValue(preview);
    renderWithQuery(<GoldenRecordMergePage />);
    const reason = await screen.findByRole("textbox");
    await waitFor(() => expect(merge).toHaveBeenCalledWith("p1", { survivor: "BP-1", dry_run: true }));
    key("m");
    expect(reason).toHaveFocus();
    expect(screen.getByText(/Give a reason, then press/)).toBeInTheDocument();
    expect(merge).not.toHaveBeenCalledWith("p1", expect.objectContaining({ reason: expect.any(String) }));
    // Typing in the reason box never fires a verdict key.
    fireEvent.keyDown(reason, { key: "n" });
    fireEvent.change(reason, { target: { value: "Same tax number" } });
    fireEvent.keyDown(reason, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(merge).toHaveBeenCalledWith("p1", { survivor: "BP-1", overrides: {}, reason: "Same tax number" }));
  });

  it("n with a reason marks the pair not a match, then selects the next pair", async () => {
    vi.spyOn(matchReviewApi, "mergePair").mockResolvedValue(preview);
    const decide = vi.spyOn(mergeExplainApi, "decidePair").mockResolvedValue({ match_score_id: "p1", constraint_id: "c1", kind: "do_not_match", event_id: "e1" });
    renderWithQuery(<GoldenRecordMergePage />);
    fireEvent.change(await screen.findByRole("textbox"), { target: { value: "Different firms" } });
    key("n");
    await waitFor(() => expect(decide).toHaveBeenCalledWith("p1", "reject", "Different firms"));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/mdm/golden/merge?pair=p2", { scroll: false }));
  });

  it("s skips to the next pair without saving", async () => {
    vi.spyOn(matchReviewApi, "mergePair").mockResolvedValue(preview);
    const decide = vi.spyOn(mergeExplainApi, "decidePair");
    renderWithQuery(<GoldenRecordMergePage />);
    await screen.findByRole("textbox");
    key("s");
    expect(nav.replace).toHaveBeenCalledWith("/mdm/golden/merge?pair=p2", { scroll: false });
    expect(decide).not.toHaveBeenCalled();
  });

  it("without the approve permission the keys decide nothing, and skip still moves on", async () => {
    role.approve = false;
    const merge = vi.spyOn(matchReviewApi, "mergePair");
    const decide = vi.spyOn(mergeExplainApi, "decidePair");
    renderWithQuery(<GoldenRecordMergePage />);
    expect(await screen.findByRole("button", { name: "Merge. Needs Data owner on all systems — Request access" })).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    key("m");
    key("n");
    expect(merge).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    key("s");
    expect(nav.replace).toHaveBeenCalledWith("/mdm/golden/merge?pair=p2", { scroll: false });
  });

  it("selects the pair a link from Insights names with record and with", async () => {
    nav.params = new URLSearchParams({ object: "business_partner", record: "BP-1", with: "BP-3" });
    vi.spyOn(matchReviewApi, "mergePair").mockResolvedValue(preview);
    renderWithQuery(<GoldenRecordMergePage />);
    const pairs = await screen.findByRole("list", { name: "Pairs to review" });
    await waitFor(() => expect(within(pairs).getAllByTestId("match-pair")[1]).toHaveAttribute("aria-current", "true"));
    await waitFor(() => expect(matchReviewApi.getReviewPair).toHaveBeenCalledWith("p2"));
  });

  it("says when the linked pair was never scored", async () => {
    nav.params = new URLSearchParams({ object: "business_partner", record: "BP-1", with: "BP-9" });
    vi.spyOn(matchReviewApi, "mergePair").mockResolvedValue(preview);
    renderWithQuery(<GoldenRecordMergePage />);
    expect(await screen.findByText(/The match engine has not scored/)).toBeInTheDocument();
  });
});
