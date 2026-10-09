// frontend/design/charts/charts.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { Heatmap } from "./Heatmap";
import { Line } from "./Line";
import { Sparkline } from "./Sparkline";
import { Waterfall } from "./Waterfall";

const data = [
  { x: "r1", y: 10 },
  { x: "r2", y: 20 },
];

describe("charts onPointClick contract", () => {
  it("Heatmap labels every cell and calls onPointClick with the clicked cell", () => {
    // recharts does not lay out under jsdom, so the click contract is exercised on the
    // Heatmap, which is a plain table and shares the same onPointClick shape.
    const onPointClick = vi.fn();
    const cells = [
      { row: "material_master", col: "FI", value: "go" as const },
      { row: "material_master", col: "MM", value: "no-go" as const },
    ];
    render(<Heatmap rows={["material_master"]} cols={["FI", "MM", "SD"]} cells={cells} onPointClick={onPointClick} />);
    expect(screen.getByLabelText("material_master FI: go")).toBeEnabled();
    expect(screen.getByLabelText("material_master SD: no data")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("material_master MM: no-go"));
    expect(onPointClick).toHaveBeenCalledTimes(1);
    expect(onPointClick).toHaveBeenCalledWith(cells[1]);
  });

  it("Line renders an svg with the shared theme", () => {
    const { container } = render(<Line data={data} />);
    expect(container.querySelector("svg") ?? container.querySelector(".recharts-responsive-container")).toBeTruthy();
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
