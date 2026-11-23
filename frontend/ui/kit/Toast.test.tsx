import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastHost, useToast } from "./Toast";

function Fire() {
  const toast = useToast();
  return <button type="button" onClick={() => toast("Saved", "good")}>fire</button>;
}

describe("Toast", () => {
  afterEach(() => vi.useRealTimers());
  it("shows a message in a live region and clears it", () => {
    vi.useFakeTimers();
    render(<ToastHost ms={1000}><Fire /></ToastHost>);
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByRole("status").textContent).toBe("Saved");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("Toast action", () => {
  function Act({ onUndo }: { onUndo: () => void }) {
    const toast = useToast();
    return <button type="button" onClick={() => toast("Accepted", "info", { action: { label: "Undo", onAction: onUndo, undo: true }, progress: 0.5 })}>fire</button>;
  }
  it("fires the action from the button and closes", () => {
    const undo = vi.fn();
    render(<ToastHost><Act onUndo={undo} /></ToastHost>);
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByRole("progressbar")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Accepted")).toBeNull();
  });
  it("Ctrl Z calls undo while open", () => {
    const undo = vi.fn();
    render(<ToastHost><Act onUndo={undo} /></ToastHost>);
    fireEvent.click(screen.getByText("fire"));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
