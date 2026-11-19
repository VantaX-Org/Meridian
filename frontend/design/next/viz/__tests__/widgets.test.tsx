import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RailWidget } from "../index";
import type { Viz } from "../../shell/pickViz";

const pt = (label: string, value: number) => ({ label, value });
const cases: Viz[] = [
  { kind: "pace", pct: 96, coverage: 0.9 },
  { kind: "line", points: [pt("2026-01-01", 1), pt("2026-02-01", 3)], nowIndex: 1 },
  { kind: "bars", items: [pt("A", 3), pt("B", 1)], keepOrder: false, more: 2 },
  { kind: "share", segs: [pt("A", 3), pt("B", 1)], total: 4 },
  { kind: "stat", figures: [pt("Held", 7)] },
  { kind: "compare", naive: pt("Simple count", -38), truth: pt("Net of returns", -2.2) },
  { kind: "source", rows: [{ source: "VBRK.NETWR", checks: ["C1", "C2"], n: 2 }] },
  { kind: "findings", items: ["Which objects are under 85?"] },
  { kind: "ledger", value: 1200, unit: "" },
];

describe("RailWidget", () => {
  it.each(cases.map((c) => [c.kind, c] as const))("%s renders a labelled section without a middle dot", (kind, viz) => {
    const { container } = render(<RailWidget viz={viz} onAsk={() => {}} />);
    expect(container.querySelector(`.nx-wg-${kind}[data-viz="${kind}"]`)?.getAttribute("aria-label")).toBeTruthy();
    expect(container.textContent).not.toMatch(new RegExp(String.fromCharCode(183)));
  });
  it("compare takes both labels from the data", () => {
    render(<RailWidget viz={cases[5]} onAsk={() => {}} />);
    expect(screen.getByText("Simple count")).toBeTruthy();
    expect(screen.getByText("Net of returns")).toBeTruthy();
    expect(screen.getByText("A spreadsheet sees")).toBeTruthy();
  });
  it("findings chip asks the suggestion", () => {
    const onAsk = vi.fn();
    render(<RailWidget viz={cases[7]} onAsk={onAsk} />);
    fireEvent.click(screen.getByRole("button", { name: /Ask Vera/ }));
    expect(onAsk).toHaveBeenCalledWith("Which objects are under 85?");
  });
  it("source caps at 6 rows", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ source: `S${i}`, checks: [], n: 1 }));
    const { container } = render(<RailWidget viz={{ kind: "source", rows }} onAsk={() => {}} />);
    expect(container.querySelectorAll("tr")).toHaveLength(6);
    expect(screen.getByText("2 more sources")).toBeTruthy();
  });
  it("none and map render nothing", () => {
    expect(render(<RailWidget viz={{ kind: "none" }} onAsk={() => {}} />).container.innerHTML).toBe("");
    expect(render(<RailWidget viz={{ kind: "map", never: true }} onAsk={() => {}} />).container.innerHTML).toBe("");
  });
});
