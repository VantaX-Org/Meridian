// frontend/design/charts/charts.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { Heatmap, toneOfTier } from "./Heatmap";
import { Pareto } from "./Pareto";
import { Bar } from "./Bar";
import { Graph, GraphLegend } from "./Graph";
import { ChartLegend, isolatedOpacity } from "./Legend";
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

  it("Heatmap tone cells use the soft tone with a 2px left bar and no dot", () => {
    render(<Heatmap rows={["a"]} cols={["b"]} cells={[{ row: "a", col: "b", value: "at-risk" }]} />);
    const btn = screen.getByLabelText("a b: at-risk");
    expect(btn.style.background).toContain("--m-at-risk-soft");
    expect(btn.style.boxShadow).toContain("inset 2px 0 0");
    expect(btn.style.boxShadow).toContain("--m-at-risk");
    expect(btn.querySelector("span")).toBeNull();
  });

  it("Heatmap seq mode fills by quintile and writes the value in seqInk", () => {
    render(
      <Heatmap
        mode="seq"
        rows={["a"]}
        cols={["lo", "hi"]}
        cells={[{ row: "a", col: "lo", value: 5 }, { row: "a", col: "hi", value: 95 }]}
      />,
    );
    const lo = screen.getByLabelText("a lo: 5");
    const hi = screen.getByLabelText("a hi: 95");
    expect(lo.style.background).toContain("--m-seq-1");
    expect(lo.style.color).toBe("var(--m-ink)");
    expect(hi.style.background).toContain("--m-seq-5");
    expect(hi.style.color).toBe("var(--m-ink-on-accent)");
    expect(hi).toHaveTextContent("95");
  });

  it("Heatmap div mode maps the ends of the range to the diverging ends", () => {
    render(<Heatmap mode="div" rows={["a"]} cols={["n", "p"]} cells={[{ row: "a", col: "n", value: -1 }, { row: "a", col: "p", value: 1 }]} />);
    expect(screen.getByLabelText("a n: -1").style.background).toContain("--m-div-neg-2");
    expect(screen.getByLabelText("a p: 1").style.background).toContain("--m-div-pos-2");
  });

  it("chartTheme carries ten series hues, domain lookup and both ramps", () => {
    expect(chartTheme.series).toHaveLength(10);
    expect(chartTheme.seriesFill[9]).toBe("var(--m-viz-10-fill)");
    expect(chartTheme.domain("vendor")).toBe("var(--m-dom-vendor)");
    expect(chartTheme.seq).toHaveLength(5);
    expect(chartTheme.div).toHaveLength(5);
  });

  it("ChartTooltip draws a square swatch for a series colour", () => {
    const { container } = render(<ChartTooltip active payload={[{ name: "DQS", value: 91, color: "var(--m-viz-2)" }]} />);
    const swatch = container.querySelector("span[aria-hidden]") as HTMLElement;
    expect(swatch.style.width).toBe("8px");
    expect(swatch.style.height).toBe("8px");
    expect(swatch.style.background).toContain("--m-viz-2");
  });

  it("ChartLegend isolates a series on click and toggles back", () => {
    const onIsolate = vi.fn();
    render(<ChartLegend items={[{ key: "a", name: "Alpha", color: "var(--m-viz-1)" }, { key: "b", name: "Beta", color: "var(--m-viz-2)" }]} isolated="a" onIsolate={onIsolate} />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(onIsolate).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(onIsolate).toHaveBeenLastCalledWith("b");
    expect(isolatedOpacity("a", "a")).toBe(1);
    expect(isolatedOpacity("b", "a")).toBe(0.25);
    expect(isolatedOpacity("b", null)).toBe(1);
  });

  it("Graph fills nodes from the domain palette and marks the bottleneck target", () => {
    const { container } = render(
      <Graph
        weighted
        nodes={[{ id: "a", size: 4, label: "A", domain: "material" }, { id: "b", size: 2, label: "B", domain: "vendor" }]}
        edges={[{ source: "a", target: "b", weight: 1, bottleneck: true }]}
      />,
    );
    const dots = Array.from(container.querySelectorAll(".m-graph-node-dot")).map((c) => c.getAttribute("fill"));
    expect(dots).toEqual(["var(--m-dom-material)", "var(--m-dom-vendor)"]);
    expect(container.querySelectorAll(".m-pulse-once")).toHaveLength(1);
    expect(container.querySelector("[data-bottleneck]")).toHaveAttribute("aria-label", "Node B");
    expect(container.querySelector("line")?.getAttribute("data-edge-width")).toBe("5");
  });

  it("Graph does not replay the pulse when pulse is false", () => {
    const { container } = render(
      <Graph weighted pulse={false} nodes={[{ id: "a", size: 1 }, { id: "b", size: 1 }]} edges={[{ source: "a", target: "b", bottleneck: true }]} />,
    );
    expect(container.querySelectorAll(".m-pulse-once")).toHaveLength(0);
  });

  it("GraphLegend labels bottleneck and rework only when asked", () => {
    const { rerender } = render(<GraphLegend domains={["material"]} />);
    expect(screen.queryByText("Bottleneck")).toBeNull();
    expect(screen.getByText("Material")).toBeInTheDocument();
    rerender(<GraphLegend bottleneck rework />);
    expect(screen.getByText("Bottleneck")).toBeInTheDocument();
    expect(screen.getByText("Rework")).toBeInTheDocument();
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

describe("Heatmap tone callback and Pareto label", () => {
  it("tone puts a numeric cell on the tone fill and maps backend tiers", () => {
    render(<Heatmap rows={["a"]} cols={["b"]} cells={[{ row: "a", col: "b", value: 42 }]} tone={() => "no-go"} />);
    expect(screen.getByLabelText("a b: 42, no go")).toBeInTheDocument();
    expect(toneOfTier("at_risk")).toBe("at-risk");
    expect(toneOfTier("weird")).toBeUndefined();
  });

  it("Pareto exposes its label as the accessible name", () => {
    render(<Pareto data={[{ x: "A", y: 5 }, { x: "B", y: 1 }]} label="Rules by impact" />);
    expect(screen.getByRole("img", { name: /Rules by impact/ })).toBeInTheDocument();
  });
});
