import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FirstRunChecklist, type ChecklistItem } from "../FirstRunChecklist";

const items: ChecklistItem[] = [
  { id: "system", label: "Connect a system", done: true, href: "/systems" },
  { id: "run", label: "Complete a first run", done: false, href: "/systems" },
  { id: "team", label: "Invite your team", done: false, href: "/admin/users" },
];

describe("FirstRunChecklist", () => {
  it("shows progress and a link per item, marking done ones in words", () => {
    render(<FirstRunChecklist items={items} onDismiss={() => {}} />);
    expect(screen.getByText("1 of 3 done")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Connect a system/ })).toHaveTextContent("done");
    expect(screen.getByRole("link", { name: /Complete a first run/ })).toHaveTextContent("not done yet");
    expect(screen.getByRole("link", { name: /Invite your team/ })).toHaveAttribute("href", "/admin/users");
  });

  it("can be dismissed", () => {
    const onDismiss = vi.fn();
    render(<FirstRunChecklist items={items} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing once every item is done", () => {
    const { container } = render(<FirstRunChecklist items={items.map((i) => ({ ...i, done: true }))} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there are no items", () => {
    const { container } = render(<FirstRunChecklist items={[]} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
