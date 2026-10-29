import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast, Toaster } from "./Toaster";

describe("toast.undoable", () => {
  // sonner removes a closed toast on an untracked 200ms timer: let it run before the file's environment is torn down,
  // or its setState lands on a missing window.
  afterEach(async () => {
    toast.dismiss();
    await waitFor(() => expect(document.querySelector("[data-sonner-toast]")).toBeNull());
  });

  it("shows an Undo action that runs the inverse and confirms", async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    render(<Toaster />);
    toast.undoable("Rule disabled", { undo });
    expect(await screen.findByText("Rule disabled")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Undone")).toBeInTheDocument();
  });

  it("says so when the inverse fails", async () => {
    const undo = vi.fn().mockRejectedValue(new Error("nope"));
    render(<Toaster />);
    toast.undoable("Rule enabled", { undo });
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(screen.getByText("Could not undo")).toBeInTheDocument());
  });

  it("keeps the plain toast API", async () => {
    render(<Toaster />);
    toast.success("Saved");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});
