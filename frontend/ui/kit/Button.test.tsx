import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders a button that fires onClick", () => {
    const on = vi.fn();
    render(<Button variant="primary" onClick={on}>Go</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(on).toHaveBeenCalled();
    expect(screen.getByRole("button").getAttribute("data-variant")).toBe("primary");
  });
  it("renders a link with an href", () => {
    render(<Button href="/work">Fix</Button>);
    expect(screen.getByRole("link", { name: "Fix" }).getAttribute("href")).toBe("/work");
  });
});
