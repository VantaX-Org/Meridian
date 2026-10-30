import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { LedgerSlot, RecordsTab, resetLedgerCache, type LedgerLoader, type LedgerProps } from "../screens/object/LedgerSlot";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetLedgerCache();
  setUrl("/o/ecc-production/material-master/records?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

function Probe(props: LedgerProps) {
  return <div data-testid="ledger" data-module={props.module} data-system={props.system} data-filters={JSON.stringify(props.filters ?? {})} />;
}

describe("the ledger slot", () => {
  it("shows a designed frame, not an error, when the ledger module is absent", async () => {
    const absent: LedgerLoader = () => Promise.reject(new Error("Cannot find module"));
    renderWithQuery(<LedgerSlot label="Material master" scope={{ module: "material_master" }} loader={absent} />);
    const frame = await screen.findByTestId("empty-frame");
    expect(frame).toHaveTextContent("The ledger of failing records for Material master could not be loaded here");
    expect(screen.getByRole("link", { name: "Open Work" })).toHaveAttribute("href", expect.stringContaining("/work?module=material_master"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("treats a module without a Ledger export as absent", async () => {
    renderWithQuery(<LedgerSlot label="MM014" scope={{}} loader={() => Promise.resolve({})} />);
    expect(await screen.findByTestId("empty-frame")).toBeInTheDocument();
  });

  it("holds the place with a skeleton while it loads, then renders the ledger with the scope it was given", async () => {
    let release: (m: { Ledger: typeof Probe }) => void = () => undefined;
    const loader: LedgerLoader = () => new Promise((res) => (release = res));
    renderWithQuery(<LedgerSlot label="MM014" scope={{ module: "material_master", filters: { check_id: "MM014" } }} loader={loader} />);
    expect(screen.getByTestId("ledger-loading")).toHaveAttribute("aria-busy", "true");
    release({ Ledger: Probe });
    const ledger = await screen.findByTestId("ledger");
    expect(ledger).toHaveAttribute("data-module", "material_master");
    expect(JSON.parse(ledger.getAttribute("data-filters") ?? "{}")).toEqual({ check_id: "MM014" });
  });

  it("the Records tab always shows something designed: the ledger when the build has it, the frame when it does not", async () => {
    renderWithQuery(<RecordsTab system="ecc-production" module="material-master" />);
    await waitFor(() => expect(screen.queryByTestId("ledger-loading")).toBeNull());
    expect(screen.queryByTestId("ledger") ?? screen.queryByTestId("empty-frame") ?? document.querySelector("[data-grid]")).not.toBeNull();
  });
});
