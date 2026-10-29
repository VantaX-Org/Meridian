import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as mdm from "@/lib/api/v2/mdm";
import { resetMdmFixture } from "@/lib/api/v2/fixtures/mdm";
import { Inspector } from "../Inspector";
import { GlossaryTab } from "../screens/object/GlossaryTab";
import { setUrl, getUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let granted: string[] | "all" = "all";
vi.mock("@/lib/v2/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/v2/hooks")>();
  return {
    ...actual,
    useV2Session: () => ({ persona: "lead" as const, label: "Programme lead", name: "Test", email: null, fixture: true, can: (a: string) => granted === "all" || granted.includes(a) }),
  };
});

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  window.localStorage.clear();
  granted = "all";
  resetMdmFixture();
  undo = stubLayout();
  setUrl("/v2/o/ecc-production/material-master/glossary?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const tab = (module = "material-master") => renderWithQuery(<GlossaryTab system="ecc-production" module={module} />);
const gridRows = async () => {
  const grid = await screen.findByRole("grid", { name: "Business terms of Material master" });
  await waitFor(() => expect(within(grid).getAllByRole("row").length).toBeGreaterThan(1));
  return { grid, rows: within(grid).getAllByRole("row").slice(1) };
};

describe("the Glossary tab", () => {
  it("lists the object's terms: term, definition, SAP field, owner, status, linked rules", async () => {
    tab();
    const { grid, rows } = await gridRows();
    expect(within(grid).getAllByRole("columnheader").map((h) => norm(h))).toEqual(["Term", "Definition", "SAP field", "Owner", "Status", "Rules"]);
    expect(rows).toHaveLength(6);
    const first = within(rows[0]).getAllByRole("gridcell").map((c) => norm(c));
    expect(first[0]).toBe("Base unit of measure");
    expect(first[1]).toMatch(/^The unit in which stock of the material is managed/);
    expect(first[2]).toBe("MARA-MEINS");
    expect(first[3]).toBe("T. van der Merwe");
    expect(first[4]).toBe("Active");
    expect(first[5]).toBe("1");
    expect(norm(within(rows[2]).getAllByRole("gridcell")[4])).toBe("Under review");
    expect(screen.getByText("6 terms")).toBeInTheDocument();
  });

  it("searches the terms by name or field", async () => {
    tab();
    await gridRows();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search terms" }), { target: { value: "weight" } });
    await waitFor(() => expect(screen.getByText("1 found of 6")).toBeInTheDocument());
    const { rows } = await gridRows();
    expect(rows).toHaveLength(1);
    expect(norm(rows[0])).toContain("Gross weight");
  });

  it("opens a term in the inspector from a row", async () => {
    tab();
    const { rows } = await gridRows();
    fireEvent.click(rows[1]);
    expect(getUrl()).toContain("open=term%3Agt-mtart");
  });

  it("counts the fields without a term and lists them with the rules that read them", async () => {
    tab();
    const sec = await screen.findByRole("region", { name: "Fields without a term" });
    const list = await within(sec).findByRole("list", { name: "Fields without a term" });
    expect(within(sec).getByText("2")).toBeInTheDocument();
    const items = within(list).getAllByRole("listitem");
    expect(items.map((i) => norm(i))).toEqual(["MBEW.BKLASMM091", "MARC.BESKZMM105"]);
    expect(within(items[0]).getByRole("link", { name: "MM091" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM091"));
  });

  it("offers to draft terms from the rule library by permission", async () => {
    const populate = vi.spyOn(mdm, "populateGlossary");
    tab();
    await gridRows();
    fireEvent.click(screen.getByRole("button", { name: "Add terms from the rule library" }));
    expect(await screen.findByTestId("action-result")).toHaveTextContent(/2 terms drafted/);
    expect(populate).toHaveBeenCalledTimes(1);
  });

  it("without the approve permission there is no add button", async () => {
    granted = [];
    tab();
    await gridRows();
    expect(screen.queryByRole("button", { name: /Add terms/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Open the glossary" })).toHaveAttribute("href", "/mdm/glossary");
  });

  it("is a designed empty state for an object with no terms, with what would put rows here", async () => {
    tab("purchasing");
    const empty = await screen.findByTestId("empty-frame");
    expect(empty).toHaveTextContent(/No business terms are linked to Purchasing yet\. A data owner links a term to a field, or drafts them from the rules of the object/);
    expect(within(empty).getByRole("button", { name: "Draft terms from the rule library" })).toBeInTheDocument();
  });
});

describe("the term inspector", () => {
  const open = async (id = "gt-meins") => {
    setUrl(`/v2/o/ecc-production/material-master/glossary?open=term:${id}&fixture=1`);
    renderWithQuery(<Inspector />);
    const d = await screen.findByRole("dialog");
    await within(d).findByRole("region", { name: /Rules that cite it/ });
    return d;
  };

  it("draws facts, definition, the rules that cite it, fields, actions and history", async () => {
    const d = await open();
    expect(d).toHaveAccessibleName("Base unit of measure");
    expect(within(d).getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Facts", "Definition", "Rules that cite it: 1", "Fields", "Actions", "History"]);
    expect(norm(within(d).getByText("SAP field", { selector: "dt" }).closest(".m2-fact") as HTMLElement)).toBe("SAP fieldMARA-MEINS");
    const rules = within(d).getByRole("list", { name: "Rules that cite this term" });
    expect(within(rules).getByRole("link", { name: "MM014" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM014"));
    const fields = within(d).getByRole("list", { name: "Fields this term governs" });
    expect(norm(fields)).toBe("MARA.MEINSBase unit of measure");
  });

  it("edits the wording by permission and saves it", async () => {
    const update = vi.spyOn(mdm, "updateTerm");
    const d = await open();
    fireEvent.click(within(d).getByRole("button", { name: "Edit" }));
    fireEvent.change(within(d).getByLabelText("Term"), { target: { value: "Base unit" } });
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    expect(await within(d).findByTestId("action-result")).toHaveTextContent("Term saved");
    expect(update).toHaveBeenCalledWith("gt-meins", expect.objectContaining({ business_name: "Base unit" }));
  });

  it("approves a term under review: it becomes active and is marked reviewed", async () => {
    const update = vi.spyOn(mdm, "updateTerm");
    const review = vi.spyOn(mdm, "reviewTerm");
    const d = await open("gt-matkl");
    fireEvent.click(within(d).getByRole("button", { name: "Approve" }));
    expect(await within(d).findByTestId("action-result")).toHaveTextContent("Term approved");
    expect(update).toHaveBeenCalledWith("gt-matkl", { status: "active" });
    expect(review).toHaveBeenCalledWith("gt-matkl");
  });

  it("without the approve permission it is read-only", async () => {
    granted = [];
    const d = await open();
    expect(within(d).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(d).queryByRole("button", { name: /Approve|Mark as reviewed/ })).toBeNull();
    expect(within(d).getByText(/needs the approve permission/)).toBeInTheDocument();
  });
});
