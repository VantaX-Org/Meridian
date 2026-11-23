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
  it("puts server hits first while text is typed and reports each keystroke", () => {
    const onQuery = vi.fn();
    const hit = vi.fn();
    render(<CommandPalette open onClose={vi.fn()} onAsk={vi.fn()} label="Command palette" placeholder="Type" askLabel={(q) => `Ask: ${q}`} emptyLabel="None"
      commands={[{ id: "home", label: "Go to Home", run: vi.fn() }]} onQuery={onQuery} extra={[{ id: "m1", label: "Material 100", hint: "Records", run: hit }]} />);
    expect(screen.getAllByRole("option")).toHaveLength(1);
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "100" } });
    expect(onQuery).toHaveBeenCalledWith("100");
    expect(screen.getAllByRole("option")[0].textContent).toMatch(/Material 100/);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(hit).toHaveBeenCalled();
  });
  it("shows screen context commands first with their shortcut", () => {
    const run = vi.fn();
    render(<CommandPalette open onClose={vi.fn()} onAsk={vi.fn()} label="Command palette" placeholder="Type" askLabel={(q) => `Ask: ${q}`} emptyLabel="None"
      commands={[{ id: "home", label: "Go to Home", run: vi.fn() }]} context={[{ id: "acc", label: "Accept all", shortcut: "Shift+A", run }]} contextLabel="On this screen" />);
    const opts = screen.getAllByRole("option");
    expect(opts[0].textContent).toContain("Accept all");
    expect(opts[0].textContent).toContain("Shift+A");
    expect(screen.getByText("On this screen")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(run).toHaveBeenCalled();
  });
});
