import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ChartFrame, ChartTable, Distribution, SmallMultiples, Sparkline, StackedBar, TrendChart, bins, distGeometry, linear, niceTicks, scoreDomain, severityParts, sparkGeometry, stack, trendGeometry, verdictParts } from "../charts";

const css = readFileSync(join(__dirname, "..", "charts.css"), "utf8");
const POINTS = [66.2, 67, 66.8, 68.9, 69.4, 69.8, 70.9, 71.8].map((v, i) => ({ id: `r${i}`, label: `d${i}`, title: `Run ${i}: measured ${v}`, value: v }));

describe("chart arithmetic", () => {
  it("scales linearly and clamps to the domain", () => {
    const y = linear([60, 100], [200, 0]);
    expect(y(60)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(80)).toBe(100);
    expect(y(40)).toBe(200);
  });

  it("puts ticks on round values", () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0, 7, 4)).toEqual([0, 2, 4, 6]);
    expect(niceTicks(60, 100, 4)).toEqual([60, 70, 80, 90, 100]);
  });

  it("widens a score domain to whole tens, keeps the references in view and stays inside 0 to 100", () => {
    expect(scoreDomain([66.2, 71.8])).toEqual([50, 80]);
    expect(scoreDomain([66.2, 71.8], [85])).toEqual([60, 90]);
    expect(scoreDomain([95, 99], [], 30)).toEqual([70, 100]);
    expect(scoreDomain([])).toEqual([0, 100]);
  });

  it("bins values with the last bin closed at the top", () => {
    const b = bins([{ id: "a", value: 60 }, { id: "b", value: 64.9 }, { id: "c", value: 65 }, { id: "d", value: 100 }], [60, 100], 5);
    expect(b).toHaveLength(8);
    expect(b[0].ids).toEqual(["a", "b"]);
    expect(b[1].ids).toEqual(["c"]);
    expect(b[7].ids).toEqual(["d"]);
  });

  it("stacks parts with a 2 pixel gap and keeps a small part visible", () => {
    const s = stack([70, 0, 1000, 2], 400);
    expect(s[0].x).toBe(0);
    expect(s[1].w).toBe(0);
    expect(s[2].x).toBeCloseTo(s[0].w + 2, 1);
    expect(s[3].w).toBeGreaterThanOrEqual(2);
  });
});

describe("the trend chart", () => {
  it("draws one line through every value, gridlines on the ticks, the reference dashed, the marker and the last value", () => {
    const g = trendGeometry(POINTS.map((p) => p.value), { width: 560, domain: [60, 100], ticks: [60, 70, 80, 90, 100], refs: [{ value: 70, label: "cap 70" }], marker: 5 });
    expect(g.points.split(" ")).toHaveLength(8);
    expect(g.gridY.map((l) => l.value)).toEqual([70, 80, 90, 100]);
    expect(g.refs[0].y).toBe(linear([60, 100], [g.plot.bottom, g.plot.top])(70));
    expect(g.markerX).toBe(g.xs[5]);
    expect(g.area.startsWith(`M${g.plot.left},${g.plot.bottom}`)).toBe(true);
    // A run without a value leaves a gap in the line, not a zero.
    expect(trendGeometry([70, null, 72], { width: 400, domain: [60, 100], ticks: [] }).points.split(" ")).toHaveLength(2);
  });

  it("is an image with a name, reachable by keyboard, and reads the point in focus aloud", () => {
    render(<div className="m2-root"><TrendChart points={POINTS} domain={[60, 100]} ticks={[60, 70, 80, 90, 100]} label="Measured score, 66.2 to 71.8" format={(v) => v.toFixed(1)} testId="trend" /></div>);
    const svg = screen.getByTestId("trend");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAccessibleName("Measured score, 66.2 to 71.8");
    expect(svg).toHaveAttribute("tabindex", "0");
    const live = document.querySelector("[aria-live='polite']") as HTMLElement;
    expect(live.textContent).toBe("");
    fireEvent.keyDown(svg, { key: "End" });
    expect(live.textContent).toBe("Run 7: measured 71.8");
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(live.textContent).toBe("Run 6: measured 70.9");
    expect(document.querySelector(".m2-viz-tip")).toHaveTextContent("Run 6: measured 70.9");
    fireEvent.keyDown(svg, { key: "Home" });
    expect(live.textContent).toBe("Run 0: measured 66.2");
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(live.textContent).toBe("");
    expect(document.querySelector(".m2-viz-tip")).toBeNull();
    // The last value is named at the end of the line in ink, beside a ringed end dot.
    expect(svg.querySelector("text.m2-lab")).toHaveTextContent("71.8");
    expect(svg.querySelectorAll("circle.m2-end")).toHaveLength(1);
  });
});

describe("the chart frame", () => {
  it("shows one state at a time and keeps the plot's height", () => {
    const { rerender } = render(<ChartFrame title="Trend" height={120} state="loading"><svg data-testid="plot" /></ChartFrame>);
    expect(screen.queryByTestId("plot")).toBeNull();
    expect(document.querySelector("[aria-busy='true']")).toHaveStyle({ height: "120px" });
    rerender(<ChartFrame title="Trend" height={120} state="empty" empty="Nothing yet."><svg data-testid="plot" /></ChartFrame>);
    expect(screen.getByTestId("chart-empty")).toHaveTextContent("Nothing yet.");
    rerender(<ChartFrame title="Trend" height={120} state="error" onRetry={() => undefined}><svg data-testid="plot" /></ChartFrame>);
    expect(screen.getByRole("alert")).toHaveTextContent("The figures for this chart could not be read.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    rerender(
      <ChartFrame title="Trend" height={120} table={<ChartTable caption="Trend figures" head={["Run", "Score"]} rows={[["16 Oct", "71.8"]]} />}>
        <svg data-testid="plot" />
      </ChartFrame>,
    );
    expect(screen.getByTestId("plot")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Trend" })).toBeInTheDocument();
    // The text alternative: every figure as a table, behind "Show the figures".
    expect(screen.getByText("Show the figures").tagName).toBe("SUMMARY");
    const table = screen.getByRole("table", { name: "Trend figures" });
    expect(within(table).getByRole("rowheader", { name: "16 Oct" })).toBeInTheDocument();
  });
});

describe("the stacked bar and its presets", () => {
  it("draws the severity parts in order with a legend of mark, word and count", () => {
    const parts = severityParts({ critical: 70, high: 412, medium: 1210, low: 904 });
    expect(parts.map((p) => p.colour)).toEqual(["--m2-sev-crit", "--m2-sev-high", "--m2-sev-med", "--m2-sev-low"]);
    render(<div className="m2-root"><StackedBar parts={parts} label="Findings by severity" format={(v) => String(v)} testId="stack" /></div>);
    expect(screen.getByTestId("stack")).toHaveAccessibleName("Findings by severity");
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Critical70", "High412", "Medium1210", "Low904"]);
    expect(legend.querySelectorAll("svg.m2-vm")).toHaveLength(4);
    fireEvent.keyDown(screen.getByTestId("stack"), { key: "ArrowRight" });
    expect(document.querySelector("[aria-live='polite']")).toHaveTextContent("Critical: 70 findings, 2.7 percent");
  });

  it("names the verdicts in the semantic hues", () => {
    expect(verdictParts({ go: 2, "at-risk": 2, "no-go": 11 }).map((p) => [p.key, p.colour, p.value])).toEqual([
      ["no-go", "--m2-fail", 11],
      ["at-risk", "--m2-warn", 2],
      ["go", "--m2-pass", 2],
    ]);
  });
});

describe("the distribution", () => {
  it("draws a column per bin no wider than 24 pixels, with the counts on the axis", () => {
    const items = [71.8, 72.6, 73.5, 74.2, 75.3, 76.9, 77.7, 78.4, 79.1, 80.4, 81, 88.6, 91.2, 93.4].map((v, i) => ({ id: `o${i}`, label: `Object ${i}`, value: v }));
    const g = distGeometry(items, { width: 480, domain: [60, 100], binWidth: 5, refs: [{ value: 75, label: "75 at risk" }] });
    expect(g.bins).toHaveLength(8);
    expect(Math.max(...g.bins.map((b) => b.w))).toBeLessThanOrEqual(24);
    expect(g.bins.map((b) => b.ids.length)).toEqual([0, 0, 4, 5, 2, 1, 2, 0]);
    expect(g.refs[0].value).toBe(75);
    render(<div className="m2-root"><Distribution items={items} domain={[60, 100]} binWidth={5} label="Objects by score" describe={(b, names) => `${b.from} to ${b.to}: ${names.length}`} testId="dist" /></div>);
    const svg = screen.getByTestId("dist");
    expect(svg.querySelectorAll("path.m2-col")).toHaveLength(8);
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(document.querySelector("[aria-live='polite']")).toHaveTextContent("70 to 75: 4");
  });
});

describe("sparklines and small multiples", () => {
  it("draws the trend in a row with the last value as a dot, and says first and last in its name", () => {
    expect(sparkGeometry([60, 80, 100], 48, 12, [60, 100]).last).toEqual({ x: 46, y: 2 });
    render(<div className="m2-root"><Sparkline values={[66.2, 71.8]} label="Material master, 66.2 to 71.8" testId="spark" /></div>);
    expect(screen.getByTestId("spark")).toHaveAccessibleName("Material master, 66.2 to 71.8");
    expect(screen.getByTestId("spark").querySelector("circle.m2-spark-d")).not.toBeNull();
    const { container } = render(<Sparkline values={[null, 70]} label="x" />);
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("gives every object a panel on one shared scale with its name and last value", () => {
    render(
      <div className="m2-root">
        <SmallMultiples
          testId="multi"
          domain={[60, 90]}
          reference={{ value: 85, label: "85 cap" }}
          items={[
            { id: "a", title: "Material master", label: "Material master: 66.2 to 71.8", values: [66.2, 71.8], last: "71.8" },
            { id: "b", title: "Business partner", label: "Business partner: 80 to 78.4", values: [80, 78.4], last: "78.4" },
          ]}
        />
      </div>,
    );
    const panels = within(screen.getByTestId("multi")).getAllByRole("listitem");
    expect(panels).toHaveLength(2);
    expect(panels[0]).toHaveTextContent("Material master71.8");
    expect(within(panels[1]).getByRole("img")).toHaveAccessibleName("Business partner: 80 to 78.4");
    expect(panels[0].querySelectorAll("line.m2-capl")).toHaveLength(1);
  });
});

describe("the chart styles", () => {
  it("draw text in ink, lines 2 pixels in the data hue, hairline grids, and only palette tokens", () => {
    expect(css).toMatch(/\.m2-chart \.m2-ln \{[^}]*stroke: var\(--m2-chart-line\);[^}]*stroke-width: 2;/);
    expect(css).toMatch(/\.m2-chart \.m2-gl \{[^}]*stroke-width: 1;/);
    expect(css).toMatch(/\.m2-chart \.m2-ax \{[^}]*fill: var\(--m2-chart-text\)/);
    expect(css).toMatch(/\.m2-chart \.m2-lab \{[^}]*fill: var\(--m2-fg\)/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(transition|animation)\s*:/);
  });
});
