import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/survivorship";
import SurvivorshipPage from "../page";

describe("survivorship rules page", () => {
  it("says which value each field keeps in plain words", async () => {
    vi.spyOn(api, "getSurvivorshipRules").mockResolvedValue({
      rules: [{ id: "s1", domain: "business_partner", field: "NAME_ORG1", rule_type: "trusted_source", trusted_sources: ["ECC"], weight: 1, active: true, ai_inferred: false }],
      total: 1,
    });
    renderWithQuery(<SurvivorshipPage />);
    expect(await screen.findByText("Trusted system wins")).toBeInTheDocument();
    expect(screen.getByText("NAME_ORG1")).toBeInTheDocument();
    expect(screen.getByText(/decide which value each field keeps/)).toBeInTheDocument();
  });

  it("explains the default when there are no rules and points to match review", async () => {
    vi.spyOn(api, "getSurvivorshipRules").mockResolvedValue({ rules: [], total: 0 });
    renderWithQuery(<SurvivorshipPage />);
    expect(await screen.findByText("No survivorship rules")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Review match pairs" })[0]).toHaveAttribute("href", "/mdm/golden/merge");
  });
});
