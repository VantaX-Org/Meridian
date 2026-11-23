import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreRuler, labelSides } from "./ScoreRuler";

const labels = { atRisk: "At risk", go: "Go", cap70: "Cap 70", cap85: "Cap 85", measured: (n: number) => `Measured ${n}` };

describe("ScoreRuler", () => {
  it("capped mark shows a hollow measured mark tethered to the solid one", () => {
    render(<ScoreRuler ariaLabel="Scores" labels={labels} marks={[{ id: "a", label: "Material", shown: 69, measured: 92 }]} />);
    expect(screen.getByTestId("ruler-hollow")).toBeTruthy();
    expect(screen.getByTestId("ruler-tether")).toBeTruthy();
    expect(screen.getByText("Measured 92")).toBeTruthy();
  });
  it("uncapped mark has no hollow mark", () => {
    render(<ScoreRuler ariaLabel="Scores" labels={labels} marks={[{ id: "a", label: "Customer", shown: 88 }]} />);
    expect(screen.queryByTestId("ruler-hollow")).toBeNull();
    expect(screen.getByTestId("ruler-solid")).toBeTruthy();
  });
  it("zones, first-run mark and hidden name", () => {
    const { container } = render(<ScoreRuler ariaLabel="Scores" labels={labels} showName={false} first={{ value: 40, label: "Run 1: 40" }} zones={{ noGo: "No-go", atRisk: "At risk", go: "Go" }} marks={[{ id: "a", label: "Material", shown: 69, measured: 92 }]} />);
    expect(screen.getByText("No-go")).toBeTruthy();
    expect(screen.getByText("Run 1: 40")).toBeTruthy();
    expect(container.querySelector(".mx-ruler-first")).toBeTruthy();
    expect(screen.queryByText("Material")).toBeNull();
  });
});

describe("ScoreRuler projected and actual", () => {
  const l = { ...labels, projected: (n: number) => `Projected ${n}`, actual: (n: number) => `Actual ${n}` };
  it("labelSides: far markers stay up, close markers alternate", () => {
    expect(labelSides([0, 100, 200])).toEqual(["up", "up", "up"]);
    expect(labelSides([0, 47, 90])).toEqual(["up", "down", "up"]);
    expect(labelSides([0, 48])).toEqual(["up", "up"]);
  });
  it("draws projected and actual markers with labels", () => {
    render(<ScoreRuler ariaLabel="Scores" labels={l} marks={[{ id: "a", label: "Material", shown: 60, projected: 88, actual: 70 }]} />);
    expect(screen.getByText("Projected 88")).toBeTruthy();
    expect(screen.getByText("Actual 70")).toBeTruthy();
  });
  it("close markers put labels on opposite sides", () => {
    render(<ScoreRuler ariaLabel="Scores" labels={l} marks={[{ id: "a", label: "Material", shown: 80, projected: 82, actual: 84 }]} />);
    const sides = [screen.getByTestId("ruler-projected"), screen.getByTestId("ruler-actual")].map((e) => e.getAttribute("data-side"));
    expect(sides[0]).not.toBe(sides[1]);
  });
  it("markers move by transform, not by re-mounting", () => {
    const { rerender } = render(<ScoreRuler ariaLabel="Scores" labels={l} marks={[{ id: "a", label: "M", shown: 60, projected: 70 }]} />);
    const el = screen.getByTestId("ruler-projected");
    const before = el.getAttribute("style");
    rerender(<ScoreRuler ariaLabel="Scores" labels={l} marks={[{ id: "a", label: "M", shown: 60, projected: 90 }]} />);
    expect(screen.getByTestId("ruler-projected")).toBe(el);
    expect(el.getAttribute("style")).not.toBe(before);
  });
});
