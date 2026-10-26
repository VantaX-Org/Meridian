import { fireEvent, screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as settingsApi from "@/lib/api/settings";
import type { CostModel } from "@/types/api";
import { CostModelPanel, applyPricingDraft, draftErrors, toDraft } from "../cost-model-panel";

const MODEL: CostModel = {
  currency: "ZAR", severity: { critical: { per_record: 500 } }, modules: {}, rules: {}, features: { MIGO: 150 },
  impact: {
    duplicate_payment: { unit_cost: 8500, factor: 0.276, mitigation: 0.7 },
    failed_posting: { unit_cost: 5000, factor: 12, mitigation: 0.85 },
  },
  config_alignment: { ghost_config: 500 },
  subscription_monthly: null,
};

describe("cost model pricing helpers", () => {
  it("round-trips the model through the draft, keeping the other sections", () => {
    const out = applyPricingDraft(MODEL, toDraft(MODEL));
    expect(out).toEqual(MODEL);
    expect(toDraft(MODEL).impact.failed_posting.mitigation_pct).toBe("85");
  });

  it("rejects a bad currency, a negative amount and a share over 100", () => {
    const d = toDraft(MODEL);
    expect(draftErrors(d)).toEqual({});
    const bad = { ...d, currency: "eu", alignment: { ghost_config: "-1" }, impact: { ...d.impact, failed_posting: { ...d.impact.failed_posting, mitigation_pct: "120" } } };
    expect(Object.keys(draftErrors(bad)).sort()).toEqual(["alignment.ghost_config", "currency", "impact.failed_posting.mitigation"]);
  });
});

describe("CostModelPanel", () => {
  it("shows the tenant's currency and unit costs and saves the edited model", async () => {
    vi.spyOn(settingsApi, "getCostModel").mockResolvedValue(MODEL);
    const update = vi.spyOn(settingsApi, "updateCostModel").mockResolvedValue();
    renderWithQuery(<CostModelPanel />);
    await waitFor(() => expect(screen.getByLabelText("Currency")).toHaveValue("ZAR"));
    expect(screen.getByLabelText("Duplicate payment unit cost")).toHaveValue(8500);
    expect(screen.getByRole("columnheader", { name: "Unit cost (ZAR)" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "eur" } });
    fireEvent.change(screen.getByLabelText(/Monthly subscription/), { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText("Duplicate payment unit cost"), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText("Unused configured value impact per unit"), { target: { value: "25" } });
    // the headers follow the currency being set
    expect(screen.getByRole("columnheader", { name: "Unit cost (EUR)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save pricing" }));

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][0]).toEqual({
      ...MODEL,
      currency: "EUR",
      subscription_monthly: 2000,
      impact: { ...MODEL.impact, duplicate_payment: { unit_cost: 400, factor: 0.276, mitigation: 0.7 } },
      config_alignment: { ghost_config: 25 },
    });
  });

  it("holds the save while an amount is invalid", async () => {
    vi.spyOn(settingsApi, "getCostModel").mockResolvedValue(MODEL);
    const update = vi.spyOn(settingsApi, "updateCostModel").mockResolvedValue();
    renderWithQuery(<CostModelPanel />);
    await waitFor(() => expect(screen.getByLabelText("Currency")).toHaveValue("ZAR"));
    fireEvent.change(screen.getByLabelText("Currency"), { target: { value: "R" } });
    expect(screen.getByRole("button", { name: "Save pricing" })).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
  });
});
