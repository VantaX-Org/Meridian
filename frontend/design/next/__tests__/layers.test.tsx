import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sheet } from "../kit/Sheet";
import { Popover, place } from "../kit/Popover";

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Sheet title"><button>inside</button></Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("opens as a modal dialog, closes on Esc and returns focus to the opener", async () => {
    const u = userEvent.setup();
    render(<Host />);
    await u.click(screen.getByText("opener"));
    const d = screen.getByRole("dialog", { name: "Sheet title" });
    expect(d).toHaveAttribute("aria-modal", "true");
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByText("opener"));
  });

  it("closes on a click on the scrim but not on the sheet", async () => {
    const u = userEvent.setup();
    render(<Host />);
    await u.click(screen.getByText("opener"));
    await u.click(screen.getByText("inside"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await u.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Popover", () => {
  it("closes on Esc and on an outside click", async () => {
    const u = userEvent.setup();
    const onClose = vi.fn();
    const anchor = document.createElement("button");
    document.body.append(anchor);
    render(<Popover anchor={anchor} open onClose={onClose} label="Menu"><button role="menuitem">a</button><button role="menuitem">b</button></Popover>);
    await u.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveTextContent("b");
    await u.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await u.click(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("flips to the other side when the wanted side would leave the viewport", () => {
    const a = { left: 10, right: 60, top: 560, bottom: 590 } as DOMRect;
    expect(place(a, 100, 100, 800, 600, "bottom").placement).toBe("top");
    expect(place(a, 100, 100, 800, 600, "top").placement).toBe("top");
  });
});
