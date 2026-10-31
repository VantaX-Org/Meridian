import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { SourceDesign } from "../screens/system/SourceDesign";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Source design", () => {
  it("lists tables with customer objects first and shows a table's fields against the standard", async () => {
    setUrl("/s/sys-1?tab=design&table=MARA");
    renderWithQuery(<SourceDesign id="sys-1" />);
    const rows = within(await screen.findByTestId("sd-tables")).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/ZMM_PART_ATTR/);
    expect(rows[0].textContent).toMatch(/Customer table/);
    const detail = await screen.findByTestId("sd-table");
    expect(await within(detail).findByText("Standard is CHAR 9, here CHAR 18")).toBeTruthy();
    expect(within(detail).getAllByText("Customer field, not in the standard")).toHaveLength(3);
    expect(detail.textContent).toMatch(/FSH_SEALV/);
  });

  it("names customer and missing check-table entries", async () => {
    setUrl("/s/sys-1?tab=design&part=config");
    renderWithQuery(<SourceDesign id="sys-1" />);
    const t = await screen.findByTestId("sd-deviation");
    const werks = within(t).getAllByRole("row").find((r) => r.textContent?.includes("T001W-WERKS"))!;
    expect(werks.textContent).toMatch(/1100/);
    expect(werks.textContent).toMatch(/0001/);
  });

  it("compares the two newest discoveries in words", async () => {
    setUrl("/s/sys-1?tab=design&part=drift");
    renderWithQuery(<SourceDesign id="sys-1" />);
    const t = await screen.findByTestId("sd-drift");
    expect(t.textContent).toMatch(/Field changed/);
    expect(t.textContent).toMatch(/length from 9 to 18/);
    expect(t.textContent).toMatch(/Table added/);
  });
});
