// frontend/app/(app)/mdm/match-rules/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as matchRulesApi from "@/lib/api/match-rules";
import * as mergeExplainApi from "@/lib/api/merge-explain";
import MatchRulesPage from "../page";

const perms = vi.hoisted(() => ({ granted: new Set<string>(["manage_rules", "approve", "mdm.write"]) }));
vi.mock("@/hooks/use-role", () => ({
  useRole: () => ({ can: (a: string) => perms.granted.has(a), loading: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(),
}));

describe("MatchRulesPage", () => {
  beforeEach(() => {
    perms.granted = new Set(["manage_rules", "approve", "mdm.write"]);
    vi.restoreAllMocks();
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
    expect(screen.getByText("Constraints")).toBeInTheDocument();
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
    expect(await screen.findByText("Only rule managers can edit match rules")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "New rule" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Simulate" })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
