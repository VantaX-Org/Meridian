// frontend/design/charts/charts.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { Heatmap, toneOfTier } from "./Heatmap";
import { Pareto } from "./Pareto";
import { Bar, categoryAxisWidth } from "./Bar";
import { Graph, GraphLegend } from "./Graph";
import { ChartLegend, isolatedOpacity } from "./Legend";
import { Line, lastTickMargin, pointAtRow } from "./Line";
import { Radar, RADAR_MIN_WIDTH } from "./Radar";
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

  it("Line resolves a clicked dot by the row's x key, so a sparse series never opens a neighbouring run", () => {
    const sparse = [{ x: "A", y: 1 }, { x: "C", y: 3 }]; // measured in A and C only; domain is A, B, C
    expect(pointAtRow(sparse, "C")).toEqual({ x: "C", y: 3 });
    expect(pointAtRow(sparse, "B")).toBeUndefined();
    expect(pointAtRow(sparse, undefined)).toBeUndefined();
  });

  it("Line leaves room on the right for half of a long last tick, beyond the axis padding", () => {
    expect(lastTickMargin("16 Oct 2026, 05:17:46")).toBe(56); // 21 chars: 72 px half-width less 16 px padding
    expect(lastTickMargin("r2")).toBe(5);                     // short labels keep the default margin
    expect(lastTickMargin(undefined)).toBe(5);
    expect(lastTickMargin("x".repeat(80))).toBe(96);          // capped
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

describe("Waterfall value format", () => {
  it("reads every value through formatValue in its text alternative, and raw without one", () => {
    const fmt = (n: number) => `ZAR ${n.toLocaleString("en-US")}`;
    const { getByRole, rerender } = render(<Waterfall data={[{ x: "Invoice posting", y: 5672930 }]} label="At risk" formatValue={fmt} />);
    expect(getByRole("img").getAttribute("aria-label")).toBe("At risk: Invoice posting ZAR 5,672,930");
    rerender(<Waterfall data={[{ x: "Invoice posting", y: 5672930 }]} label="At risk" />);
    expect(getByRole("img").getAttribute("aria-label")).toBe("At risk: Invoice posting 5672930");
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

describe("run-keyed line charts and axis sizing", () => {
  it("Line keyed by run id uses the point label, never the key, in its text alternative", () => {
    render(
      <Line
        data={[{ x: "64afe257", label: "2 Oct 2026", y: 70 }, { x: "c1f752b7", label: "16 Oct 2026, 05:00", y: 81.8 }]}
        label="DQS over runs"
      />,
    );
    expect(screen.getByRole("img", { name: "DQS over runs: 2 Oct 2026 70, 16 Oct 2026, 05:00 81.8" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /64afe257/ })).toBeNull();
  });

  it("Line in multi-series mode prefixes each labelled point with its series name", () => {
    render(<Line data={[]} series={[{ name: "Completeness", data: [{ x: "r1", label: "2 Oct 2026", y: 90 }] }]} label="Dimensions" />);
    expect(screen.getByRole("img", { name: "Dimensions: Completeness 2 Oct 2026 90" })).toBeInTheDocument();
  });

  it("Line accepts a shared x domain so sibling charts line up", () => {
    const { container } = render(<Line data={[{ x: "r2", label: "b", y: 1 }]} xDomain={[{ x: "r1", label: "a" }, { x: "r2", label: "b" }, { x: "r3", label: "c" }]} />);
    expect(container.querySelector(".recharts-responsive-container") ?? container.querySelector("svg")).toBeTruthy();
  });

  it("categoryAxisWidth grows with the longest label within its bounds", () => {
    expect(categoryAxisWidth(["Go"])).toBe(60);
    expect(categoryAxisWidth(["Business Partner / CVI", "Go"])).toBe(Math.ceil(22 * 6.5) + 12);
    expect(categoryAxisWidth(["x".repeat(80)])).toBe(180);
    expect(categoryAxisWidth([1234, 5], 36, 72)).toBe(Math.ceil(4 * 6.5) + 12);
    expect(categoryAxisWidth([5], 36, 72)).toBe(36);
  });

  it("Bar labels a point by its label and formats values with separators", () => {
    render(<Bar data={[{ x: "detected", label: "Detected", y: 1234 }]} label="Average age by stage in hours" />);
    expect(screen.getByRole("img", { name: "Average age by stage in hours: Detected 1234" })).toBeInTheDocument();
  });
});

describe("Radar below the minimum width", () => {
  it("yields to the Bar fallback so the angle labels are never clipped, and keeps the text alternative", () => {
    class NarrowRO {
      cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) { this.cb = cb; }
      observe(el: Element) { this.cb([{ contentRect: { width: 240 } } as ResizeObserverEntry], this as unknown as ResizeObserver); void el; }
      disconnect() {}
      unobserve() {}
    }
    const originalRO = globalThis.ResizeObserver;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only global stub
    (globalThis as any).ResizeObserver = NarrowRO;
    try {
      const { container } = render(<Radar data={[{ x: "Accuracy", y: 91 }, { x: "Validity", y: 88 }]} label="Dimensions" />);
      expect(container.querySelector("[data-radar='bars']")).not.toBeNull();
      expect(container.querySelector(".recharts-polar-grid")).toBeNull();
      expect(screen.getByRole("img", { name: "Dimensions: Accuracy 91, Validity 88" })).toBeInTheDocument();
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only global stub
      (globalThis as any).ResizeObserver = originalRO;
    }
  });

  it("stays a radar at a comfortable width", () => {
    expect(RADAR_MIN_WIDTH).toBe(300);
    const { container } = render(<Radar data={[{ x: "Accuracy", y: 91 }]} label="Dimensions" />);
    expect(container.querySelector("[data-radar='radar']")).not.toBeNull();
  });
});
