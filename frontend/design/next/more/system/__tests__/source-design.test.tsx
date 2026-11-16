import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as design from "@/lib/api/v2/design";
import { ToastProvider } from "../../../kit";
import { SourceDesign } from "../SourceDesign";

let allowed = true;
vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: () => allowed, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const show = (query = "") => {
  setUrl(`/more/systems/sys-1?fixture=1&tab=design${query}`);
  return renderWithQuery(<ToastProvider><SourceDesign id="sys-1" /></ToastProvider>);
};
const row = (el: HTMLElement, text: string) => within(el).getAllByRole("row").find((r) => r.textContent?.includes(text))!;

beforeEach(() => {
  allowed = true;
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("SourceDesign", () => {
  it("lists customer tables first and shows a table's fields against the standard", async () => {
    show("&table=MARA");
    const rows = within(await screen.findByTestId("sd-tables")).getAllByRole("row").slice(1);
    expect(rows[0].textContent).toMatch(/ZMM_PART_ATTR/);
    expect(rows[0].textContent).toMatch(/Customer table/);
    const detail = await screen.findByTestId("sd-table");
    expect(await within(detail).findByText("Standard is CHAR 9, here CHAR 18")).toBeTruthy();
    expect(within(detail).getAllByText("Customer field, not in the standard")).toHaveLength(3);
    expect(detail.textContent).toMatch(/FSH_SEALV/);
  });

  it("names customer and missing check-table entries and the tables read", async () => {
    show("&part=config");
    const werks = row(await screen.findByTestId("sd-deviation"), "WERKS");
    expect(werks.textContent).toMatch(/1100/);
    expect(werks.textContent).toMatch(/0001/);
    const read = screen.getByTestId("sd-config-read");
    fireEvent.click(within(read).getByRole("button", { name: /T134/ }));
    const t = await screen.findByTestId("sd-config-table");
    expect(await within(t).findByText(/Raw materials/)).toBeTruthy();
    expect(t.textContent).toMatch(/ZCOM/);
  });

  it("compares the two newest discoveries in words", async () => {
    show("&part=drift");
    const t = await screen.findByTestId("sd-drift");
    expect(t.textContent).toMatch(/Field changed/);
    expect(t.textContent).toMatch(/length from 9 to 18/);
    expect(t.textContent).toMatch(/Table added/);
  });

  it("shows coverage with failures, absent tables, uploads and waiting rules", async () => {
    show("&part=coverage");
    const dd04 = row(await screen.findByTestId("sd-coverage-dictionary"), "DD04T");
    expect(dd04.textContent).toMatch(/Failed/);
    expect(dd04.textContent).toMatch(/Not authorised to read the table/);
    expect(row(screen.getByTestId("sd-coverage-configuration"), "T001W").textContent).toMatch(/Not in this system/);
    const pay = row(screen.getByTestId("sd-coverage-extraction"), "PAYRESULT");
    expect(within(pay).getByRole("link", { name: "Upload a file" }).getAttribute("href")).toMatch(/\/admin\/runs/);
    expect(screen.getByTestId("sd-waiting-payroll_integration").textContent).toMatch(/43 rules wait for data and are left out of the score/);
  });

  it("starts a discovery", async () => {
    const spy = vi.spyOn(design, "discoverDesign");
    show();
    await screen.findByTestId("sd-tables");
    fireEvent.click(screen.getByRole("button", { name: "Discover again" }));
    expect(await screen.findByText("Discovery started")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith("sys-1");
  });

  it("gates discovery on permission", async () => {
    allowed = false;
    show();
    await screen.findByTestId("sd-tables");
    expect(screen.getByRole("button", { name: "Discover again" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Discovering the source design needs the trigger sync permission.")).toBeInTheDocument();
  });

  it("says when the system has not been discovered", async () => {
    vi.spyOn(design, "getDesignTables").mockRejectedValue({ response: { status: 404 } });
    show();
    expect(await screen.findByText("This system has not been discovered yet. Discover again reads its dictionary.")).toBeInTheDocument();
  });

  it("offers a retry when a list cannot be read", async () => {
    const spy = vi.spyOn(design, "getDesignSnapshots").mockRejectedValue(new Error("down"));
    show("&part=drift");
    fireEvent.click(await screen.findByRole("button", { name: /Try again|Retry/ }, { timeout: 4000 }));
    await waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(1));
  });
});
