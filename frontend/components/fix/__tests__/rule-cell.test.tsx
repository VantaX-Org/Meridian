import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as rulesApi from "@/lib/api/rules";
import { RuleCell, RuleName } from "../rule-cell";

afterEach(() => vi.restoreAllMocks());

describe("RuleCell", () => {
  it("names a rule from the catalogue by its check id, without the 'ID: ' prefix", async () => {
    vi.spyOn(rulesApi, "getRuleNames").mockResolvedValue({ MM045: "MM045: Material type is mandatory" });
    renderWithQuery(<RuleCell id="MM045" fallback="row message" />);
    expect(screen.getByText("MM045")).toBeInTheDocument();
    expect(await screen.findByText("Material type is mandatory")).toBeInTheDocument();
    expect(screen.queryByText(/MM045: /)).toBeNull();
  });

  it("falls back to the row's own words while the catalogue does not name the rule, never repeating the id", async () => {
    vi.spyOn(rulesApi, "getRuleNames").mockResolvedValue({});
    renderWithQuery(<><RuleCell id="ZZ1" fallback="Vendor is blocked" /><RuleCell id="ZZ2" fallback="ZZ2" /></>);
    expect(await screen.findByText("Vendor is blocked")).toBeInTheDocument();
    expect(screen.getAllByText("ZZ2")).toHaveLength(1);
  });

  it("names a DDIC check by its own words without asking the catalogue", () => {
    const get = vi.spyOn(rulesApi, "getRuleNames");
    renderWithQuery(<RuleName id="DDIC-ADR6-TYPE" />);
    expect(screen.getByText("Value does not match the field's SAP data type (ADR6)")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});
