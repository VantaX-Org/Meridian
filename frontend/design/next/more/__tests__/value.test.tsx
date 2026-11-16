import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/analytics";
import { Value } from "../Value";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/more/insights?tab=value");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Value delivered", () => {
  it("shows the banner and every panel", async () => {
    renderWithQuery(<Value />);
    expect(await screen.findByTestId("val-banner")).toBeInTheDocument();
    for (const id of ["val-impact", "val-ribbon", "val-portfolio", "val-months", "val-run-impact", "val-guards"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("shows an empty state when nothing is priced", async () => {
    vi.spyOn(api, "getValue").mockResolvedValue({ roi: { subscription_annual: null, risk_mitigated: 0, roi_multiple: null, payback_months: null, currency: "" }, impacts: [], cost_avoidance_history: [] });
    renderWithQuery(<Value />);
    expect(await screen.findByText("No priced loss in the latest run")).toBeInTheDocument();
    expect(screen.getAllByText("No finished run has been priced yet.")[0]).toBeInTheDocument();
  });

  it("retries after an error", async () => {
    const spy = vi.spyOn(api, "getValue").mockRejectedValue(new Error("down"));
    renderWithQuery(<Value />);
    expect(await screen.findByText("The value delivered could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
    spy.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByTestId("val-banner")).toBeInTheDocument();
  });
});
