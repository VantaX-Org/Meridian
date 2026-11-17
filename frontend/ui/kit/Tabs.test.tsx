import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Tabs } from "./Tabs";

describe("Tabs", () => {
  it("selects and moves with arrow keys", () => {
    const on = vi.fn();
    render(<Tabs idBase="t" label="Detail" value="a" onChange={on} items={[{ id: "a", label: "Overview" }, { id: "b", label: "Fix", badge: "3" }]} />);
    expect(screen.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /Fix/ }));
    expect(on).toHaveBeenCalledWith("b");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), { key: "ArrowRight" });
    expect(on).toHaveBeenLastCalledWith("b");
  });
});
