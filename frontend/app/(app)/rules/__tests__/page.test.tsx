import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rulesApi from "@/lib/api/rules";
import type { Rule } from "@/lib/api/rules";
import RulesPage from "../page";

vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/rules",
  useSearchParams: () => new URLSearchParams(),
}));

const RULE: Rule = {
  id: "r1", name: "AP001: Vendor number is mandatory", description: null, module: "business_partner",
  category: "ecc", severity: "high", enabled: true, conditions: [{ field: "LFA1.STCD1", check_class: "null_check" }],
  thresholds: null, tags: null, source_yaml: "ap.yaml", source: "yaml", created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z", last_pass_rate: null, last_run_at: null,
};

describe("rules page", () => {
  it("renders rules once loaded", async () => {
    vi.spyOn(rulesApi, "getRules").mockResolvedValue({ rules: [RULE], total: 1, limit: 1000, offset: 0 });
    vi.spyOn(rulesApi, "getRulesSummary").mockResolvedValue({ summary: [] });
    renderWithQuery(<RulesPage />);
    await waitFor(() => expect(screen.getByText("Vendor number is mandatory")).toBeInTheDocument());
  });

  it("shows a retryable error when rules fail to load", async () => {
    const spy = vi.spyOn(rulesApi, "getRules").mockRejectedValue(new Error("network down"));
    vi.spyOn(rulesApi, "getRulesSummary").mockResolvedValue({ summary: [] });
    renderWithQuery(<RulesPage />);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue({ rules: [RULE], total: 1, limit: 1000, offset: 0 });
    retry.click();
    await waitFor(() => expect(screen.getByText("Vendor number is mandatory")).toBeInTheDocument());
  });
});
