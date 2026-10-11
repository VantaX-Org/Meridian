import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dialog } from "./Dialog";
import { Drawer } from "./Drawer";

describe("Dialog and Drawer (wave 6)", () => {
  it("Dialog renders body and right-aligned footer", () => {
    render(<Dialog open onOpenChange={() => {}} title="Delete rule" destructive footer={<button>Confirm</button>}>Sure?</Dialog>);
    expect(screen.getByText("Delete rule").style.fontSize).toBe("var(--m-text-title)");
    expect(screen.getByText("Confirm").parentElement).toHaveClass("justify-end");
  });

  it("Drawer renders subtitle, footer, close, and floats inset at lg", () => {
    render(<Drawer open onOpenChange={() => {}} title="Finding" subtitle={<span>CHK-1</span>} footer={<button>Save</button>}>body</Drawer>);
    expect(screen.getByText("CHK-1")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
    const popup = screen.getByText("body").parentElement as HTMLElement;
    expect(popup.className).toContain("w-[480px]");
    expect(popup.className).toContain("lg:right-2");
  });
});
