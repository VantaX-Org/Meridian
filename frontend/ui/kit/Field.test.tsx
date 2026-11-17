import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Field, Input, Select, Toggle } from "./Field";

describe("Field, Input, Select, Toggle", () => {
  it("labels the control and announces an error", () => {
    const on = vi.fn();
    render(<Field label="Name" error="Required"><Input onChange={on} /></Field>);
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "x" } });
    expect(on).toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("Required");
  });
  it("shows the hint when there is no error", () => {
    render(<Field label="Plant" hint="Four characters"><Input /></Field>);
    expect(screen.getByText("Four characters")).toBeTruthy();
  });
  it("selects an option", () => {
    const on = vi.fn();
    render(<Field label="System"><Select options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} defaultValue="a" onChange={(e) => on(e.target.value)} /></Field>);
    fireEvent.change(screen.getByLabelText(/System/), { target: { value: "b" } });
    expect(on).toHaveBeenCalledWith("b");
  });
  it("switches", () => {
    const on = vi.fn();
    render(<Toggle label="Auto clean" checked={false} onChange={on} />);
    fireEvent.click(screen.getByRole("switch", { name: "Auto clean" }));
    expect(on).toHaveBeenCalledWith(true);
  });
});
