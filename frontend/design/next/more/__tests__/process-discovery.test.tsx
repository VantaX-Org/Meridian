import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/discovery";
import { ToastProvider } from "../../kit";
import { ProcessDiscovery } from "../ProcessDiscovery";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: () => true, id: "me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const wrap = (el: ReactElement) => renderWithQuery(<ToastProvider>{el}</ToastProvider>);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/more/processes");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Process discovery", () => {
  it("shows the banner, the catalogue and the schedules", async () => {
    wrap(<ProcessDiscovery />);
    expect(await screen.findByTestId("pd-banner")).toBeInTheDocument();
    expect(screen.getByTestId("pd-catalogue")).toBeInTheDocument();
    expect(screen.getByTestId("pd-schedules")).toBeInTheDocument();
  });

  it("shows the run detail when a flow is opened", async () => {
    wrap(<ProcessDiscovery />);
    const open = await screen.findAllByText("Open flow");
    fireEvent.click(open[0]);
    expect(await screen.findByTestId("pd-flow")).toBeInTheDocument();
    expect(await screen.findByTestId("pd-variants")).toBeInTheDocument();
  });

  it("retries after an error", async () => {
    const spy = vi.spyOn(api, "getCatalogue").mockRejectedValue(new Error("down"));
    wrap(<ProcessDiscovery />);
    expect(await screen.findByText("The process discovery data could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
    spy.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByTestId("pd-banner")).toBeInTheDocument();
  });
});
