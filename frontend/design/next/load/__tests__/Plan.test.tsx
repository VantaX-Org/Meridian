import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/v2/load-plan";
import { Plan } from "../Plan";
import { setUrl } from "@/design/v2/__tests__/nav-store";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/load/plan?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("load, plan", () => {
  it("orders the objects in steps and marks the no-go state", async () => {
    renderWithQuery(<Plan />);
    const banner = await screen.findByTestId("load-plan");
    expect(banner).toHaveAttribute("data-verdict", "no-go");
    expect(within(screen.getByTestId("lp-step-1")).getByTestId("lp-object-fi_gl")).toBeInTheDocument();
    expect(within(screen.getByTestId("lp-object-fi_gl")).getByText("No-go")).toBeInTheDocument();
  });

  it("blocks the objects that need a no-go object and names the field behind each dependency", async () => {
    renderWithQuery(<Plan />);
    expect((await screen.findByTestId("lp-blocked-accounts_payable")).textContent).toMatch(/Blocked until .+ is fixed/);
    expect(screen.queryByTestId("lp-blocked-material_master")).toBeNull();
    expect(within(screen.getByTestId("lp-edges")).getAllByText(/SKB1/).length).toBeGreaterThan(0);
  });

  it("says so when the plan cannot be read", async () => {
    vi.spyOn(api, "getLoadPlan").mockRejectedValue({ response: { status: 500 } });
    renderWithQuery(<Plan />);
    expect(await screen.findByText("The load plan could not be read.")).toBeInTheDocument();
  });
});
