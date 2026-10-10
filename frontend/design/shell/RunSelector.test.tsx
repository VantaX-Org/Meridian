import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/objects/material_master",
  useSearchParams: () => new URLSearchParams("run=v1"),
}));

import { RunSelector } from "./RunSelector";

describe("RunSelector", () => {
  it("rewrites ?run= on the current URL when a run is chosen", async () => {
    render(<RunSelector runs={[{ id: "v1", label: "Run 1" }, { id: "v2", label: "Run 2" }]} />);
    fireEvent.click(screen.getByLabelText("Run"));
    const option = (await screen.findByText("Run 2")).closest('[role="option"]')!;
    // Base UI's listbox only commits a selection on pointerup once the item
    // is "highlighted" by a prior pointer move — a plain click is a no-op.
    fireEvent.pointerMove(option, { pointerType: "mouse" });
    fireEvent.mouseOver(option);
    fireEvent.mouseMove(option);
    fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
    fireEvent.mouseDown(option, { button: 0 });
    fireEvent.pointerUp(option, { pointerType: "mouse", button: 0 });
    fireEvent.mouseUp(option, { button: 0 });
    fireEvent.click(option);
    expect(replace).toHaveBeenCalledWith("/objects/material_master?run=v2", { scroll: false });
  });
});
