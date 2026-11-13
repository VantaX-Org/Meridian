import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AreaSpark, ScoreRing, SegBar } from "..";

describe("ScoreRing", () => {
  it("says the score in its aria text", () => {
    render(<ScoreRing value={82.5} label="Source DQS" />);
    expect(screen.getByRole("img", { name: "Source DQS: 82.5 of 100" })).toBeInTheDocument();
  });
  it("draws an empty ring and no arc without a score", () => {
    const { container } = render(<ScoreRing value={null} label="Actual" testid="r" />);
    expect(screen.getByRole("img", { name: "Actual: no score" })).toBeInTheDocument();
    expect(container.querySelector(".nx-ring-arc")).toBeNull();
    expect(screen.getByTestId("r")).toHaveAttribute("data-empty", "true");
  });
  it("clamps out-of-range values", () => {
    render(<ScoreRing value={140} label="X" />);
    expect(screen.getByRole("img", { name: "X: 100 of 100" })).toBeInTheDocument();
  });
});

describe("SegBar", () => {
  const segs = [
    { key: "a", label: "Would load", value: 90, tone: "good" as const },
    { key: "b", label: "With a warning", value: 0, tone: "warn" as const },
    { key: "c", label: "Would be rejected", value: 10, tone: "bad" as const },
  ];
  it("has an aria text, a tooltip per drawn part and skips zero parts", () => {
    const { container } = render(<SegBar segs={segs} />);
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Would load 90, With a warning 0, Would be rejected 10");
    expect(container.querySelectorAll("rect.nx-seg")).toHaveLength(2);
    expect(container.querySelector("rect.nx-seg-good title")?.textContent).toBe("Would load: 90");
  });
  it("draws an empty track when every part is zero", () => {
    render(<SegBar segs={segs.map((s) => ({ ...s, value: 0 }))} testid="s" />);
    expect(screen.getByRole("img", { name: "No rows to show" })).toBeInTheDocument();
    expect(screen.getByTestId("s")).toHaveAttribute("data-empty", "true");
  });
});

describe("AreaSpark", () => {
  it("draws a line and one tooltip dot per point", () => {
    const { container } = render(<AreaSpark values={[60, 62, null, 70, 71, 73, 75, 80]} label="Trend" />);
    expect(container.querySelectorAll("circle")).toHaveLength(7);
    expect(container.querySelector("circle title")?.textContent).toBe("60");
    expect(screen.getByRole("img", { name: "Trend: from 60 to 80 over 7 runs" })).toBeInTheDocument();
  });
  it("draws an empty shape with one line of copy when there are fewer than two points", () => {
    const { container } = render(<AreaSpark values={[70]} label="Trend" testid="a" />);
    expect(container.querySelector("polyline")).toBeNull();
    expect(screen.getByRole("img", { name: "Trend: not enough runs for a trend" })).toBeInTheDocument();
    expect(screen.getByTestId("a")).toHaveAttribute("data-empty", "true");
  });
});
