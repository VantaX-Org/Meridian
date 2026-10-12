import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Switch } from "./Switch";
import { Textarea } from "./Textarea";

describe("Switch", () => {
  it("exposes role switch with aria-checked and toggles on click", () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Auto cleanse" />);
    const sw = screen.getByRole("switch", { name: "Auto cleanse" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("reports the next value from the checked state and does not fire when disabled", () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(<Switch checked onCheckedChange={onCheckedChange} label="Auto cleanse" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).toHaveBeenCalledWith(false);
    onCheckedChange.mockClear();
    rerender(<Switch checked onCheckedChange={onCheckedChange} label="Auto cleanse" disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe("Textarea", () => {
  it("renders a textarea with the input styling", () => {
    render(<Textarea aria-label="Notes" defaultValue="hi" />);
    const ta = screen.getByLabelText("Notes");
    expect(ta.tagName).toBe("TEXTAREA");
    expect(ta).toHaveClass("m-input", "m-textarea");
  });
});
