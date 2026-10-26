// frontend/design/charts/score-consistency.test.tsx
// The object map's layout and labels, the line chart's ticks, and the hero Rule's label collisions.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ObjectMap, mapLayout } from "./ObjectMap";
import { uniqueTicks } from "./Line";
import { heroLabels } from "../primitives/Rule";

describe("ObjectMap layout", () => {
  it("draws area in proportion to records above the minimum tile, with no ceiling at 12 cells", () => {
    const { spans } = mapLayout([800, 400, 100], 8, 8 * 60 + 7 * 4);
    const area = spans.map(([c, r]) => c * r);
    // 800 against 400 records: about twice the area, never the same capped tile.
    expect(area[0]).toBeGreaterThan(area[1]);
    expect(area[0] / area[1]).toBeGreaterThanOrEqual(1.6);
    expect(area[0] / area[1]).toBeLessThanOrEqual(2.4);
  });
  it("drops columns at a narrow width so a one-word tile stays readable", () => {
    const narrow = mapLayout([10, 10, 10], 12, 320);
    expect(narrow.columns).toBeLessThan(12);
    expect(narrow.columns).toBeGreaterThanOrEqual(2);
    const cellW = (320 - 4 * (narrow.columns - 1)) / narrow.columns;
    for (const [c] of narrow.spans) expect(c * cellW + (c - 1) * 4).toBeGreaterThanOrEqual(112);
  });
  it("prints one precision, a shape beside the tint, and the full name as the tile's title", () => {
    render(<ObjectMap items={[
      { id: "ap", label: "Accounts payable", href: "/objects/ap", score: 70, records: 50, verdict: "no-go" },
      { id: "mm", label: "Material master", href: "/objects/mm", score: 82.87, records: 500, verdict: "at-risk" },
    ]} />);
    const ap = screen.getByRole("link", { name: /Accounts payable/ });
    expect(ap).toHaveAttribute("title", "Accounts payable");
    expect(ap.textContent).toContain("70.0");
    expect(ap.querySelector("[role=img]")).toHaveAttribute("aria-label", "critical");
    expect(screen.getByRole("link", { name: /Material master/ }).textContent).toContain("82.9");
  });
});

describe("Line ticks", () => {
  it("never repeats a tick: later points sharing a minute read by their ordinal", () => {
    const ticks = uniqueTicks(["a", "b", "c", "d"], (x) => (x === "d" ? "17 Oct, 09:00" : "16 Oct, 05:17"));
    expect([...ticks.values()]).toEqual(["16 Oct, 05:17", "#2", "#3", "17 Oct, 09:00"]);
  });
});

describe("Rule hero labels", () => {
  it("drops the cap label when it would touch the target's at a phone width", () => {
    // Cap 70 and Target 90 on a 300px ruler: 60px apart, closer than the two labels need.
    expect(heroLabels(90, 70, 300).cap).toBe(false);
    // On a wide ruler both fit.
    expect(heroLabels(90, 70, 900).cap).toBe(true);
  });
  it("hides the 100 end label only when the target's label would touch it", () => {
    expect(heroLabels(90, undefined, 150).end).toBe(false);
    expect(heroLabels(90, undefined, 900).end).toBe(true);
    expect(heroLabels(60, undefined, 300).end).toBe(true);
  });
});
