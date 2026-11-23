import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UndoToast } from "./UndoToast";

describe("UndoToast", () => {
  it("fires from the button and from Cmd Z", () => {
    const on = vi.fn();
    render(<UndoToast message="Saved" actionLabel="Undo" onAction={on} />);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(on).toHaveBeenCalledTimes(2);
  });
});
