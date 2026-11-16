import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { getUrl, setUrl } from "@/design/v2/__tests__/nav-store";
import * as api from "@/lib/api/v2/catalogue";
import { parseOpen } from "@/lib/v2/hooks";
import { Catalogue } from "../Catalogue";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/more/master-data?tab=catalogue");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Data catalogue", () => {
  it("lists the tables and searches them", async () => {
    const spy = vi.spyOn(api, "getCatalogueTables");
    renderWithQuery(<Catalogue />);
    const tables = await screen.findByTestId("catalogue-tables");
    expect(within(tables).getByTestId("cat-table-MARA")).toBeInTheDocument();
    expect(within(tables).getAllByText("General Material Data").length).toBeGreaterThan(0);
    const form = screen.getByTestId("catalogue-search");
    await screen.findByRole("option", { name: "SuccessFactors" });
    fireEvent.change(within(form).getByRole("searchbox"), { target: { value: "employ" } });
    fireEvent.submit(form);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ q: "employ", system: "" }));
    expect(getUrl()).toContain("q=employ");
  });

  it("opens a table with its key and owners, and a field in the inspector", async () => {
    setUrl("/more/master-data?tab=catalogue&table=MARA");
    renderWithQuery(<Catalogue />);
    const head = await screen.findByTestId("catalogue-table");
    expect(head).toHaveTextContent("MATNR");
    expect(head).toHaveTextContent("T. van der Merwe");
    fireEvent.click(within(screen.getByTestId("catalogue-fields")).getByTestId("cat-field-MEINS"));
    await waitFor(() => expect(parseOpen(new URLSearchParams(getUrl().split("?")[1]).get("open"))).toEqual({ kind: "field", id: "MARA.MEINS" }));
    fireEvent.click(screen.getByRole("button", { name: "All tables" }));
    expect(await screen.findByTestId("catalogue-tables")).toBeInTheDocument();
  });

  it("finds fields by a business term and refuses an unknown table", async () => {
    setUrl("/more/master-data?tab=catalogue&view=fields&q=purchasing%20group");
    const { unmount } = renderWithQuery(<Catalogue />);
    expect(await screen.findByTestId("cat-hit-MARC.EKGRP")).toBeInTheDocument();
    unmount();
    setUrl("/more/master-data?tab=catalogue&table=NOPE");
    renderWithQuery(<Catalogue />);
    expect(await screen.findByText("This table is not in the catalogue.")).toBeInTheDocument();
  });

  it("retries after an error", async () => {
    const spy = vi.spyOn(api, "getCatalogueTables").mockRejectedValue(new Error("down"));
    renderWithQuery(<Catalogue />);
    expect(await screen.findByText("The data catalogue could not be read.", {}, { timeout: 4000 })).toBeInTheDocument();
    spy.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByTestId("catalogue-tables")).toBeInTheDocument();
  });
});
