import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Choice, ChoiceGroup } from "./ChoiceGroup";

const OPTIONS = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma" }] as const;

describe("ChoiceGroup", () => {
  it("is a named group of .m-choice toggle buttons with the selected one pressed", () => {
    render(<ChoiceGroup label="Letter" value="b" onChange={() => {}} options={OPTIONS} />);
    const group = screen.getByRole("group", { name: "Letter" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons).toHaveLength(3);
    for (const b of buttons) expect(b).toHaveClass("m-choice");
    expect(screen.getByRole("button", { name: "Beta" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute("aria-pressed", "false");
  });

  it("single choice reports the pressed value", () => {
    const onChange = vi.fn();
    render(<ChoiceGroup label="Letter" value="a" onChange={onChange} options={OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Gamma" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("multiple toggles a value in and out of the list", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ChoiceGroup multiple label="Letters" value={["a"]} onChange={onChange} options={OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Beta" }));
    expect(onChange).toHaveBeenLastCalledWith(["a", "b"]);
    rerender(<ChoiceGroup multiple label="Letters" value={["a", "b"]} onChange={onChange} options={OPTIONS} />);
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(onChange).toHaveBeenLastCalledWith(["b"]);
  });

  it("shows the label only when asked and disables every pill", () => {
    const { rerender } = render(<ChoiceGroup label="Letter" value="a" onChange={() => {}} options={OPTIONS} />);
    expect(screen.queryByText("Letter")).toBeNull();
    rerender(<ChoiceGroup label="Letter" showLabel disabled value="a" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByText("Letter")).toBeInTheDocument();
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled();
  });

  it("Choice is one toggle pill", () => {
    const onClick = vi.fn();
    render(<Choice pressed onClick={onClick}>Only mine</Choice>);
    const b = screen.getByRole("button", { name: "Only mine" });
    expect(b).toHaveAttribute("aria-pressed", "true");
    expect(b).toHaveAttribute("type", "button");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
