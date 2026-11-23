import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BandChart } from "./BandChart";
import { RunLines } from "./RunLines";
import { ToneBars } from "./ToneBars";
import { TrendArea } from "./TrendArea";
import { WeeklyChart } from "./WeeklyChart";

const pts = [{ axis: "1 Nov", title: "Run 1", value: 60 }, { axis: "8 Nov", title: "Run 2", value: 72 }, { axis: "15 Nov", title: "Run 3", value: 88 }];
const runs = [{ n: 1, axis: "1 Nov", shown: 60, measured: 58 }, { n: 2, axis: "8 Nov", shown: 72, measured: 70 }, { n: 3, axis: "15 Nov", shown: 88, measured: 85 }];
const weeks = [{ period: "W1", applied: 4, verified: 2, rolled: 0 }, { period: "W2", applied: 9, verified: 6, rolled: 1 }, { period: "W3", applied: 12, verified: 10, rolled: 0 }];
const labels = { shown: "Shown", measured: "Measured", go: "Go", gate: "Gate 70" };

/** jsdom has no layout, so give the plot a 300px box starting at x=0. */
function boxed(el: HTMLElement) {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 100, width: 300, height: 100, x: 0, y: 0, toJSON: () => ({}) });
}
afterEach(() => vi.restoreAllMocks());

describe("charts: hover, keyboard, onSelect", () => {
  it("TrendArea: arrow keys move a readout, Enter selects, click selects", () => {
    const onSelect = vi.fn();
    render(<TrendArea label="Score" emptyLabel="x" points={pts} height={120} onSelect={onSelect} />);
    const plot = screen.getByRole("group", { name: "Score" });
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(screen.getByRole("status").textContent).toContain("Run 1");
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    fireEvent.keyDown(plot, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(pts[1]);
    boxed(plot);
    fireEvent.mouseMove(plot, { clientX: 300 });
    expect(screen.getByRole("status").textContent).toContain("Run 3");
    fireEvent.click(plot);
    expect(onSelect).toHaveBeenLastCalledWith(pts[2]);
  });

  it("TrendArea: Escape clears the readout", () => {
    render(<TrendArea label="Score" emptyLabel="x" points={pts} height={120} />);
    const plot = screen.getByRole("group", { name: "Score" });
    fireEvent.keyDown(plot, { key: "End" });
    expect(screen.getByRole("status").textContent).toContain("Run 3");
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("TrendArea: a drag reports a range and Escape clears it", () => {
    const onRange = vi.fn();
    render(<TrendArea label="Score" emptyLabel="x" points={pts} height={120} brush onRange={onRange} />);
    const plot = screen.getByRole("group", { name: "Score" });
    boxed(plot);
    fireEvent.mouseDown(plot, { clientX: 0 });
    fireEvent.mouseMove(plot, { clientX: 300 });
    fireEvent.mouseUp(plot);
    expect(onRange).toHaveBeenLastCalledWith({ from: pts[0], to: pts[2] });
    expect(screen.getByTestId("brush")).toBeTruthy();
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(onRange).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId("brush")).toBeNull();
  });

  it("TrendArea: Shift plus arrows extends a range from the keyboard", () => {
    const onRange = vi.fn();
    render(<TrendArea label="Score" emptyLabel="x" points={pts} height={120} brush onRange={onRange} />);
    const plot = screen.getByRole("group", { name: "Score" });
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    fireEvent.keyDown(plot, { key: "ArrowRight", shiftKey: true });
    expect(onRange).toHaveBeenLastCalledWith({ from: pts[0], to: pts[1] });
  });

  it("TrendArea: a small sparkline stays plain", () => {
    render(<TrendArea label="Score" emptyLabel="x" points={pts} height={32} />);
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("BandChart: keyboard select and gates do not break the render", () => {
    const onSelect = vi.fn();
    const data = [{ axis: "a", value: 60 }, { axis: "b", value: 72 }, { axis: "c", point: 80, low: 75, high: 85 }];
    render(<BandChart label="Forecast" data={data} gates onSelect={onSelect} />);
    const plot = screen.getByRole("group", { name: "Forecast" });
    fireEvent.keyDown(plot, { key: "End" });
    expect(screen.getByRole("status").textContent).toContain("75");
    fireEvent.keyDown(plot, { key: " " });
    expect(onSelect).toHaveBeenCalledWith(data[2]);
  });

  it("RunLines: hover reads the run and click selects it", () => {
    const onSelect = vi.fn();
    render(<RunLines points={runs} labels={labels} ariaLabel="Score by run" onSelect={onSelect} />);
    const plot = screen.getByRole("group", { name: "Score by run" });
    boxed(plot);
    fireEvent.mouseMove(plot, { clientX: 150 });
    expect(screen.getByRole("status").textContent).toContain("Shown 72");
    fireEvent.click(plot);
    expect(onSelect).toHaveBeenCalledWith(runs[1]);
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    fireEvent.keyDown(plot, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(runs[2]);
  });

  it("WeeklyChart: keyboard select", () => {
    const onSelect = vi.fn();
    render(<WeeklyChart weeks={weeks} onSelect={onSelect} />);
    const plot = screen.getByRole("group");
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(screen.getByRole("status").textContent).toContain("W3");
    fireEvent.keyDown(plot, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(weeks[2]);
  });

  it("ToneBars: a button per label calls onSelect and marks the selected bar", () => {
    const onSelect = vi.fn();
    const items = [{ key: "a", label: "Complete", value: 90, delta: 1 }, { key: "b", label: "Valid", value: 60, delta: null }];
    render(<ToneBars items={items} naLabel="n/a" lineLabel="Dimensions" onSelect={onSelect} selected="a" />);
    fireEvent.click(screen.getByRole("button", { name: "Valid" }));
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(screen.getByRole("button", { name: "Complete" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("ToneBars: without onSelect there are no buttons", () => {
    render(<ToneBars items={[{ key: "a", label: "Complete", value: 90, delta: null }]} naLabel="n/a" lineLabel="Dimensions" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ChartFrame states", () => {
  it("loading shows a shaped skeleton", () => {
    render(<TrendArea label="Score" emptyLabel="x" points={[]} state="loading" height={120} />);
    expect(screen.getByRole("status", { name: "Loading" })).toBeTruthy();
  });
  it("empty shows one sentence and one action", () => {
    render(<TrendArea label="Score" emptyLabel="x" points={[]} state="empty" emptyText="No runs yet." emptyAction={<button type="button">Start a run</button>} />);
    expect(screen.getByText("No runs yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start a run" })).toBeTruthy();
  });
  it("error with no data names the request and retries", () => {
    const onRetry = vi.fn();
    render(<TrendArea label="Score" emptyLabel="x" points={[]} state="error" errorText="Score by run did not load." onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Score by run did not load.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });
  it("error with data keeps the last good plot on screen", () => {
    render(<TrendArea label="Score" emptyLabel="x" points={pts} height={120} state="error" errorText="Score by run did not load." onRetry={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("did not load");
    expect(screen.getByRole("group", { name: "Score" })).toBeTruthy();
  });
});
