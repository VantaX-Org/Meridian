import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { S4Readiness } from "../screens/S4Readiness";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/s4");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("S/4HANA readiness", () => {
  it("names the blocking rules and lists areas worst first with the unmeasured one last", async () => {
    renderWithQuery(<S4Readiness />);
    expect((await screen.findByTestId("s4-banner")).textContent).toMatch(/2 blocking rules stand in the way/);
    const rows = within(await screen.findByTestId("s4-areas")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual(["Business Partner / CVI", "Material master", "Universal Journal / General Ledger", "Warehouse Management to EWM"]);
    expect(rows[0].textContent).toMatch(/SAP Note 2265093/);
    expect(rows[3].textContent).toMatch(/Not measured/);
  });

  it("lists only failing rules, blocking first", async () => {
    renderWithQuery(<S4Readiness />);
    const rows = within(await screen.findByTestId("s4-blockers")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toMatch(/S4R-BP-KNVK-NAME/);
    expect(rows[0].textContent).toMatch(/Blocks the conversion/);
    expect(rows[3].textContent).toMatch(/Needs cleansing/);
  });
});
