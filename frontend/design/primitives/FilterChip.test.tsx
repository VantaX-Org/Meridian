import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FilterChip } from "./FilterChip";
import { Tabs } from "./Tabs";
import { ReportPage } from "../templates/ReportPage";

describe("FilterChip", () => {
  it("shows label and value and removes on click", () => {
    const onRemove = vi.fn();
    render(<FilterChip label="Status" value="Open" onRemove={onRemove} />);
    expect(screen.getByText("Open")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove filter Status" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe("Tabs onTabHover", () => {
  it("fires on pointer enter and focus of a tab", () => {
    const onTabHover = vi.fn();
    render(<Tabs items={[{ value: "a", label: "A", content: "x" }, { value: "b", label: "B", content: "y" }]} onTabHover={onTabHover} />);
    fireEvent.pointerEnter(screen.getByRole("tab", { name: "B" }));
    expect(onTabHover).toHaveBeenLastCalledWith("b");
    fireEvent.focus(screen.getByRole("tab", { name: "A" }));
    expect(onTabHover).toHaveBeenLastCalledWith("a");
  });
});

describe("ReportPage loading", () => {
  it("renders a custom loading node, and the default skeleton otherwise", () => {
    const { rerender, container } = render(<ReportPage narrative="n" charts={null} state="loading" loading={<div data-testid="mine" />} />);
    expect(screen.getByTestId("mine")).toBeInTheDocument();
    rerender(<ReportPage narrative="n" charts={null} state="loading" />);
    expect(container.querySelector("[data-state='loading']")).not.toBeNull();
  });
});
