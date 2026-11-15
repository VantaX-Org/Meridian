import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { ToastProvider } from "../../kit";
import { ZObjects } from "../ZObjects";
import { Writeback, structuredFixes } from "../Writeback";
import { GoldenWriteback } from "../GoldenWriteback";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const Q = vi.hoisted(() => ({ can: (_a: string): boolean => true, shared: false }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: Q.shared }) }));

const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  setUrl("/more?fixture=1");
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  Q.can = () => true;
  Q.shared = false;
});

describe("structuredFixes", () => {
  it("keeps only fixes the write-back route accepts", () => {
    const ok = { auto_fix: true, record_key: "MATNR=1", field: "MEINS", proposed_value: "EA" };
    expect(structuredFixes([ok, { ...ok, auto_fix: false }, { ...ok, proposed_value: null }, { ...ok, record_key: "" }, null])).toEqual([ok]);
    expect(structuredFixes(null)).toEqual([]);
  });
});

describe("Custom objects (next)", () => {
  it("shows the registry with a description beside each object", async () => {
    wrap(<ZObjects />);
    await waitFor(() => expect(screen.getByTestId("zobjects-stats")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Run detection/ })).toBeTruthy();
  });

  it("hides detection without the analyse permission", async () => {
    Q.can = (a) => a !== "analyse";
    wrap(<ZObjects />);
    await waitFor(() => expect(screen.getByText("Running detection needs the analyse permission.")).toBeTruthy());
    expect(screen.queryByTestId("zobjects-detect")).toBeNull();
  });
});

describe("Send fixes to SAP (next)", () => {
  it("checks with SAP, then sends for approval behind a confirm", async () => {
    wrap(<Writeback />);
    await waitFor(() => expect(screen.getByTestId("writeback-finding")).toBeTruthy());
    const send = screen.getByTestId("writeback-send") as HTMLButtonElement;
    expect(send.getAttribute("aria-disabled") === "true" || send.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("writeback-dryrun"));
    await waitFor(() => expect(screen.getByTestId("writeback-check")).toBeTruthy());
    expect(screen.getAllByText(/By BAPI/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("writeback-send"));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Send for approval" }));
    await waitFor(() => expect(screen.getByText(/Sent for approval/)).toBeTruthy());
  });

  it("offers no send without the apply permission", async () => {
    Q.can = (a) => a !== "apply";
    wrap(<Writeback />);
    await waitFor(() => expect(screen.getByText("Sending fixes to SAP needs the apply permission.")).toBeTruthy());
    expect(screen.queryByTestId("writeback-dryrun")).toBeNull();
  });
});

describe("Send golden records to SAP (next)", () => {
  it("lists golden records and opens one in the side panel", async () => {
    wrap(<GoldenWriteback />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows.length).toBeGreaterThan(1);
    fireEvent.click(rows[1]);
    await waitFor(() => expect(screen.getByRole("complementary")).toBeTruthy());
  });
});
