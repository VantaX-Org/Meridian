import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import { FindingContextPanel } from "../finding-context-panel";
import * as pairingApi from "@/lib/api/config-pairing";

describe("FindingContextPanel", () => {
  it("shows the object, the target and the missing keys", async () => {
    vi.spyOn(pairingApi, "getFindingContext").mockResolvedValue({
      object: "T077K", system_id: "s1", target_label: "S4D", baseline: false,
      source: ["KTOKK=KRED", "KTOKK=ZZZZ"], target: ["KTOKK=KRED"], missing: ["KTOKK=ZZZZ"], missing_total: 1,
    });
    renderWithQuery(<FindingContextPanel ruleId="AP-001" run="v1" moduleId="accounts_payable" fields={[]} />);
    expect(await screen.findByText("T077K")).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 source values are not configured in S4D\./)).toBeInTheDocument();
    expect(screen.getByText("KTOKK=ZZZZ")).toBeInTheDocument();
  });

  it("renders nothing without a config object", async () => {
    const spy = vi.spyOn(pairingApi, "getFindingContext").mockResolvedValue({
      object: null, system_id: null, target_label: "baseline target", baseline: true,
      source: [], target: [], missing: [], missing_total: 0,
    });
    const { container } = renderWithQuery(<FindingContextPanel ruleId="X" run="" moduleId="m" fields={[]} />);
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
