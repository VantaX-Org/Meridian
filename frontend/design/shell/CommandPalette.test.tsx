import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  it("renders a visible Search trigger and opens the palette on click", () => {
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

      expect(screen.queryByPlaceholderText("Jump to...")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Search" }));

      expect(screen.getByPlaceholderText("Jump to...")).toBeInTheDocument();
    } finally {
      (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = originalRO;
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView as () => void;
    }
  });
});
