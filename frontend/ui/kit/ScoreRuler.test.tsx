import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreRuler } from "./ScoreRuler";

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
