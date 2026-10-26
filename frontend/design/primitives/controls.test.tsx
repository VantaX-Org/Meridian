import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { Mono } from "./Mono";
import { Pill } from "./Pill";
import { Tabs } from "./Tabs";

describe("wave 5 controls", () => {
  it("Button supports danger, size and pending", () => {
    render(<Button variant="danger" size="lg" pending>Delete</Button>);
    const b = screen.getByRole("button", { name: "Delete" });
    expect(b).toHaveClass("m-btn-danger", "m-btn-lg");
    expect(b).toBeDisabled();
  });
  it("Badge inverts for the active rail row", () => {
    render(<Badge count={3} inverted />);
    expect(screen.getByText("3")).toHaveClass("m-badge-inverted");
  });
  it("Pill renders a dot for status tones, none for info", () => {
    const { container, rerender } = render(<Pill tone="go">Go</Pill>);
    expect(container.querySelector(".m-pill-dot")).not.toBeNull();
    rerender(<Pill tone="info">Info</Pill>);
    expect(container.querySelector(".m-pill-dot")).toBeNull();
    expect(container.firstChild).toHaveClass("m-pill-info");
  });
  it("Mono inline adds the well; Card renders header", () => {
    render(<><Mono inline>abc</Mono><Card title="T" meta="M">body</Card></>);
    expect(screen.getByText("abc")).toHaveClass("m-mono-inline");
    expect(screen.getByRole("heading", { name: "T" })).toBeInTheDocument();
  });
  it("Tabs renders a single sliding indicator", () => {
    const { container } = render(<Tabs items={[{ value: "a", label: "A", content: "x", count: 2 }, { value: "b", label: "B", content: "y" }]} />);
    expect(container.querySelectorAll(".m-tab-indicator").length).toBe(1);
    expect(screen.getByText("2")).toBeInTheDocument();
  });
  it("Tabs offers a Select below 640px that shares the strip's value", async () => {
    const onValueChange = vi.fn();
    render(<Tabs label="View" items={[{ value: "a", label: "Alpha", content: "x" }, { value: "b", label: "Beta", content: "y", count: 4 }]} onValueChange={onValueChange} />);
    expect(screen.getByRole("tablist")).toHaveClass("max-sm:hidden");
    const select = screen.getByRole("combobox", { name: "View" });
    expect(select.closest(".sm\\:hidden")).not.toBeNull();
    expect(select).toHaveTextContent("Alpha");
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole("option", { name: "Beta (4)" }));
    expect(onValueChange).toHaveBeenCalledWith("b");
    // uncontrolled: the strip follows the Select
    expect(screen.getByRole("tab", { name: /Beta/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("y")).toBeVisible();
  });
  it("Card puts its actions on their own row below 640px", () => {
    const { container } = render(<Card title="T" actions={<button>Go</button>}>body</Card>);
    expect(container.querySelector("header")).toHaveClass("max-sm:flex-wrap");
    expect(screen.getByRole("button", { name: "Go" }).parentElement).toHaveClass("contents", "max-sm:basis-full");
  });
});
