import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ToastProvider } from "@/design/next/kit";
import { SheetHost } from "@/design/next/shell/SheetHost";
import { ObjectPage } from "@/design/next/screens/ObjectPage";
import type { TabId } from "../tabs";
import type { LandscapeCell } from "@/lib/api/v2/types";
import { DimensionBars } from "../ScoreParts";
import { getUrl, setUrl } from "@/design/v2/__tests__/nav-store";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));
afterEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

function open(system: string, module: string, tab: TabId, query = "") {
  setUrl(`/next/o/${system}/${module}/${tab}?fixture=1${query}`);
  return renderWithQuery(
    <ToastProvider><SheetHost>
      <ObjectPage system={system} module={module} tab={tab} />
    </SheetHost></ToastProvider>,
  );
}

describe("object page parity with v2", () => {
  it("moves the old ?as_of= address to ?run=", async () => {
    open("ecc-production", "material-master", "overview", "&as_of=run-7");
    await waitFor(() => expect(getUrl()).toMatch(/run=run-7/));
    expect(getUrl()).not.toMatch(/as_of=/);
  });

  it("says the object is not found when the address names no object", async () => {
    open("ecc-production", "no-such-object", "overview");
    const box = await screen.findByTestId("object-not-found");
    expect(box.textContent).toMatch(/Object not found/);
    expect(box.textContent).toMatch(/no-such-object/);
    expect(within(box).getByRole("link", { name: "Open the landscape" })).toBeTruthy();
  });

  it("shows the no-run state with a call to action on a system without a run", async () => {
    open("s-4hana-sandbox", "material-master", "overview");
    const box = await screen.findByTestId("object-no-run");
    expect(box.textContent).toMatch(/Extracted, not analysed\./);
    expect(within(box).getByRole("link", { name: /Run analysis on/ })).toBeTruthy();
  });

  it("leads the overview with the decision layer and the issues action", async () => {
    open("ecc-production", "material-master", "overview");
    await screen.findByTestId("object-page");
    expect(await screen.findByTestId("object-issues")).toBeTruthy();
    expect(await screen.findByTestId("dimension-bars")).toBeTruthy();
  });

  it("says no dimension is measured when the cell has no dimension score", () => {
    const cell = { module: "material_master", dimensions: {} } as unknown as LandscapeCell;
    renderWithQuery(<DimensionBars cell={cell} />);
    expect(screen.getByText("No dimension is measured yet")).toBeTruthy();
    expect(screen.queryByTestId("dimension-bars")).toBeNull();
  });

  it("offers the cleaning workbook once, in the downloads menu", async () => {
    open("ecc-production", "material-master", "cycle");
    const bar = await screen.findByTestId("object-bar");
    expect(within(bar).queryByText("Download workbook")).toBeNull();
    window.dispatchEvent(new Event("nx:download"));
    const menu = await screen.findByTestId("downloads-menu");
    expect(within(menu).getAllByText(/Cleaning workbook/).length).toBe(1);
  });
});
