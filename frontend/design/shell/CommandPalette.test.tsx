import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { CommandPalette } from "./CommandPalette";
import { allowConsoleError } from "@/vitest.console";

// cmdk 1.1.1 renders a Radix Dialog.Content without a Dialog.Title and logs Radix's a11y warning on open.
// Fixing that needs a direct @radix-ui/react-dialog import (a new dependency), so the warning is allowed here.
const allowPaletteTitleWarning = allowConsoleError;

describe("CommandPalette", () => {
  it("renders a visible Search trigger and opens the palette on click", () => {
    allowPaletteTitleWarning();
    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    const originalRO = globalThis.ResizeObserver;
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView as unknown;
    HTMLElement.prototype.scrollIntoView = vi.fn();

    try {
      render(<CommandPalette items={[{ label: "Material master", href: "/objects/material_master" }]} />);

      expect(screen.queryByPlaceholderText("Type a page, object, check ID or record key")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Search" }));

      expect(screen.getByPlaceholderText("Type a page, object, check ID or record key")).toBeInTheDocument();
    } finally {
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalRO;
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView as () => void;
    }
  });
});

describe("CommandPalette grammar", () => {
  it("shows chips and routes the parsed href on select", () => {
    allowPaletteTitleWarning();
    class RO { observe() {} unobserve() {} disconnect() {} }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    push.mockClear();
    render(<CommandPalette items={[]} grammar={{ objects: [{ module: "material_master", label: "Material master" }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Type a page, object, check ID or record key"), { target: { value: "critical material master last run" } });
    expect(screen.getByLabelText("Parsed filters").textContent).toContain("Last run");
    fireEvent.click(screen.getByText("Open filtered view"));
    expect(push).toHaveBeenCalledWith("/objects/material_master?tab=rules&severity=critical");
  });
});

describe("CommandPalette item shortcuts", () => {
  const openPalette = () => fireEvent.keyDown(document, { key: "k", metaKey: true });
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const originalRO = globalThis.ResizeObserver;
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView as unknown;
  beforeEach(() => {
    allowPaletteTitleWarning();
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalRO;
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView as typeof HTMLElement.prototype.scrollIntoView;
  });

  it("goes to the item whose key hint matches while the palette is open, with ⌘ or Ctrl", () => {
    push.mockClear();
    render(<CommandPalette items={[{ label: "Home", href: "/home/steward", shortcut: "⌘1" }, { label: "Runs", href: "/runs" }]} />);
    openPalette();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "1", metaKey: true });
    expect(push).toHaveBeenCalledWith("/home/steward");
    openPalette();
    fireEvent.keyDown(document, { key: "1", ctrlKey: true });
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("leaves ⌘/Ctrl + digit to the browser while the palette is closed", () => {
    push.mockClear();
    render(<CommandPalette items={[{ label: "Home", href: "/home/lead", shortcut: "⌘1" }]} />);
    const meta = new KeyboardEvent("keydown", { key: "1", metaKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(meta);
    const ctrl = new KeyboardEvent("keydown", { key: "1", ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ctrl);
    expect(meta.defaultPrevented).toBe(false);
    expect(ctrl.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps ⌘K global, even while typing in a box", () => {
    render(
      <>
        <input aria-label="Elsewhere" />
        <CommandPalette items={[{ label: "Home", href: "/home/lead", shortcut: "⌘1" }]} />
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("Elsewhere"), { key: "k", ctrlKey: true });
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("never takes the digit from a box outside the palette", () => {
    push.mockClear();
    render(
      <>
        <input aria-label="Elsewhere" />
        <CommandPalette items={[{ label: "Home", href: "/home/lead", shortcut: "⌘1" }]} />
      </>,
    );
    openPalette();
    fireEvent.keyDown(screen.getByLabelText("Elsewhere"), { key: "1", metaKey: true });
    expect(push).not.toHaveBeenCalled();
  });

  it("ignores the digit without a modifier and keys no item claims", () => {
    push.mockClear();
    render(<CommandPalette items={[{ label: "Home", href: "/home/lead", shortcut: "⌘1" }]} />);
    openPalette();
    fireEvent.keyDown(document, { key: "1" });
    fireEvent.keyDown(document, { key: "2", metaKey: true });
    fireEvent.keyDown(document, { key: "1", metaKey: true, shiftKey: true });
    expect(push).not.toHaveBeenCalled();
  });
});

describe("CommandPalette records and the / key", () => {
  class StubResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  const originalRO = globalThis.ResizeObserver;
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView as unknown;
  beforeEach(() => {
    allowPaletteTitleWarning();
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    push.mockClear();
  });
  afterEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalRO;
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView as typeof HTMLElement.prototype.scrollIntoView;
  });

  it("opens on / outside a text field, not inside one", () => {
    render(<><input aria-label="Elsewhere" /><CommandPalette items={[]} /></>);
    fireEvent.keyDown(screen.getByLabelText("Elsewhere"), { key: "/" });
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("reports the typed text, and shows and opens the record hits it is given", () => {
    const onQueryChange = vi.fn();
    const records = [{ label: "Bolt 1 (Material master, MATNR=M1, 2 issues)", href: "/objects/material_master?record=MATNR%3DM1", group: "Records" }];
    render(<CommandPalette items={[]} records={records} onQueryChange={onQueryChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Type a page, object, check ID or record key"), { target: { value: "bolt" } });
    expect(onQueryChange).toHaveBeenLastCalledWith("bolt");
    expect(screen.getByText("Records")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Bolt 1/));
    expect(push).toHaveBeenCalledWith("/objects/material_master?record=MATNR%3DM1");
  });
});
