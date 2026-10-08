// frontend/app/(app)/mdm/match-rules/__tests__/page.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as matchRulesApi from "@/lib/api/match-rules";
import * as mergeExplainApi from "@/lib/api/merge-explain";
import MatchRulesPage from "../page";

vi.mock("@/hooks/use-role", () => ({
  useRole: () => ({ can: () => true }),
}));

describe("MatchRulesPage", () => {
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
});
