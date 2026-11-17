import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { FindingsCard, MonitorStrip, OldRunGate, RelatedObjects } from "./ObjectExtras";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.history.replaceState(null, "", "/o/ecc-production/material-master?fixture=1");
});
afterEach(() => undo());

describe("ObjectExtras", () => {
  it("the monitor strip shows the last and next run and the drift since the previous run", async () => {
    renderWithQuery(<MonitorStrip module="material_master" />);
    const strip = await screen.findByTestId("monitor-strip");
    for (const label of ["Last run", "Next run", "Newly failing", "Recovered"]) expect(within(strip).getByText(label)).toBeTruthy();
  });

  it("related objects link to each object and say which upstream object to fix first", async () => {
    renderWithQuery(<RelatedObjects system="ecc-production" module="material_master" />);
    const table = await screen.findByRole("group", { name: "Related objects" });
    const links = within(table).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute("href")).toContain("/o/ecc-production/");
  });

  it("lists the Aletheia findings for material master with their action, and none on an old run", async () => {
    const { unmount } = renderWithQuery(<FindingsCard system="ecc-production" module="material_master" latest />);
    const table = await screen.findByRole("group", { name: "Aletheia found" });
    expect(within(table).getByText("MM003")).toBeTruthy();
    expect(within(table).getByRole("button", { name: "Draft cleansing batch" })).toBeTruthy();
    unmount();
    renderWithQuery(<FindingsCard system="ecc-production" module="material_master" latest={false} />);
    const old = await screen.findByRole("group", { name: "Aletheia found" });
    expect(within(old).queryByRole("button", { name: "Draft cleansing batch" })).toBeNull();
    expect(within(old).getAllByText("Open the current run to act").length).toBeGreaterThan(0);
  });

  it("assigns an owner to a finding with no owner", async () => {
    renderWithQuery(<FindingsCard system="ecc-production" module="sd_customer_master" latest />);
    const select = await screen.findByRole("combobox", { name: "Owner of SDCM001" });
    await waitFor(() => expect(within(select).getAllByRole("option").length).toBeGreaterThan(1));
    fireEvent.change(select, { target: { value: "u-an" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(await screen.findByText("Owner assigned")).toBeTruthy();
  });

  it("the old-run gate disables its actions and says why", () => {
    renderWithQuery(<OldRunGate runId="v-11" latest="v-12"><button type="button">Act</button></OldRunGate>);
    expect(screen.getByTestId("action-gate-reason").textContent).toBe("Open the current run to act");
    expect((screen.getByTestId("action-gate") as HTMLFieldSetElement).disabled).toBe(true);
  });

  it("the old-run gate is transparent on the current run", () => {
    renderWithQuery(<OldRunGate runId="v-12" latest="v-12"><button type="button">Act</button></OldRunGate>);
    expect(screen.queryByTestId("action-gate")).toBeNull();
    expect(screen.getByRole("button", { name: "Act" })).toBeTruthy();
  });
});
