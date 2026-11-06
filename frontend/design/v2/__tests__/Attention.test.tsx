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

  it("leads with the list to act on, keeps the kind breakdown behind a disclosure and says opening changes nothing", async () => {
    renderWithQuery(<Attention />);
    const table = await screen.findByTestId("attention-table");
    const kinds = screen.getByTestId("attention-kinds");
    expect(table.compareDocumentPosition(kinds) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(kinds.closest("details")).not.toBeNull();
    expect(within(screen.getByTestId("flow-steps")).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByTestId("consequence")).toHaveTextContent(/changes nothing/);
    expect(screen.getByTestId("attention-primary")).toHaveClass("m2-strong");
  });

  it("says what to do next when nothing needs the viewer", async () => {
    vi.spyOn(api, "getAttention").mockResolvedValue({ items: [], total: 0, counts: { critical: 0, high: 0, medium: 0, low: 0 }, generated_at: new Date().toISOString() } as never);
    renderWithQuery(<Attention />);
    expect(await screen.findByText(/Nothing needs your attention\. New items appear here/)).toBeInTheDocument();
    expect(screen.queryByTestId("attention-primary")).toBeNull();
  });

  it("gives a retry when the list cannot be read", async () => {
    vi.spyOn(api, "getAttention").mockRejectedValue(new Error("down"));
    renderWithQuery(<Attention />);
    expect(await screen.findByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });
});
