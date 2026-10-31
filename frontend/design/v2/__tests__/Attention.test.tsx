import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/v2/attention";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { Attention } from "../screens/Attention";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  undo = stubLayout();
  setUrl("/attention");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Action centre", () => {
  it("counts what needs the viewer and lists it most urgent first with the way to act", async () => {
    renderWithQuery(<Attention />);
    const banner = await screen.findByTestId("attention-banner");
    expect(banner.textContent).toMatch(/10 things need you/);
    const rows = within(screen.getByTestId("attention-table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent("14 fixes wait for your approval");
    expect(rows[0]).toHaveTextContent("Fixes waiting for approval");
    expect(within(rows[0]).getByRole("link", { name: "Review approvals" }).getAttribute("href")).toMatch(/^\/work\?filter=approvals/);
  });

  it("filters by kind and by system through the route", async () => {
    renderWithQuery(<Attention />);
    const form = await screen.findByTestId("attention-filter");
    const spy = vi.spyOn(api, "getAttention");
    fireEvent.change(within(form).getAllByRole("combobox")[1], { target: { value: "sys-ecc-prd" } });
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ kinds: "", system_id: "sys-ecc-prd" }));
    await waitFor(() => expect(within(screen.getByTestId("attention-table")).getAllByRole("row")).toHaveLength(5));
    // The system list keeps every system seen, so the filter can be widened again.
    expect(within(form).getAllByRole("combobox")[1]).toHaveTextContent("SuccessFactors");
  });
});
