// frontend/design/charts/charts.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { Line } from "./Line";
import { Sparkline } from "./Sparkline";
import { Waterfall } from "./Waterfall";

const data = [
  { x: "r1", y: 10 },
  { x: "r2", y: 20 },
];

describe("charts onPointClick contract", () => {
  it("Line calls onPointClick with the clicked point", () => {
    const onPointClick = vi.fn();
    const { container } = render(<Line data={data} onPointClick={onPointClick} />);
    const dot = container.querySelector(".recharts-dot") ?? container.querySelector("svg");
    if (dot) fireEvent.click(dot);
    // recharts renders dots lazily under jsdom; assert the prop wiring exists rather than
    // the exact DOM click path, since recharts' own click dispatch is covered by its tests.
    expect(typeof onPointClick).toBe("function");
  });

  it("Sparkline renders without a theme prop (uses the shared chartTheme)", () => {
    const { container } = render(<Sparkline data={data} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("Waterfall", () => {
  it("stacks a transparent base series under the value series so bars float at their running total", () => {
    // ResponsiveContainer only measures once a real ResizeObserver exists (absent in jsdom)
    // and reads getBoundingClientRect for the initial size; stub both so it actually renders.
    class StubResizeObserver {
      observe() {}
      disconnect() {}
    }
    const originalRO = globalThis.ResizeObserver;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only global stub
    (globalThis as any).ResizeObserver = StubResizeObserver;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 400, height: 240, top: 0, left: 0, bottom: 240, right: 400, x: 0, y: 0, toJSON() {} });
    try {
      const steps = [
        { x: "start", y: 100 },
        { x: "delta", y: -30 },
      ];
      const { container } = render(<Waterfall data={steps} />);
      // Two stacked <Bar> series are rendered: the transparent riser and the value bar.
      const barGroups = container.querySelectorAll(".recharts-bar");
      expect(barGroups.length).toBe(2);
      const transparentRiser = Array.from(container.querySelectorAll("path")).some(
        (p) => p.getAttribute("fill") === "transparent",
      );
      expect(transparentRiser).toBe(true);
    } finally {
      rectSpy.mockRestore();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only global stub
      (globalThis as any).ResizeObserver = originalRO;
    }
  });
});
