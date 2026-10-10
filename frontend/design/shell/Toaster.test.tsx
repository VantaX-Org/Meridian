import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { Toaster } from "./Toaster";
import { apiErrorMessage } from "@/lib/api/optional";

describe("Toaster", () => {
  it("shows the text of every stacked toast, not only the front one", async () => {
    render(<Toaster />);
    act(() => {
      toast("Approved 3");
      toast.error("Rule not updated");
    });
    expect(await screen.findByText("Approved 3")).toBeInTheDocument();
    expect(await screen.findByText("Rule not updated")).toBeInTheDocument();
    const toasts = [...document.querySelectorAll("[data-sonner-toast]")];
    expect(toasts.map((t) => t.getAttribute("data-expanded"))).toEqual(["true", "true"]);
  });

  it("never gets an empty error message to show", () => {
    expect(apiErrorMessage(new Error(""))).toBe("Something went wrong.");
    expect(apiErrorMessage(undefined)).toBe("Something went wrong.");
    expect(apiErrorMessage(new Error("Batch not found"))).toBe("Batch not found");
  });
});
