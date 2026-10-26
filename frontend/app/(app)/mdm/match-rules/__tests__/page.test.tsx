// frontend/app/(app)/mdm/match-rules/__tests__/page.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import * as matchRulesApi from "@/lib/api/match-rules";
import * as mergeExplainApi from "@/lib/api/merge-explain";
import MatchRulesPage from "../page";

const perms = vi.hoisted(() => ({ granted: new Set<string>(["manage_rules", "approve", "mdm.write"]) }));
vi.mock("@/hooks/use-role", () => ({
  useRole: () => ({ can: (a: string) => perms.granted.has(a), loading: false }),
}));

const nav = vi.hoisted(() => ({ qs: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(nav.qs),
}));

describe("MatchRulesPage", () => {
  beforeEach(() => {
    perms.granted = new Set(["manage_rules", "approve", "mdm.write"]);
    nav.qs = "";
    vi.restoreAllMocks();
  });

  it("clears a settled pair through a confirmation with an optional reason, not a browser prompt", async () => {
    nav.qs = "tab=constraints";
    vi.spyOn(mergeExplainApi, "getPairConstraints").mockResolvedValue([
      { id: "c1", domain: "business_partner", key_lo: "BP-1", key_hi: "BP-2", kind: "do_not_match", reason: "Different firms", created_by: null, created_at: "2026-01-01T00:00:00Z" },
    ]);
    const clear = vi.spyOn(mergeExplainApi, "clearPairConstraint").mockResolvedValue({ constraint_id: "c1", event_id: "e1" });
    const prompt = vi.spyOn(window, "prompt");
    renderWithQuery(<MatchRulesPage />);
    expect(await screen.findByText("Not a match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Reason (optional)" }), { target: { value: "Re-check" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear decision" }));
    await waitFor(() => expect(clear).toHaveBeenCalledWith("c1", "Re-check"));
    expect(prompt).not.toHaveBeenCalled();
  });

  it("renders the rules tab with the active domain's rules", async () => {
    vi.spyOn(matchRulesApi, "getMatchRules").mockResolvedValue({
      rules: [
        { id: "r1", tenant_id: "t1", domain: "material_master", field: "MATKL", match_type: "fuzzy", weight: 1, threshold: 0.85, active: true },
      ],
      total: 1,
    });
    vi.spyOn(mergeExplainApi, "getPairConstraints").mockResolvedValue([]);
    renderWithQuery(<MatchRulesPage />);
    await waitFor(() => expect(screen.getByText("MATKL")).toBeInTheDocument());
    expect(screen.getByText("Rules")).toBeInTheDocument();
    expect(screen.getByText("Tuning")).toBeInTheDocument();
    expect(screen.getByText("Settled pairs")).toBeInTheDocument();
  });

  it("shows the API error message for rules and retries on click", async () => {
    vi.spyOn(matchRulesApi, "getMatchRules").mockRejectedValue(new Error("rules service unavailable"));
    vi.spyOn(mergeExplainApi, "getPairConstraints").mockResolvedValue([]);
    renderWithQuery(<MatchRulesPage />);
    await screen.findByText(/could not reach the server/i);
    const calls = (matchRulesApi.getMatchRules as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() =>
      expect((matchRulesApi.getMatchRules as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls),
    );
  });

  it("confirms before deleting a rule and shows the threshold as a percentage", async () => {
    vi.spyOn(matchRulesApi, "getMatchRules").mockResolvedValue({
      rules: [{ id: "r1", tenant_id: "t1", domain: "material_master", field: "MATKL", match_type: "fuzzy", weight: 1, threshold: 0.85, active: true }],
      total: 1,
    });
    const del = vi.spyOn(matchRulesApi, "deleteMatchRule").mockResolvedValue({ deleted: true });
    renderWithQuery(<MatchRulesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit MATKL" }));
    expect(screen.getByLabelText("Threshold %")).toHaveValue(85);
    fireEvent.click(screen.getByRole("button", { name: "Delete rule" }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Delete rule", hidden: false }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("r1"));
  });

  it("offers Edit and New rule to a role holding manage_rules", async () => {
    vi.spyOn(matchRulesApi, "getMatchRules").mockResolvedValue({
      rules: [
        { id: "r1", tenant_id: "t1", domain: "material_master", field: "MATKL", match_type: "fuzzy", weight: 1, threshold: 0.85, active: true },
      ],
      total: 1,
    });
    renderWithQuery(<MatchRulesPage />);
    await screen.findByText("MATKL");
    expect(screen.getByRole("button", { name: "Edit MATKL" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New rule" })).toBeInTheDocument();
  });

  it("names the manage_rules permission instead of calling the API for a manager (mdm.write without manage_rules)", async () => {
    perms.granted = new Set(["mdm.write", "approve", "view"]);
    const get = vi.spyOn(matchRulesApi, "getMatchRules").mockResolvedValue({ rules: [], total: 0 });
    renderWithQuery(<MatchRulesPage />);
    expect(await screen.findByText("You need permission to manage rules")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "New rule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Simulate" })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("tunes in percentages, then applies the tried weights to the object's rules after a confirm", async () => {
    nav.qs = "tab=tuning";
    vi.spyOn(matchRulesApi, "getMatchRules").mockResolvedValue({
      rules: [
        { id: "r1", tenant_id: "t1", domain: "material_master", field: "MATKL", match_type: "fuzzy", weight: 40, threshold: 0.85, active: true },
        { id: "r2", tenant_id: "t1", domain: "material_master", field: "MATKL", match_type: "exact", weight: 40, threshold: 1, active: false },
        { id: "r3", tenant_id: "t1", domain: "material_master", field: "MAKTX", match_type: "fuzzy", weight: 20, threshold: 0.8, active: true },
      ],
      total: 3,
    });
    const dry = vi.spyOn(mergeExplainApi, "matchTuningDryRun").mockResolvedValue({
      domain: "material_master", pairs: 10, pairs_newly_linked: 1, pairs_unlinked: 0, band_moves: {}, clusters_before: 5, clusters_after: 4,
      clusters_that_would_merge: 1, clusters_that_would_split: 0, applied: false,
    });
    const update = vi.spyOn(matchRulesApi, "updateMatchRule").mockImplementation(async (id, body) => ({ id, tenant_id: "t1", domain: "material_master", field: "MATKL", match_type: "fuzzy", weight: body.weight ?? 0, threshold: 0.85, active: true }));
    renderWithQuery(<MatchRulesPage />);
    expect(screen.getByText(/stored pairs of an object/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Object" }));
    await user.click(await screen.findByRole("option", { name: "Material master" }));
    fireEvent.change(await screen.findByLabelText("MATKL (current 40)"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Auto-merge at %"), { target: { value: "90" } });
    expect(screen.getByLabelText("Review floor %")).toHaveValue(30);
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    await waitFor(() => expect(dry).toHaveBeenCalledWith({ domain: "material_master", auto_merge: 0.9, review_floor: 0.3, weights: { MATKL: 60 } }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply these weights" }));
    const dialog = await screen.findByRole("dialog", { name: "Change the weight of 1 rule?" });
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply weights" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("r1", { weight: 60 }));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("names the role that clears a settled pair, with Request access wording", async () => {
    nav.qs = "tab=constraints";
    perms.granted = new Set(["manage_rules", "view"]);
    vi.spyOn(mergeExplainApi, "getPairConstraints").mockResolvedValue([]);
    renderWithQuery(<MatchRulesPage />);
    expect(await screen.findByText(/Clearing a decision needs Data owner on all systems/)).toBeInTheDocument();
    expect(screen.queryByText(/approve permission/)).not.toBeInTheDocument();
  });
});
