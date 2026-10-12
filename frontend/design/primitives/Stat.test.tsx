import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Stat } from "./Stat";

describe("Stat", () => {
  it("renders a button with m-stat-link when onClick is set", () => {
    const onClick = vi.fn();
    render(<Stat label="Open" value={3} onClick={onClick} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("m-stat", "m-stat-link");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("hides the value while loading", () => {
    render(<Stat label="Open" value="42" loading />);
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });
});
