import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { connectivityCalls, resetConnectivityFixture } from "@/lib/api/v2/fixtures/connectivity";
import { ToastProvider } from "../../kit";
import { Connectivity } from "../system/Connectivity";
import { ProcessModel } from "../system/ProcessModel";
import { Mining } from "../system/Mining";
import { ZObjects } from "../ZObjects";
import { ConfigImpact } from "../ConfigImpact";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ can: (() => true) as (a: string) => boolean, shared: false }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: Q.shared }) }));

const ECC = "a1b2c3d4-0001-4000-8000-000000000001";
const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  setUrl(`/more/systems/${ECC}?fixture=1`);
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  Q.can = () => true;
  Q.shared = false;
  resetConnectivityFixture();
});

describe("Connectivity (next)", () => {
  it("lists the modules and pulls configuration behind a confirm", async () => {
    wrap(<Connectivity id={ECC} />);
    const table = await screen.findByRole("table", { name: "Modules of this system" });
    fireEvent.click(within(table).getAllByRole("checkbox")[1]);
    fireEvent.click(await screen.findByTestId("connectivity-pull"));
    const dialog = await screen.findByRole("alertdialog");
    expect(connectivityCalls.length).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Pull configuration" }));
    await waitFor(() => expect(connectivityCalls.some((c) => c.path === "/connectivity/config-sync")).toBe(true));
  });

  it("offers no test, pull or extract without trigger sync", async () => {
    Q.can = (a) => a !== "trigger_sync";
    wrap(<Connectivity id={ECC} />);
    expect(await screen.findByTestId("connectivity-denied")).toBeTruthy();
    expect(screen.queryByTestId("connectivity-health")).toBeNull();
    await screen.findByRole("table", { name: "Modules of this system" });
    expect(screen.queryAllByRole("checkbox").length).toBe(0);
  });
});

describe("Process model (next)", () => {
  it("lists discovery runs and shows the picked run's model", async () => {
    wrap(<ProcessModel id={ECC} />);
    expect(await screen.findByRole("table", { name: "Discovery runs" })).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("process-run-stats")).toBeTruthy());
    expect(await screen.findByRole("table", { name: "The as-is flow, step by step" })).toBeTruthy();
    expect(screen.getByTestId("process-export")).toBeTruthy();
  });

  it("hides the download without export_process", async () => {
    Q.can = (a) => a !== "export_process";
    wrap(<ProcessModel id={ECC} />);
    await waitFor(() => expect(screen.getByTestId("process-run")).toBeTruthy());
    expect(screen.queryByTestId("process-export")).toBeNull();
  });
});

describe("Mining (next)", () => {
  it("shows the mining totals and the process graph of an object", async () => {
    wrap(<Mining id={ECC} />);
    expect(await screen.findByTestId("mining-totals")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Material/ }));
    const graph = await screen.findByTestId("mining-graph");
    expect(within(graph).getByRole("table", { name: "Steps and the quality of their records" })).toBeTruthy();
  });

  it("is read-only, with no write action in any role", async () => {
    Q.can = () => false;
    wrap(<Mining id={ECC} />);
    await screen.findByTestId("mining-totals");
    expect(screen.queryByRole("button", { name: /Run|Re-run|Delete/ })).toBeNull();
  });
});

describe("Custom object sheet (next)", () => {
  it("opens a registry entry with its rules", async () => {
    setUrl("/more/z-objects?fixture=1");
    wrap(<ZObjects />);
    await screen.findByTestId("zobjects-stats");
    const row = (await screen.findAllByText("ZMARA_EXT"))[0].closest("tr") as HTMLElement;
    fireEvent.click(row);
    const sheet = await screen.findByTestId("zobject-sheet");
    await waitFor(() => expect(within(sheet).getByText("Rules on this object")).toBeTruthy());
  });
});

describe("Business process panel (next)", () => {
  it("opens a process step by step", async () => {
    setUrl("/more/config-impact?fixture=1");
    wrap(<ConfigImpact />);
    const table = await screen.findByRole("table", { name: "Business processes" });
    fireEvent.click((await within(table).findAllByText("Procure-to-Pay"))[0].closest("tr") as HTMLElement);
    expect(await screen.findByTestId("config-process")).toBeTruthy();
  });
});
