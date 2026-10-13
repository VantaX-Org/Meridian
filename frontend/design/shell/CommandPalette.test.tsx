import { describe, expect, it, vi } from "vitest";
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
    render(<CommandPalette items={[]} grammar={{ objects: [{ module: "material_master", label: "Material master" }], systems: ["PRD"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.change(screen.getByPlaceholderText("Type a page, object, check ID or record key"), { target: { value: "critical material master in PRD last run" } });
    expect(screen.getByLabelText("Parsed filters").textContent).toContain("Last run");
    fireEvent.click(screen.getByText("Open filtered view"));
    expect(push).toHaveBeenCalledWith("/objects/material_master?severity=critical&system=PRD&run=latest");
  });
});
