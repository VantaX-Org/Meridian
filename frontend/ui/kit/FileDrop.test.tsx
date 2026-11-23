import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileDrop } from "./FileDrop";

describe("FileDrop", () => {
  it("passes a picked file on and shows the status line", () => {
    const on = vi.fn();
    render(<FileDrop accept=".xlsx" label="Pick" status="Drop a workbook" onFile={on} />);
    expect(screen.getByText("Drop a workbook")).toBeTruthy();
    const f = new File(["x"], "fix.xlsx");
    fireEvent.change(screen.getByLabelText("Pick"), { target: { files: [f] } });
    expect(on).toHaveBeenCalledWith(f);
  });
  it("takes a dropped file and clears the over state", () => {
    const on = vi.fn();
    const { container } = render(<FileDrop accept=".csv" label="Pick" status="s" onFile={on} />);
    const zone = container.firstElementChild as HTMLElement;
    const f = new File(["x"], "a.csv");
    fireEvent.dragOver(zone);
    expect(zone.getAttribute("data-over")).toBe("true");
    const drop = createEvent.drop(zone);
    Object.defineProperty(drop, "dataTransfer", { value: { files: [f] } });
    fireEvent(zone, drop);
    expect(on).toHaveBeenCalledWith(f);
    expect(zone.getAttribute("data-over")).toBe("false");
  });
});
