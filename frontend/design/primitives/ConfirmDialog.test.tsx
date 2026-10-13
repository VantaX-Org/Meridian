import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("confirms and dismisses", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Delete draft" body="This cannot be undone" confirmLabel="Delete it" tone="danger" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete it" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("blocks confirm until the value is typed", () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onOpenChange={() => {}} title="Delete team" body="Gone for good" confirmLabel="Delete team" typeToConfirm="Finance" onConfirm={onConfirm} />);
    const confirm = screen.getByRole("button", { name: "Delete team" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type Finance to confirm"), { target: { value: "Finance" } });
    expect(confirm).toBeEnabled();
  });

  it("disables both buttons while pending", () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Remove" body="x" confirmLabel="Remove it" pending onConfirm={() => {}} />);
    expect(screen.getByRole("button", { name: "Remove it" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep" })).toBeDisabled();
  });
});
