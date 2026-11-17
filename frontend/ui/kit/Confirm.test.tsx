import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Confirm } from "./Confirm";

describe("Confirm", () => {
  it("confirms, cancels and cancels on Escape; focus starts on Cancel", () => {
    const yes = vi.fn();
    const no = vi.fn();
    render(<Confirm open title="Delete run?" confirmLabel="Delete" cancelLabel="Keep" onConfirm={yes} onCancel={no} danger>This cannot be undone.</Confirm>);
    expect(screen.getByRole("alertdialog", { name: "Delete run?" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(yes).toHaveBeenCalledTimes(1);
    expect(no).toHaveBeenCalledTimes(1);
  });
  it("renders nothing when closed", () => {
    render(<Confirm open={false} title="x" confirmLabel="a" cancelLabel="b" onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
