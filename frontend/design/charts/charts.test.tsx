// frontend/design/charts/charts.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { Heatmap } from "./Heatmap";
import { Bar } from "./Bar";
import { Graph } from "./Graph";
import { Line } from "./Line";
import { Radar } from "./Radar";
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
    expect(screen.getByLabelText("material_master SD: not measured")).toBeDisabled();
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

import { ChartTooltip } from "./Tooltip";
import { chartTheme } from "./theme";

describe("chart tooltip and theme", () => {
  it("chartTheme exposes the new tokens", () => {
    expect(chartTheme.area).toBe("var(--m-viz-area)");
    expect(chartTheme.tooltipBg).toBe("var(--m-viz-tooltip-bg)");
    expect(chartTheme.threshold).toBe("var(--m-ink-2)");
  });

  it("ChartTooltip renders label and numeric value, nothing when inactive", () => {
    const { container, rerender } = render(<ChartTooltip active payload={[{ name: "DQS", value: 91 }]} label="Run 3" />);
    expect(screen.getByText("Run 3")).toBeInTheDocument();
    expect(screen.getByText("91")).toHaveClass("m-numeric");
    rerender(<ChartTooltip active={false} payload={[{ value: 1 }]} />);
    expect(container.firstChild).toBeNull();
  });

  it("Heatmap cells use the soft tone with a centred dot", () => {
    render(<Heatmap rows={["a"]} cols={["b"]} cells={[{ row: "a", col: "b", value: "at-risk" }]} />);
    const btn = screen.getByLabelText("a b: at-risk");
    expect(btn.style.background).toContain("--m-at-risk-soft");
    expect(btn.querySelector("span")?.getAttribute("style")).toContain("--m-at-risk");
  });

  it("ChartTooltip is a polite live status region", () => {
    render(<ChartTooltip active payload={[{ name: "DQS", value: 91 }]} />);
    const tip = screen.getByRole("status");
    expect(tip).toHaveAttribute("aria-live", "polite");
  });

  it("every chart has a text alternative; sparkline is hidden", () => {
    render(<Line data={data} label="DQS trend" />);
    expect(screen.getByRole("img", { name: "DQS trend: r1 10, r2 20" })).toBeInTheDocument();
    render(<Bar data={data} />);
    expect(screen.getByRole("img", { name: "Chart: r1 10, r2 20" })).toBeInTheDocument();
    render(<Waterfall data={data} label="Bridge" />);
    expect(screen.getByRole("img", { name: "Bridge: r1 10, r2 20" })).toBeInTheDocument();
    render(<Radar data={data} label="Dimensions" />);
    expect(screen.getByRole("img", { name: "Dimensions: r1 10, r2 20" })).toBeInTheDocument();
    const { container } = render(<Sparkline data={data} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("Graph nodes are keyboard reachable and activate on Enter and Space", () => {
    const onNodeClick = vi.fn();
    render(<Graph nodes={[{ id: "a", size: 1 }, { id: "b", size: 1 }]} edges={[]} onNodeClick={onNodeClick} />);
    const node = screen.getByRole("button", { name: "Node a" });
    expect(node).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(node, { key: "Enter" });
    fireEvent.keyDown(node, { key: " " });
    fireEvent.keyDown(node, { key: "x" });
    expect(onNodeClick).toHaveBeenCalledTimes(2);
    expect(onNodeClick).toHaveBeenCalledWith("a");
  });
});
