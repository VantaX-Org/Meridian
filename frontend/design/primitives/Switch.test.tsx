import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RadioGroup } from "./Radio";
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

describe("Switch keyboard", () => {
  it.each([[" "], ["{Enter}"]])("toggles on %j", async (key) => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Auto cleanse" />);
    await userEvent.tab();
    expect(screen.getByRole("switch")).toHaveFocus();
    await userEvent.keyboard(key);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe("RadioGroup", () => {
  it("renders a labelled group and reports the chosen value, with arrow-key support", async () => {
    const onValueChange = vi.fn();
    render(<RadioGroup legend="Mode" name="mode" value="a" onValueChange={onValueChange} options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} />);
    expect(screen.getByRole("group", { name: "Mode" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Alpha" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Beta" }));
    expect(onValueChange).toHaveBeenCalledWith("b");
    await userEvent.tab();
    await userEvent.keyboard("{ArrowDown}");
    expect(onValueChange).toHaveBeenLastCalledWith("b");
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
