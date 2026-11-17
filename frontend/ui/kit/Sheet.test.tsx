import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";

describe("Sheet", () => {
  it("renders a bottom dialog only when open and closes on the button, Escape and the scrim", () => {
    const onClose = vi.fn();
    const { rerender, container } = render(<Sheet open={false} onClose={onClose} label="Selected rule" closeLabel="Close">body</Sheet>);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<Sheet open onClose={onClose} label="Selected rule" closeLabel="Close">body</Sheet>);
    expect(screen.getByRole("dialog", { name: "Selected rule" }).getAttribute("data-place")).toBe("bottom");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(container.querySelector(".mx-scrim") as Element);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
