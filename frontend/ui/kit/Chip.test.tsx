import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Chip } from "./Chip";

describe("Chip", () => {
  it("is a pressed toggle with a count", () => {
    const on = vi.fn();
    render(<Chip selected count={3} onClick={on}>High</Chip>);
    const b = screen.getByRole("button", { name: /High/ });
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(b.textContent).toContain("3");
    fireEvent.click(b);
    expect(on).toHaveBeenCalled();
  });
});
