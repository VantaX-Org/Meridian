import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MasterList, type MasterRow } from "./MasterList";

const rows: MasterRow[] = [
  { id: "MM003", severity: "critical", severityLabel: "Critical", code: "MM003", text: "Base unit missing", field: { code: "MARA-MEINS", description: "Base unit of measure" }, countLabel: "1.2k", ratio: 1 },
  { id: "MM035", severity: "high", severityLabel: "High", code: "MM035", text: "Weight missing", countLabel: "300", ratio: 0.25 },
];

describe("MasterList", () => {
  it("marks the selected row and reports a pick", () => {
    const pick = vi.fn();
    render(<MasterList label="Failing rules" rows={rows} selectedId="MM003" onSelect={pick} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Base unit of measure")).toBeTruthy();
    fireEvent.click(buttons[1]);
    expect(pick).toHaveBeenCalledWith("MM035");
  });
});
