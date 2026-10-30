import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as objectApi from "@/lib/api/v2/object";
import { resetObjectFixture } from "@/lib/api/v2/fixtures/object";
import { Inspector } from "../Inspector";
import { setUrl } from "./nav-store";

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

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  granted = "all";
  resetObjectFixture();
  setUrl("/o/ecc-production/material-master?open=rule:MM014&fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
async function open(): Promise<HTMLElement> {
  renderWithQuery(<Inspector />);
  const dialog = await screen.findByRole("dialog");
  await within(dialog).findByTestId("rule-name");
  return dialog;
}
const section = (d: HTMLElement, name: RegExp | string) => within(d).getByRole("region", { name });

describe("the rule inspector", () => {
  it("is named by the rule id and draws the sections in order: facts, definition, authority, scope, blocks, lineage, versions, contract, actions, history, watch, comments", async () => {
    const d = await open();
    expect(d).toHaveAccessibleName("MM014");
    expect(within(d).getByTestId("rule-name")).toHaveTextContent("Base unit of measure not valid");
    const names = within(d).getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(names).toEqual(["Facts", "Definition", "Authority", "Scope: 2 objects, 1 system", "Blocks: 3 S/4 features", "Lineage", "Versions", "Contract", "Actions", "History", "Watch", "Comments"]);
    expect(within(d).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(names);
  });

  it("states the facts: severity, dimension, field, tolerance, over tolerance, failing records across objects, failing % and value at risk", async () => {
    const d = await open();
    const facts = section(d, "Facts");
    const fact = (label: string | RegExp) => within(facts).getByText(label, { selector: "dt" }).closest(".m2-fact") as HTMLElement;
    expect(norm(fact("Severity"))).toBe("SeverityCritical");
    expect(norm(fact("Dimension"))).toBe("DimensionValidity");
    expect(norm(fact("Field"))).toContain("MARA.MEINS");
    await waitFor(() => expect(norm(fact(/^Tolerance/))).toContain("25 rows"));
    await waitFor(() => expect(norm(fact(/^Over tolerance/))).toContain("Yes"));
    expect(norm(fact("Failing records"))).toBe("Failing records4,212 across 2 objects");
    expect(norm(fact("Material master"))).toBe("Material master3,640");
    expect(norm(fact("Purchasing"))).toBe("Purchasing572");
    expect(norm(fact(/^Failing %/))).toContain("4.99% of 84,456 records checked");
    await waitFor(() => expect(norm(fact(/^Value at risk/))).toMatch(/1\.18 ?m/));
  });

  it("has an i on tolerance, over tolerance, failing % and value at risk that reads /explain", async () => {
    const d = await open();
    fireEvent.click(within(section(d, "Facts")).getByRole("button", { name: "About Failing %" }));
    const pop = await screen.findByTestId("explain");
    await waitFor(() => expect(pop).toHaveTextContent("3,640 of 61,816 records checked fail MM014"));
  });

  it("gives the definition: check class, field, expression and parameters", async () => {
    const d = await open();
    const def = norm(section(d, "Definition"));
    expect(def).toContain("Allowed values");
    expect(def).toContain("MARA-MEINS in T006-MSEHI");
    expect(def).toContain("Check table");
    expect(def).toContain("T006");
    expect(def).toContain("Shipped with Meridian");
  });

  it("names the authority and why it matters", async () => {
    const d = await open();
    const a = norm(section(d, "Authority"));
    expect(a).toContain("SAP hard constraint");
    expect(a).toContain("Goods movements and MRP cannot post for a material whose base unit is not an ISO unit.");
  });

  it("links every object and system in the scope", async () => {
    const d = await open();
    const scope = section(d, /^Scope/);
    expect(within(scope).getByRole("link", { name: "Material master" })).toHaveAttribute("href", expect.stringMatching(/\/o\/ecc-production\/material-master/));
    expect(within(scope).getByRole("link", { name: "Purchasing" })).toHaveAttribute("href", expect.stringMatching(/\/o\/ecc-production\/purchasing/));
    expect(within(scope).getByRole("link", { name: "ECC production" })).toHaveAttribute("href", expect.stringContaining("open=system%3A"));
  });

  it("links the S/4 features it blocks", async () => {
    const d = await open();
    const blocks = section(d, /^Blocks/);
    const links = within(blocks).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links.map((l) => l[0])).toEqual(["Migration cockpit: material load", "Material ledger actual costing", "Embedded EWM product master"]);
    expect(links[0][1]).toContain("open=feature%3AMigration+cockpit%3A+material+load");
    expect(within(blocks).getAllByText("Blocked")).toHaveLength(3);
  });

  it("draws the lineage field to rule to features as 1 pixel SVG lines, with the features as links", async () => {
    const d = await open();
    const svg = within(section(d, "Lineage")).getByTestId("lineage");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg).toHaveAttribute("role", "group");
    expect(svg).toHaveAccessibleName("Lineage: MARA.MEINS to MM014 to blocked features");
    expect(Array.from(svg.querySelectorAll("text")).map((t) => t.textContent)).toEqual(expect.arrayContaining(["MARA.MEINS", "MM014", "Migration cockpit: …", "Material ledger act…", "Embedded EWM produc…"]));
    expect(svg.querySelectorAll("line")).toHaveLength(4); // field to rule, then rule to each of the three features
    expect(svg.querySelectorAll("a")).toHaveLength(3);
    expect(svg.querySelectorAll("rect")).toHaveLength(2 + 3);
    // The lines are 1 pixel whatever the scale: the stylesheet says so and keeps them non-scaling.
    const css = readFileSync(join(__dirname, "..", "object.css"), "utf8");
    expect(css).toMatch(/\.m2-lineage line \{[^}]*stroke-width: 1;[^}]*vector-effect: non-scaling-stroke/);
    expect(css).toMatch(/\.m2-lineage rect \{[^}]*stroke-width: 1;[^}]*vector-effect: non-scaling-stroke/);
  });

  it("lists the versions and the shipped identity", async () => {
    const d = await open();
    const v = section(d, "Versions");
    expect(norm(v)).toContain("Version 4, active: Domain list refreshed from the SAP check table. By K. Mokoena.");
    expect(norm(v)).toContain("Version 1, retired");
    expect(norm(v)).toContain("Shipped definition sap/rules/material_master.yaml, content hash 9f3c2a7b41d0, Meridian 2.14.0.");
  });

  it("shows the contracts that name the rule or set a threshold on its dimension", async () => {
    const d = await open();
    const c = section(d, "Contract");
    expect(within(c).getAllByText("MD-MATERIAL, version 3")).toHaveLength(2);
    expect(norm(c)).toContain("names this rule");
    expect(norm(c)).toContain("minimum 90 for validity");
  });

  it("reads the history: runs and versions, newest first", async () => {
    const d = await open();
    const h = section(d, "History");
    await waitFor(() => expect(within(h).getAllByRole("listitem").length).toBeGreaterThanOrEqual(5));
    const items = within(h).getAllByRole("listitem").map(norm);
    expect(items[0]).toBe("16 Oct 2026Run 16 Oct 2026: 3,640 failing in Material master");
    expect(items[1]).toMatch(/^2 Oct 2026Run 2 Oct 2026: 3,736 failing in Material master$/);
    expect(items[2]).toMatch(/Version 4: Domain list refreshed/);
    expect(within(h).getByRole("link", { name: "Run 16 Oct 2026" })).toHaveAttribute("href", expect.stringContaining("open=run%3A"));
  });
});

describe("actions by role", () => {
  it("offers a lead every verb: open, failing records, suppress, edit in authoring, hand to a steward", async () => {
    const d = await open();
    const a = section(d, "Actions");
    expect(within(a).getByRole("link", { name: "Open the rule" })).toHaveAttribute("href", expect.stringContaining("/r/MM014"));
    expect(within(a).getByRole("link", { name: "Open failing records" })).toHaveAttribute("href", expect.stringContaining("/r/MM014?tab=failing"));
    expect(within(a).getByRole("button", { name: "Suppress" })).toBeInTheDocument();
    expect(within(a).getByRole("link", { name: "Edit in authoring" })).toHaveAttribute("href", expect.stringContaining("/rules?view=drafts&module=material_master"));
    expect(within(a).getByRole("button", { name: "Hand to a steward" })).toBeInTheDocument();
  });

  it("offers a viewer only the reading links, and says why", async () => {
    granted = ["view"];
    const d = await open();
    const a = section(d, "Actions");
    expect(within(a).queryByRole("button", { name: "Suppress" })).toBeNull();
    expect(within(a).queryByRole("link", { name: "Edit in authoring" })).toBeNull();
    expect(within(a).queryByRole("button", { name: "Hand to a steward" })).toBeNull();
    expect(within(a).getByRole("link", { name: "Open failing records" })).toBeInTheDocument();
    expect(norm(a)).toContain("Your role can read this rule.");
  });

  it("gives a rule manager Edit in authoring but not Suppress", async () => {
    granted = ["view", "manage_rules"];
    const d = await open();
    const a = section(d, "Actions");
    expect(within(a).getByRole("link", { name: "Edit in authoring" })).toBeInTheDocument();
    expect(within(a).queryByRole("button", { name: "Suppress" })).toBeNull();
  });

  it("suppresses with a reason and a period, through the suppression endpoint", async () => {
    const spy = vi.spyOn(objectApi, "suppressRule").mockResolvedValue({ id: "s1", check_id: "MM014", expires_at: "x" });
    const d = await open();
    fireEvent.click(within(section(d, "Actions")).getByRole("button", { name: "Suppress" }));
    const form = within(d).getByRole("form", { name: "Suppress MM014" });
    fireEvent.change(within(form).getByLabelText("Reason"), { target: { value: "Waiting for the unit table refresh" } });
    fireEvent.change(within(form).getByLabelText("For"), { target: { value: "60" } });
    fireEvent.click(within(form).getByRole("button", { name: "Suppress rule" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const [id, reason, expires] = spy.mock.calls[0];
    expect([id, reason]).toEqual(["MM014", "Waiting for the unit table refresh"]);
    expect(new Date(expires).getTime() - Date.now()).toBeGreaterThan(59 * 86_400_000);
    expect(await within(d).findByRole("status")).toHaveTextContent("MM014 is suppressed until the date you set.");
  });

  it("hands the rule to a steward with a note and a due date", async () => {
    const spy = vi.spyOn(objectApi, "handOffRule").mockResolvedValue({ task_id: "t", exception_id: "e", assigned_to: "u-naidoo", due_at: "x" });
    const d = await open();
    fireEvent.click(within(section(d, "Actions")).getByRole("button", { name: "Hand to a steward" }));
    const form = within(d).getByRole("form", { name: "Hand MM014 to a steward" });
    await within(form).findByRole("option", { name: "A. Naidoo" });
    fireEvent.change(within(form).getByLabelText("Steward"), { target: { value: "u-naidoo" } });
    fireEvent.change(within(form).getByLabelText("Note"), { target: { value: "Fix the unit table first" } });
    fireEvent.change(within(form).getByLabelText("Due"), { target: { value: "2026-11-02" } });
    fireEvent.click(within(form).getByRole("button", { name: "Hand over" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0][0]).toMatchObject({ check_id: "MM014", module: "material_master", assignee_id: "u-naidoo", note: "Fix the unit table first", due_date: "2026-11-02" });
    expect(await within(d).findByRole("status")).toHaveTextContent("MM014 is handed over");
  });
});

describe("states", () => {
  it("says so when the rule cannot be read, and still offers the rule canvas", async () => {
    setUrl("/?open=rule:ZZ999&fixture=1");
    renderWithQuery(<Inspector />);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByTestId("error-frame")).toHaveTextContent("This rule could not be read.");
    expect(within(dialog).getByRole("link", { name: "Open the rule" })).toHaveAttribute("href", expect.stringContaining("/r/ZZ999"));
  });

  it("holds the layout with a skeleton while the rule loads", async () => {
    renderWithQuery(<Inspector />);
    expect(await screen.findByTestId("rule-loading")).toHaveAttribute("aria-busy", "true");
  });
});
