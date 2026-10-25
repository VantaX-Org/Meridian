import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { INBOX_SHORTCUTS, navShortcuts, shortcutRegistry, shortcutSections } from "@/lib/shortcuts";
import { ShortcutSheet, useShortcutHotkey } from "./ShortcutSheet";

function Hotkey({ onTrigger }: { onTrigger: () => void }) {
  useShortcutHotkey(onTrigger);
  return <input aria-label="Search" />;
}

describe("ShortcutSheet", () => {
  it("lists the four groups from the registry", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    const sheet = screen.getByTestId("shortcut-sheet");
    for (const group of ["Navigation", "Tables", "Inbox", "Global"]) {
      expect(within(sheet).getByRole("heading", { name: group })).toBeInTheDocument();
    }
    for (const s of shortcutRegistry()) expect(within(sheet).getAllByText(s.description).length).toBeGreaterThan(0);
  });

  it("shows the inbox keys from the registry", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} />);
    for (const s of INBOX_SHORTCUTS) expect(screen.getAllByText(s.keys).length).toBeGreaterThan(0);
    expect(screen.getByText("j / k")).toBeInTheDocument();
  });

  it("puts the page's own group first", () => {
    render(<ShortcutSheet open onOpenChange={() => {}} first="Inbox" />);
    const headings = within(screen.getByTestId("shortcut-sheet")).getAllByRole("heading").map((h) => h.textContent);
    expect(headings[0]).toBe("Inbox");
  });

  it("renders nothing when closed", () => {
    render(<ShortcutSheet open={false} onOpenChange={() => {}} />);
    expect(screen.queryByTestId("shortcut-sheet")).not.toBeInTheDocument();
  });

  it("takes navigation shortcuts from the nav definition", () => {
    expect(navShortcuts()).toContainEqual({ group: "Navigation", keys: "⌘1", description: "Go to Home" });
    expect(shortcutSections().map((s) => s.group)).toEqual(["Navigation", "Tables", "Inbox", "Designer", "Global"]);
  });

  it("lists no key for collapsing the navigation (there is no sidebar to collapse)", () => {
    expect(shortcutRegistry().map((s) => s.keys)).not.toContain("[");
    expect(shortcutRegistry().map((s) => s.description)).not.toContain("Collapse or expand the navigation");
  });

  it("is the only list of inbox keys: the inbox page keeps none of its own", () => {
    const src = readFileSync(path.resolve(__dirname, "..", "..", "app", "(app)", "inbox", "page.tsx"), "utf8");
    expect(src).not.toContain("Keyboard shortcuts");
    expect(src).not.toContain('"j / k"');
  });
});

describe("useShortcutHotkey", () => {
  it("fires on ? outside an input", () => {
    const onTrigger = vi.fn();
    render(<Hotkey onTrigger={onTrigger} />);
    fireEvent.keyDown(document.body, { key: "?" });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("stays quiet while typing, with a modifier, or for other keys", () => {
    const onTrigger = vi.fn();
    render(<Hotkey onTrigger={onTrigger} />);
    fireEvent.keyDown(screen.getByLabelText("Search"), { key: "?" });
    fireEvent.keyDown(document.body, { key: "?", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "k" });
    expect(onTrigger).not.toHaveBeenCalled();
  });
});
