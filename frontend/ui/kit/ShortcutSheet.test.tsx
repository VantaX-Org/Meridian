import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShortcutSheet } from "./ShortcutSheet";

describe("ShortcutSheet", () => {
  it("opens on ? and lists the registered shortcuts", () => {
    render(<ShortcutSheet items={[{ keys: "A", label: "Accept proposal" }, { keys: "J", label: "Next row" }]} />);
    expect(screen.queryByText("Accept proposal")).toBeNull();
    fireEvent.keyDown(document, { key: "?" });
    expect(screen.getByText("Accept proposal")).toBeTruthy();
    expect(screen.getByText("Next row")).toBeTruthy();
  });
  it("ignores ? typed in a field", () => {
    render(<><input aria-label="q" /><ShortcutSheet items={[{ keys: "A", label: "Accept proposal" }]} /></>);
    fireEvent.keyDown(screen.getByLabelText("q"), { key: "?" });
    expect(screen.queryByText("Accept proposal")).toBeNull();
  });
});
