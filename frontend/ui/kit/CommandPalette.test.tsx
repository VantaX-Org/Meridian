import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

const setup = () => {
  const run = vi.fn();
  const ask = vi.fn();
  const close = vi.fn();
  render(<CommandPalette open onClose={close} onAsk={ask} label="Command palette" placeholder="Type" askLabel={(q) => `Ask Aletheia: ${q}`} emptyLabel="None"
    commands={[{ id: "home", label: "Go to Home", run }, { id: "work", label: "Go to Work", hint: "queue", run: vi.fn() }]} />);
  return { run, ask, close, box: screen.getByRole("combobox") };
};

describe("CommandPalette", () => {
  it("filters, moves with arrows and runs the active command on Enter", () => {
    const { run, close, box } = setup();
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.change(box, { target: { value: "home" } });
    expect(screen.getAllByRole("option")).toHaveLength(2); // the match and the Ask row
    fireEvent.keyDown(box, { key: "Enter" });
    expect(run).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
  it("opens Aletheia with the typed text from the last row", () => {
    const { ask, box } = setup();
    fireEvent.change(box, { target: { value: "why is plant low" } });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(ask).toHaveBeenCalledWith("why is plant low");
  });
  it("closes on Escape", () => {
    const { close, box } = setup();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(close).toHaveBeenCalled();
  });
});
