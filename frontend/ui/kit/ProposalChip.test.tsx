import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProposalChip } from "./ProposalChip";

const setup = (withEvidence = true) => {
  const [accept, reject, edit] = [vi.fn(), vi.fn(), vi.fn()];
  render(<ProposalChip current="Steel" proposed="STEEL" confidence="92 out of 100" reasons={[{ id: "wrong", label: "Wrong value" }, { id: "later", label: "Not now" }]}
    evidence={withEvidence ? { source: "Plant 1000 history", reason: "Same description in 14 records", confidence: 92 } : undefined} onAccept={accept} onReject={reject} onEdit={edit} />);
  return { accept, reject, edit, chip: screen.getByRole("group") };
};

describe("ProposalChip", () => {
  it("shows current struck through, proposed and confidence text", () => {
    setup();
    expect(screen.getByText("Steel").tagName).toBe("DEL");
    expect(screen.getByText("STEEL").tagName).toBe("INS");
    expect(screen.getByText("92 out of 100")).toBeTruthy();
  });
  it("A accepts and E edits", () => {
    const { accept, edit, chip } = setup();
    fireEvent.keyDown(chip, { key: "a" });
    fireEvent.keyDown(chip, { key: "e" });
    expect(accept).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledTimes(1);
  });
  it("R opens the reason menu and a reason rejects with its id", () => {
    const { reject, chip } = setup();
    fireEvent.keyDown(chip, { key: "r" });
    fireEvent.click(screen.getByRole("menuitem", { name: "Not now" }));
    expect(reject).toHaveBeenCalledWith("later");
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("I opens the evidence and Escape closes it; no evidence prop, no evidence button", () => {
    const { chip } = setup();
    fireEvent.keyDown(chip, { key: "i" });
    expect(screen.getByText("Same description in 14 records")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("ignores keys typed inside its own buttons and omits Evidence without data", () => {
    const { accept } = setup(false);
    fireEvent.keyDown(screen.getByRole("button", { name: "Edit" }), { key: "a" });
    expect(accept).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Evidence" })).toBeNull();
  });
});
