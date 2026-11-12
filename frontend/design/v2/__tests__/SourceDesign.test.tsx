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
  it("coverage lists every table read, the failure with the system's reason, and tables absent from the system", async () => {
    setUrl("/s/sys-1?tab=design&part=coverage");
    renderWithQuery(<SourceDesign id="sys-1" />);
    const dict = await screen.findByTestId("sd-coverage-dictionary");
    const dd04 = within(dict).getAllByRole("row").find((r) => r.textContent?.includes("DD04T"))!;
    expect(dd04.textContent).toMatch(/Failed/);
    expect(dd04.textContent).toMatch(/Not authorised to read the table/);
    const cfg = screen.getByTestId("sd-coverage-configuration");
    const t001w = within(cfg).getAllByRole("row").find((r) => r.textContent?.includes("T001W"))!;
    expect(t001w.textContent).toMatch(/Not in this system/);
  });

  it("a configuration table opens with its stored entries and their texts", async () => {
    setUrl("/s/sys-1?tab=design&part=config&cfg=T134");
    renderWithQuery(<SourceDesign id="sys-1" />);
    const t = await screen.findByTestId("sd-config-table");
    expect(await within(t).findByText("Raw materials")).toBeTruthy();
    expect(t.textContent).toMatch(/Commissioned parts/);
    expect(t.textContent).toMatch(/ZCOM/);
  });

  it("lists the configuration tables the discovery read", async () => {
    setUrl("/s/sys-1?tab=design&part=config");
    renderWithQuery(<SourceDesign id="sys-1" />);
    const t = await screen.findByTestId("sd-config-read");
    expect(t.textContent).toMatch(/T134/);
  });
});
