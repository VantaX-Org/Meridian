import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "./ConfirmDialog";

function setup(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConfirmDialog open onOpenChange={onOpenChange} title="Delete team" body="This removes the team." confirmLabel="Delete team" onConfirm={onConfirm} {...props} />,
  );
  return { onConfirm, onOpenChange };
}

describe("ConfirmDialog", () => {
  it("renders title, body and the inverse action label", () => {
    setup();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Delete team");
    expect(screen.getByText("This removes the team.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
  });

  it("confirms on click and closes through the keep button", async () => {
    const { onConfirm, onOpenChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Delete team" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("uses the danger button for the danger tone", () => {
    setup({ tone: "danger" });
    expect(screen.getByRole("button", { name: "Delete team" })).toHaveClass("m-btn-danger");
  });

  it("keeps confirm disabled until the exact value is typed", async () => {
    const { onConfirm } = setup({ tone: "danger", typeToConfirm: "Finance" });
    const confirm = screen.getByRole("button", { name: "Delete team" });
    expect(confirm).toBeDisabled();
    const input = screen.getByLabelText("Type to confirm");
    await userEvent.type(input, "finance");
    expect(confirm).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "Finance");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("clears the typed value when closed through the open prop", async () => {
    const onConfirm = vi.fn();
    const props = { onOpenChange: vi.fn(), title: "Delete team", body: "Gone.", confirmLabel: "Delete team", tone: "danger" as const, typeToConfirm: "Finance", onConfirm };
    const { rerender } = render(<ConfirmDialog open {...props} />);
    await userEvent.type(screen.getByLabelText("Type to confirm"), "Finance");
    expect(screen.getByRole("button", { name: "Delete team" })).toBeEnabled();
    rerender(<ConfirmDialog open={false} {...props} />);
    rerender(<ConfirmDialog open {...props} />);
    expect(screen.getByRole("button", { name: "Delete team" })).toBeDisabled();
  });

  it("disables both buttons while pending and cannot be dismissed", async () => {
    const { onOpenChange } = setup({ pending: true });
    expect(screen.getByRole("button", { name: "Keep" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete team" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
