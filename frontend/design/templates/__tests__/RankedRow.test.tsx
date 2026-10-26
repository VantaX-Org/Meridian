import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RankedRow } from "../RankedRow";

describe("RankedRow", () => {
  it("draws the severity bar in its fill tone at the row's share, with label, magnitude and meta", () => {
    const { container } = render(<ul><RankedRow tone="critical" label="MM041" magnitude="1,240" share={50} meta="Material master" testId="row" onSelect={() => {}} /></ul>);
    const fill = container.querySelector(".m-ranked-fill");
    expect(fill).toHaveAttribute("data-tone", "critical");
    expect(fill).toHaveStyle({ width: "50%" });
    expect(screen.getByTestId("row")).toHaveTextContent("MM0411,240Material master");
  });

  it("draws no bar without a share and clamps an out-of-range share", () => {
    const { container, rerender } = render(<ul><RankedRow tone="pass" label="A" onSelect={() => {}} /></ul>);
    expect(container.querySelector(".m-ranked-track")).toBeNull();
    rerender(<ul><RankedRow tone="pass" label="A" share={140} onSelect={() => {}} /></ul>);
    expect(container.querySelector(".m-ranked-fill")).toHaveStyle({ width: "100%" });
  });

  it("selects through a button, marks the current row, and keeps lead and aside outside the button", () => {
    const onSelect = vi.fn();
    render(<ul><RankedRow tone="high" label="Task" selected onSelect={onSelect} lead={<input type="checkbox" aria-label="Pick" />} aside={<span>Due today</span>} /></ul>);
    const button = screen.getByRole("button", { name: /Task/ });
    expect(button).toHaveAttribute("aria-current", "true");
    expect(button).not.toContainElement(screen.getByRole("checkbox", { name: "Pick" }));
    expect(button).not.toHaveTextContent("Due today");
    expect(button.closest("li")).toHaveAttribute("data-selected", "true");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalled();
  });

  it("selects through a link when given an href", () => {
    render(<ul><RankedRow tone="low" label="Rule" href="/objects/x?rule=r" replace /></ul>);
    expect(screen.getByRole("link", { name: /Rule/ })).toHaveAttribute("href", "/objects/x?rule=r");
  });
});
