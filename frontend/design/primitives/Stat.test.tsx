import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Stat } from "./Stat";

describe("Stat", () => {
  it("renders a button with m-stat-link when onClick is set", () => {
    const onClick = vi.fn();
    render(<Stat label="Open" value={3} onClick={onClick} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("m-stat", "m-stat-link");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("hides the value while loading", () => {
    render(<Stat label="Open" value="42" loading />);
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });

  it("never breaks a word value mid-word: one line, truncated, the full word in its title", () => {
    render(<Stat label="Health" value="Unreachable" />);
    const v = screen.getByText("Unreachable");
    expect(v).toHaveClass("truncate");
    expect(v).toHaveAttribute("title", "Unreachable");
    expect(v.style.overflowWrap).toBe("normal");
    expect(v.style.fontSize).toBe("var(--m-text-verdict)");
  });

  it("keeps a money value on one line: currency, figure and scale never wrap apart", () => {
    render(<Stat label="Cost at risk" value="ZAR 4.79 m" />);
    const v = screen.getByText("ZAR 4.79 m");
    expect(v).toHaveClass("whitespace-nowrap", "truncate");
    expect(v).toHaveAttribute("title", "ZAR 4.79 m");
    expect(v.style.fontSize).toBe("var(--m-text-verdict)");
  });

  it("still lets a sentence value wrap between words", () => {
    render(<Stat label="Most at risk" value="No SAP feature priced" />);
    expect(screen.getByText("No SAP feature priced")).not.toHaveClass("whitespace-nowrap");
  });

  it("keeps numbers on the stat size and lets them wrap", () => {
    render(<Stat label="Open" value={1234} />);
    const v = screen.getByText("1,234");
    expect(v).not.toHaveClass("truncate");
    expect(v.style.fontSize).toBe("var(--m-text-stat)");
  });
});
