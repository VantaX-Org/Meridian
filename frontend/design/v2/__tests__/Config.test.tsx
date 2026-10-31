import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as config from "@/lib/api/v2/config";
import { Config } from "../screens/Config";
import { stubLayout } from "./layout-stub";

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

describe("configuration", () => {
  it("draws every process as a chain, marks the worst step, and lists findings worst first", async () => {
    renderWithQuery(<Config />);
    const flows = await screen.findByTestId("config-processes");
    expect(await within(flows).findByText("Procure-to-pay")).toBeInTheDocument();
    expect(flows.querySelector('.m2-cf-step[data-worst] .m2-cf-name')).toHaveTextContent("Invoice Receipt");
    expect(flows.querySelector('.m2-cf-flow[data-status="inactive"]')).toHaveTextContent("Not run in this system");
    const rows = within(screen.getByTestId("config-findings")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("Critical");
    expect(rows.at(-1)).not.toHaveTextContent("Critical");
    expect(screen.getByTestId("config-changes")).toHaveTextContent("Removed");
  });

  it("asks for an analysis when no config run is stored", async () => {
    const e = Object.assign(new Error("not found"), { response: { status: 404 } });
    vi.spyOn(config, "getConfigAlignment").mockRejectedValue(e);
    vi.spyOn(config, "getConfigInventory").mockRejectedValue(e);
    renderWithQuery(<Config />);
    expect(await screen.findByText("Run an analysis on an SAP system to read its configuration.")).toBeInTheDocument();
  });
});
