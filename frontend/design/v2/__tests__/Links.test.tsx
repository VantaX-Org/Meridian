import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/v2/links";
import { Links } from "../screens/Links";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/links");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Record links", () => {
  it("shows the links with their meaning, source and the known types", async () => {
    renderWithQuery(<Links />);
    const banner = await screen.findByTestId("links-banner");
    expect(banner.textContent).toMatch(/records linked across objects/);
    const table = screen.getByTestId("links-table");
    expect(within(table).getAllByText("Business partner is a customer").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Inferred").length).toBe(2);
    expect(within(table).queryByText("Ended")).toBeNull();
    expect(await screen.findByTestId("links-known")).toHaveTextContent("BUT000");
  });

  it("finds the links of one record and can include ended links", async () => {
    renderWithQuery(<Links />);
    const form = await screen.findByTestId("links-search");
    const spy = vi.spyOn(api, "getLinks");
    fireEvent.change(within(form).getByRole("combobox"), { target: { value: "business_partner" } });
    fireEvent.click(within(form).getByRole("checkbox"));
    fireEvent.submit(form);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ domain: "business_partner", key: "", include_inactive: true }));
    expect(await within(screen.getByTestId("links-table")).findByText("Ended")).toBeInTheDocument();
  });

  it("says so when nothing has been discovered", async () => {
    vi.spyOn(api, "getLinks").mockResolvedValue({ relationships: [], total: 0 });
    renderWithQuery(<Links />);
    expect(await screen.findByText("No links have been discovered yet. Discovery runs with each sync of a system.")).toBeInTheDocument();
  });
});
