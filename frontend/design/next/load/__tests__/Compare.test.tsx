import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/v2/compare";
import { ToastProvider } from "../../kit";
import { Compare } from "../Compare";
import { setUrl } from "@/design/v2/__tests__/nav-store";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/load/compare?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const view = () => renderWithQuery(<ToastProvider><Compare /></ToastProvider>);

describe("load, compare", () => {
  it("lists the fixture pairs and starts a comparison", async () => {
    view();
    const pairs = await screen.findByTestId("cmp-pairs");
    expect(within(pairs).getAllByRole("link")[0].getAttribute("href")).toMatch(/^\/load\/compare\?pair=pair-0001/);
    fireEvent.click(within(pairs).getAllByRole("button", { name: "Compare now" })[0]);
    expect(await screen.findByText("Comparison started")).toBeInTheDocument();
  });

  it("opens a pair from the address", async () => {
    setUrl("/load/compare?fixture=1&pair=pair-0001");
    view();
    expect(await screen.findByTestId("cmp-banner")).toBeInTheDocument();
  });

  it("tells a role without access that it cannot read the comparisons", async () => {
    vi.spyOn(api, "getPairs").mockRejectedValue({ response: { status: 403 } });
    view();
    expect(await screen.findByText("Your role cannot read the system comparisons.")).toBeInTheDocument();
  });
});
