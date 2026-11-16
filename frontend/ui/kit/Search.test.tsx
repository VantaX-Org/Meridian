import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Search } from "./Search";

describe("Search", () => {
  it("reports typing and clears", () => {
    const on = vi.fn();
    const { rerender } = render(<Search value="" onChange={on} label="Search rules" clearLabel="Clear" />);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search rules" }), { target: { value: "mat" } });
    expect(on).toHaveBeenCalledWith("mat");
    rerender(<Search value="mat" onChange={on} label="Search rules" clearLabel="Clear" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(on).toHaveBeenLastCalledWith("");
  });
});
