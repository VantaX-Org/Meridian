import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Score } from "./Score";

describe("Score hero", () => {
  it("prints the capped composite and rules the measured value as the ghost beyond the cap", () => {
    const { container } = render(<Score size="hero" value={70} measured={82.4} cap={70} criticals={2} />);
    const hero = screen.getByTestId("score-hero");
    // The ruler names the measured value and the cap it was held at.
    expect(screen.getByRole("img", { name: /score 82\.4, capped at 70/ })).toBeInTheDocument();
    // The fill stops at the cap; the measured run beyond it is the dashed ghost.
    expect(container.querySelector("rect.m-bar-fill")).toHaveAttribute("width", "70%");
    expect(container.querySelector("rect[stroke-dasharray]")).not.toBeNull();
    expect(hero.textContent).toContain("Capped at 70, 2 critical");
    // The numeral is the composite, never the measured value.
    expect(hero.textContent).not.toMatch(/82\.4/);
  });
  it("without a binding cap, draws and prints the value alone", () => {
    const { container } = render(<Score size="hero" value={91.2} measured={91.2} cap={95} />);
    expect(container.querySelector("rect[stroke-dasharray]")).toBeNull();
    expect(screen.getByTestId("score-hero").textContent).not.toContain("Capped");
  });
});
