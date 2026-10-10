import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rulesApi from "@/lib/api/rules";
import type { Rule } from "@/lib/api/rules";
import * as configLoadApi from "@/lib/api/config-load";
import type { RuleApplicability } from "@/lib/api/config-load";
import RulePage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ ruleId: "r1" }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ can: () => true }) }));

const RULE: Rule = {
  id: "r1", name: "AP001: Vendor number is mandatory", description: null, module: "business_partner",
  category: "ecc", severity: "high", enabled: true, conditions: [{ field: "LFA1.STCD1", check_class: "null_check" }],
  thresholds: null, tags: null, source_yaml: "ap.yaml", source: "yaml", created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z", last_pass_rate: null, last_run_at: null,
};

const APPLICABILITY: RuleApplicability = {
  check_id: "r1",
  module: "business_partner",
  object: null,
  systems: [
    {
      system_id: "s1",
      name: "ECC PRD",
      system_type: "ecc",
      applicability: "applies",
      reason: null,
      object: null,
      configured_in: [{ object: "LFA1", kind: "img", path: "Financial Accounting > Vendor Master", tcode: "XK01" }],
    },
  ],
};

describe("rule detail page", () => {
  it("renders the rule once loaded", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("AP001: Vendor number is mandatory")).toBeInTheDocument());
  });

  it("renders where it applies, including the configured-in cell", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("ECC PRD")).toBeInTheDocument());
    expect(screen.getByText(/Financial Accounting > Vendor Master/)).toBeInTheDocument();
    expect(screen.getByText("XK01")).toBeInTheDocument();
  });

  it("shows a retryable error when the rule fails to load", async () => {
    const spy = vi.spyOn(rulesApi, "getRule").mockRejectedValue(new Error("network down"));
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText(/could not reach the server/i)).toBeInTheDocument());
    const retry = screen.getByRole("button", { name: /retry/i });
    spy.mockResolvedValue(RULE);
    retry.click();
    await waitFor(() => expect(screen.getByText("AP001: Vendor number is mandatory")).toBeInTheDocument());
  });

  it("shows an empty state and the history chart when runs exist", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({
      rule_id: "r1",
      runs: [{ version_id: "v1", run_at: "2026-01-01T00:00:00Z", module: "business_partner", severity: "high", affected_count: 1, total_count: 10, pass_rate: 0.9, suppressed: false, hit_rate: null }],
    });
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("Pass rate over runs")).toBeInTheDocument());
    expect(screen.queryByText(/has not run yet/i)).not.toBeInTheDocument();
  });

  it("shows the not-run-yet empty state when there is no history", async () => {
    vi.spyOn(rulesApi, "getRule").mockResolvedValue(RULE);
    vi.spyOn(configLoadApi, "getRuleApplicability").mockResolvedValue(APPLICABILITY);
    vi.spyOn(rulesApi, "getRuleHistory").mockResolvedValue({ rule_id: "r1", runs: [] });
    renderWithQuery(<RulePage />);
    await waitFor(() => expect(screen.getByText("This rule has not run yet.")).toBeInTheDocument());
  });
});
