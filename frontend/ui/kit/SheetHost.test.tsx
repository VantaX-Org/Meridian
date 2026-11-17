import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SheetHost, useSheet } from "./SheetHost";

function Opener() {
  const s = useSheet();
  return <button type="button" onClick={() => s.open("rule", "R1")}>go</button>;
}

describe("SheetHost", () => {
  it("opens a registered sheet with its argument and closes it", () => {
    render(<SheetHost closeLabel="Close" sheets={{ rule: { label: "Rule", render: (a) => <p>rule {String(a)}</p> } }}><Opener /></SheetHost>);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("go"));
    expect(screen.getByRole("dialog", { name: "Rule" }).textContent).toContain("rule R1");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
