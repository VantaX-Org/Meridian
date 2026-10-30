import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as landscapeApi from "@/lib/api/v2/landscape";
import { Inspector } from "../Inspector";
import { LineageTab, svgFileOf } from "../screens/object/LineageTab";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/o/ecc-production/material-master/lineage?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const tab = (module = "material-master") => renderWithQuery(<LineageTab system="ecc-production" module={module} />);
const graph = async () => {
  const svg = await screen.findByTestId("lineage-graph");
  await waitFor(() => expect(svg.querySelectorAll("[data-node]").length).toBeGreaterThan(20)); // the features land after the rules
  return svg;
};

describe("the Lineage tab", () => {
  it("draws tables, fields, rules and S/4 features as nodes, and the lines between them", async () => {
    tab();
    const svg = await graph();
    const count = (kind: string) => svg.querySelectorAll(`[data-kind="${kind}"]`).length;
    expect([count("table"), count("field"), count("rule"), count("feature")]).toEqual([3, 8, 8, 8]);
    expect(svg.querySelectorAll("line[data-edge]")).toHaveLength(26); // 8 table to field, 8 field to rule, 10 rule to feature
    expect(svg).toHaveAccessibleName("Lineage of Material master: 3 tables, 8 fields, 8 rules, 8 S/4 features");
    expect(svg.querySelector('line[data-edge="rule:MM142>feature:Migration cockpit: material load"]')).not.toBeNull();
  });

  it("uses 1 pixel non-scaling strokes, like the rule inspector's mini graph", () => {
    const css = readFileSync(join(__dirname, "..", "object.css"), "utf8");
    expect(css).toMatch(/\.m2-lineage line \{[^}]*stroke-width: 1;[^}]*vector-effect: non-scaling-stroke/);
    expect(css).toMatch(/\.m2-lineage rect \{[^}]*stroke-width: 1;[^}]*vector-effect: non-scaling-stroke/);
  });

  it("links a rule to the rule inspector and a feature to the feature inspector", async () => {
    tab();
    const svg = await graph();
    const rule = svg.querySelector('a[data-node="rule:MM142"]') as SVGAElement;
    expect(rule.getAttribute("href")).toContain("open=rule%3AMM142");
    const feature = svg.querySelector('a[data-node="feature:Migration cockpit: material load"]') as SVGAElement;
    expect(feature.getAttribute("href")).toContain("open=feature%3AMigration+cockpit%3A+material+load");
  });

  it("shows a node's facts in the side list on hover and on focus, with no tooltip", async () => {
    tab();
    const svg = await graph();
    const facts = screen.getByRole("complementary", { name: "Facts of the node" });
    expect(facts).toHaveTextContent("Hover or focus a node to see its facts here");
    fireEvent.mouseEnter(svg.querySelector('[data-node="rule:MM142"]') as Element);
    expect(norm(within(facts).getByTestId("node-facts"))).toContain("NameBase unit of measure MEINS must reference a valid entry in T006");
    expect(norm(within(facts).getByTestId("node-facts"))).toContain("SeverityHigh");
    expect(within(facts).getByRole("link", { name: "Open the rule" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM142"));
    fireEvent.mouseLeave(svg.querySelector('[data-node="rule:MM142"]') as Element);
    expect(facts).toHaveTextContent("Hover or focus a node");
    fireEvent.focus(svg.querySelector('[data-node="feature:MRP Live"]') as Element);
    const f = norm(within(facts).getByTestId("node-facts"));
    expect(f).toContain("StatusDegraded");
    expect(f).toContain("Blocking rulesMM023");
    expect(svg.querySelector("title")).toBeNull();
    expect(svg.querySelector('line[data-edge="rule:MM023>feature:MRP Live"]')).toHaveAttribute("data-on", "true");
  });

  it("pins the facts of a table or a field on click, and unpins on a second click", async () => {
    tab();
    const svg = await graph();
    const node = svg.querySelector('[data-node="field:MARA.MEINS"]') as Element;
    fireEvent.click(node);
    const facts = screen.getByRole("complementary", { name: "Facts of the node" });
    expect(norm(within(facts).getByTestId("node-facts"))).toContain("MeaningBase unit of measure");
    expect(node).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(node);
    expect(facts).toHaveTextContent("Hover or focus a node");
  });

  it("exports the graph as a standalone SVG file", async () => {
    const create = vi.fn(() => "blob:lineage");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    tab();
    await graph();
    fireEvent.click(screen.getByRole("button", { name: "Export as SVG" }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("The lineage was saved as an SVG file.")).toBeInTheDocument();
    const file = svgFileOf(screen.getByTestId("lineage-graph") as unknown as SVGSVGElement);
    expect(file).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(file).toContain("<style>");
    expect(file.match(/data-edge=/g)).toHaveLength(26);
  });

  it("is a designed empty state when no rule fails for the object", async () => {
    vi.spyOn(landscapeApi, "getObjectRules").mockResolvedValue([]);
    tab();
    const empty = await screen.findByTestId("empty-frame");
    expect(empty).toHaveTextContent(/Lineage for Material master fills when an analysis finds failing rules/);
    expect(within(empty).getByRole("link", { name: "Open the runs" })).toHaveAttribute("href", expect.stringContaining("/runs"));
  });
});

describe("the feature inspector", () => {
  const open = async (id: string) => {
    setUrl(`/o/ecc-production/material-master/lineage?open=feature:${id}&fixture=1`);
    renderWithQuery(<Inspector />);
    const d = await screen.findByRole("dialog");
    await waitFor(() => expect(within(d).queryByRole("region", { name: "Facts" }) ?? within(d).queryByTestId("empty-frame")).not.toBeNull());
    return d;
  };

  it("states blocked, the blocking rules as links, the records affected and the opportunity cost", async () => {
    const d = await open("Migration cockpit: material load");
    expect(d).toHaveAccessibleName("Migration cockpit: material load");
    expect(within(d).getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Facts", "Blocking rules: 2", "Opportunity cost", "Actions"]);
    const status = within(d).getByText("Status", { selector: "dt" }).closest(".m2-fact") as HTMLElement;
    expect(norm(status)).toBe("StatusBlocked");
    expect(norm(within(d).getByText("Records affected", { selector: "dt" }).closest(".m2-fact") as HTMLElement)).toBe("Records affected6,544");
    expect(within(d).getByRole("link", { name: "MM003" })).toHaveAttribute("href", expect.stringContaining("open=rule%3AMM003"));
    expect(within(d).getByText(/cannot go live while MM142 and MM003 fail/)).toBeInTheDocument();
  });

  it("states degraded for a degraded feature", async () => {
    const d = await open("MRP Live");
    expect(norm(within(d).getByText("Status", { selector: "dt" }).closest(".m2-fact") as HTMLElement)).toBe("StatusDegraded");
  });

  it("says so when the run has nothing blocking the feature", async () => {
    const d = await open("Feature nobody blocks");
    await waitFor(() => expect(within(d).getByTestId("empty-frame")).toHaveTextContent("No failing rule blocks or degrades this feature in this run."));
  });
});
