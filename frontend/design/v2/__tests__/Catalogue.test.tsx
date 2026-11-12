import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as api from "@/lib/api/v2/catalogue";
import { parseOpen } from "@/lib/v2/hooks";
import { Catalogue } from "../screens/Catalogue";
import { FieldInspector } from "../inspector/field";
import { stubLayout } from "./layout-stub";
import { getUrl, setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/catalogue");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Data catalogue", () => {
  it("lists the tables with their rules, objects and systems", async () => {
    renderWithQuery(<Catalogue />);
    const tables = await screen.findByTestId("catalogue-tables");
    expect(within(tables).getByText("MARA")).toBeInTheDocument();
    expect(within(tables).getByText("General Material Data")).toBeInTheDocument();
    expect(within(tables).getByText("ZMM_PLANT_EXT")).toBeInTheDocument();
    expect(within(tables).getAllByText("ECC production, S/4HANA sandbox").length).toBeGreaterThan(0);
    expect(screen.getByRole("option", { name: "SuccessFactors" })).toBeInTheDocument();
  });

  it("searches the tables and narrows them to one system", async () => {
    const spy = vi.spyOn(api, "getCatalogueTables");
    renderWithQuery(<Catalogue />);
    const form = await screen.findByTestId("catalogue-search");
    await screen.findByRole("option", { name: "SuccessFactors" });
    fireEvent.change(within(form).getByRole("searchbox"), { target: { value: "employ" } });
    fireEvent.change(within(form).getAllByRole("combobox")[1], { target: { value: "a1b2c3d4-0003-4000-8000-000000000003" } });
    fireEvent.submit(form);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ q: "employ", system: "a1b2c3d4-0003-4000-8000-000000000003" }));
    expect(getUrl()).toContain("q=employ");
    const tables = await screen.findByTestId("catalogue-tables");
    await waitFor(() => expect(within(tables).queryByText("MARA")).toBeNull());
    expect(within(tables).getByText("EMPEMPLOYMENT")).toBeInTheDocument();
  });

  it("opens a table with its key, owners and fields, and a field in the inspector", async () => {
    setUrl("/catalogue?table=MARA");
    renderWithQuery(<Catalogue />);
    const head = await screen.findByTestId("catalogue-table");
    expect(head).toHaveTextContent("MATNR");
    expect(head).toHaveTextContent("T. van der Merwe");
    const fields = screen.getByTestId("catalogue-fields");
    expect(within(fields).getByText("Base unit of measure")).toBeInTheDocument();
    fireEvent.click(within(fields).getByText("MEINS"));
    await waitFor(() => expect(parseOpen(new URLSearchParams(getUrl().split("?")[1]).get("open"))).toEqual({ kind: "field", id: "MARA.MEINS" }));
    fireEvent.click(screen.getByRole("button", { name: "All tables" }));
    expect(await screen.findByTestId("catalogue-tables")).toBeInTheDocument();
  });

  it("finds fields by a business term", async () => {
    setUrl("/catalogue?view=fields&q=purchasing%20group");
    renderWithQuery(<Catalogue />);
    const hits = await screen.findByTestId("catalogue-field-hits");
    expect(within(hits).getByText("MARC-EKGRP")).toBeInTheDocument();
  });

  it("says what failed and when nothing matches", async () => {
    vi.spyOn(api, "getCatalogueTables").mockResolvedValue({ total: 0, limit: 200, offset: 0, systems: [], tables: [] });
    setUrl("/catalogue?q=nothing");
    renderWithQuery(<Catalogue />);
    expect(await screen.findByText("No table matches this search.")).toBeInTheDocument();
  });

  it("refuses an unknown table in words", async () => {
    setUrl("/catalogue?table=NOPE");
    renderWithQuery(<Catalogue />);
    expect(await screen.findByText("This table is not in the catalogue.")).toBeInTheDocument();
  });
});

describe("the field inspector", () => {
  it("shows the facts, profile, rules, term, owners and lineage of a field", async () => {
    renderWithQuery(<FieldInspector id="MARA.MEINS" onClose={() => undefined} />);
    expect(await screen.findByText("Latest profile")).toBeInTheDocument();
    expect(screen.getByText("MARA-MEINS")).toBeInTheDocument();
    expect(screen.getByText("Open the profile of this run")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Base unit of measure" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Rules that check it" }).children.length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: "Where its values go" })).toHaveTextContent("Basic data view");
    expect(screen.getByText("Owner T. van der Merwe, Steward A. Naidoo")).toBeInTheDocument();
  });

  it("says so for a field the table does not have and an address that names none", async () => {
    renderWithQuery(<FieldInspector id="MARA.NOPE" onClose={() => undefined} />);
    expect(await screen.findByText("The table has no field of this name.")).toBeInTheDocument();
  });
});
