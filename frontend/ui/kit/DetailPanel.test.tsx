import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { DetailPanel } from "./DetailPanel";

function Demo() {
  const [v, set] = useState("overview");
  return <DetailPanel idBase="d" label="Selected rule" header={<h2>MM003</h2>} tabsLabel="Rule detail" tabs={[{ id: "overview", label: "Overview" }, { id: "fix", label: "Fix" }]} value={v} onChange={set}><p>{v} body</p></DetailPanel>;
}

describe("DetailPanel", () => {
  it("switches the panel with the tabs", () => {
    render(<Demo />);
    expect(screen.getByText("overview body")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Fix" }));
    expect(screen.getByText("fix body")).toBeTruthy();
    expect(screen.getByRole("tabpanel")).toBeTruthy();
  });
  it("side mode: focus moves in, Tab wraps, Escape closes, J and K step without closing", () => {
    const [close, next, prev] = [vi.fn(), vi.fn(), vi.fn()];
    render(<><button>outside</button><DetailPanel side idBase="d" label="Selected rule" header={<h2>MM003</h2>} tabsLabel="Rule detail" tabs={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} value="a" onChange={() => {}} onClose={close} onNext={next} onPrev={prev}><input aria-label="note" /></DetailPanel></>);
    const panel = screen.getByRole("region", { name: "Selected rule" });
    const tabs = screen.getAllByRole("tab");
    expect(panel.contains(document.activeElement)).toBe(true);
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByLabelText("note"));
    fireEvent.keyDown(screen.getByLabelText("note"), { key: "Tab" });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0], { key: "j" });
    fireEvent.keyDown(tabs[0], { key: "k" });
    expect(next).toHaveBeenCalledTimes(1);
    expect(prev).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("note"), { key: "j" });
    expect(next).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(tabs[0], { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
