import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rulesApi from "@/lib/api/rules";
import type { Rule } from "@/lib/api/rules";
import RulePage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ ruleId: "r1" }),
  useRouter: () => ({ push: vi.fn() }),
}));

const RULE: Rule = {
  id: "r1", name: "AP001: Vendor number is mandatory", description: null, module: "business_partner",
  category: "ecc", severity: "high", enabled: true, conditions: [{ field: "LFA1.STCD1", check_class: "null_check" }],
  thresholds: null, tags: null, source_yaml: "ap.yaml", source: "yaml", created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z", last_pass_rate: null, last_run_at: null,
};

describe("rule detail page", () => {
  it("renders the rule once loaded", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("AP001: Vendor number is mandatory")).toBeInTheDocument());
  });

  it("shows a retryable error when the rule fails to load", async () => {
    const spy = vi.spyOn(rulesApi, "getRule").mockRejectedValue(new Error("network down"));
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue(RULE);
    retry.click();
    await waitFor(() => expect(screen.getByText("AP001: Vendor number is mandatory")).toBeInTheDocument());
  });
});
