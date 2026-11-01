import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { Insights } from "../screens/Insights";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/insights");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Cost and causes", () => {
  it("names the business area with the most value at risk and never adds money across areas", async () => {
    renderWithQuery(<Insights />);
    const banner = await screen.findByTestId("ins-banner");
    expect(banner.textContent).toMatch(/Procure to pay carries the most value at risk/);
    const areas = await screen.findByTestId("ins-areas");
    expect(within(areas).getByText("Order to cash")).toBeInTheDocument();
    expect(areas.textContent).not.toMatch(/Total/);
  });

  it("lists a cost in two currencies per currency, rule ids from objects, and dashes for uncomputed origins", async () => {
    renderWithQuery(<Insights />);
    const proven = await screen.findByTestId("ins-proven");
    const sales = within(proven).getByText("Sales orders blocked (customer master)").closest("tr")!;
    expect(sales.textContent).toMatch(/ZAR.*610,000.*\$18,400/);
    const impact = await screen.findByTestId("ins-impact");
    expect(await within(impact).findByText("MM142")).toBeInTheDocument();
    const causes = await screen.findByTestId("ins-causes");
    expect(causes.textContent).toContain("ZMM_MASS_UPLOAD");
    const klimk = within(causes).getByText(/about/).closest("tr")!;
    expect(klimk.textContent).toContain("—");
  });
});
