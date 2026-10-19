import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Rule } from "./Rule";

describe("Rule", () => {
  it("names the value, the cap and the target", () => {
    render(<Rule value={82} cap={70} target={90} size="hero" />);
    expect(screen.getByRole("img", { name: "Score 82, capped at 70, target 90" })).toBeInTheDocument();
  });
  it("fills to the cap, not the measured value, when the cap binds", () => {
    const { container } = render(<Rule value={82} cap={70} />);
    expect(container.querySelector("rect.m-bar-fill")).toHaveAttribute("width", "70%");
  });
  it("draws the empty ruler for a missing value", () => {
    const { container } = render(<Rule value={null} size="inline" label="DQS" />);
    expect(screen.getByRole("img", { name: /DQS not measured/ })).toBeInTheDocument();
    expect(container.querySelector("rect.m-bar-fill")).toBeNull();
  });
  it("labels the ends and the target only at hero size", () => {
    const { container, rerender } = render(<Rule value={50} size="hero" />);
    expect(container.textContent).toContain("Target 90");
    rerender(<Rule value={50} size="row" />);
    expect(container.textContent).not.toContain("Target");
  });
});
