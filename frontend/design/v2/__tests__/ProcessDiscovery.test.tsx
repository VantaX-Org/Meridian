import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ProcessDiscovery } from "../screens/ProcessDiscovery";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/processes");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("process discovery", () => {
  it("lists every L1 with its mined figures and opens a run", async () => {
    renderWithQuery(<ProcessDiscovery />);
    expect(await screen.findByTestId("pd-banner")).toBeInTheDocument();
    const cat = await screen.findByTestId("pd-catalogue");
    expect(await within(cat).findByTestId("pd-open-PTP")).toBeInTheDocument();
    fireEvent.click(within(cat).getByTestId("pd-open-PTP"));
    expect(await screen.findByTestId("pd-flow")).toBeInTheDocument();
  });

  it("drills into a step and shows a case's events", async () => {
    setUrl("/processes?run=pd-run-ptp");
    renderWithQuery(<ProcessDiscovery />);
    fireEvent.click(await screen.findByTestId("pd-node-PTP.2"));
    expect(await screen.findByTestId("pd-node-PTP.2.1")).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId("pd-case-4500018231/00010"));
    expect(await screen.findByTestId("pd-case-events")).toBeInTheDocument();
  });
});
