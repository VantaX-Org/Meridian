import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeltaBar, SeverityMark, SmallMultiples, scoreDomain, sparkGeometry } from "..";

describe("scoreDomain", () => {
  it("widens to whole tens and at least 30 points", () => {
    expect(scoreDomain([71.8, 74.2])).toEqual([60, 90]);
  });
  it("stays inside 0 to 100 and keeps references in view", () => {
    expect(scoreDomain([98, 99], [60])).toEqual([60, 100]);
    expect(scoreDomain([1])).toEqual([0, 30]);
    expect(scoreDomain([])).toEqual([0, 100]);
  });
});

describe("sparkGeometry", () => {
  it("leaves nulls out and ends on the last value", () => {
    const g = sparkGeometry([0, null, 100], 104, 44, [0, 100]);
    expect(g.points).toBe("2,42 102,2");
    expect(g.last).toEqual({ x: 102, y: 2 });
  });
  it("centres a single value and has no last point without values", () => {
    expect(sparkGeometry([50], 100, 44, [0, 100]).points).toBe("50,22");
    expect(sparkGeometry([null], 100, 44, [0, 100]).last).toBeNull();
  });
});

describe("DeltaBar", () => {
  it("draws a rise right of zero and a fall left of it, capped at the half width", () => {
    const { container, rerender } = render(<DeltaBar d={2} />);
    const up = container.querySelector(".nx-dbar-up");
    expect(up?.getAttribute("x")).toBe("55");
    expect(up?.getAttribute("width")).toBe("34");
    rerender(<DeltaBar d={-10} />);
    const down = container.querySelector(".nx-dbar-down");
    expect(down?.getAttribute("width")).toBe("53");
    expect(down?.getAttribute("x")).toBe("2");
  });
  it("draws only the zero line for no change", () => {
    const { container } = render(<DeltaBar d={null} />);
    expect(container.querySelector("rect")).toBeNull();
    expect(screen.getByTestId("dbar")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("SeverityMark", () => {
  it("draws a square, a triangle or a dot by severity", () => {
    const { container, rerender } = render(<SeverityMark severity="critical" />);
    expect(container.querySelector("svg[data-severity=critical] rect")).not.toBeNull();
    rerender(<SeverityMark severity="high" />);
    expect(container.querySelector("svg[data-severity=high] path")).not.toBeNull();
    rerender(<SeverityMark severity="info" />);
    expect(container.querySelector("svg[data-severity=low] circle")).not.toBeNull();
  });
});

describe("SmallMultiples", () => {
  it("draws one named panel per object and the scale once", () => {
    render(
      <SmallMultiples
        testId="mm"
        domain={[50, 80]}
        reference={{ value: 70, label: "cap" }}
        items={[
          { id: "a", title: "Material", label: "Material, 60 to 72", values: [60, 72], last: "72" },
          { id: "b", title: "Customer", label: "Customer, 55 to 58", values: [55, null, 58], last: "58" },
        ]}
      />,
    );
    expect(screen.getByRole("img", { name: "Material, 60 to 72" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Customer, 55 to 58" })).toBeInTheDocument();
    const mm = screen.getByTestId("mm");
    expect(mm.querySelectorAll(".nx-multi-sc")).toHaveLength(1);
    expect(mm.querySelector(".nx-multi-sc")?.textContent).toBe("50 to 80, cap");
    expect(mm.querySelectorAll(".nx-multi-ref")).toHaveLength(2);
  });
});
