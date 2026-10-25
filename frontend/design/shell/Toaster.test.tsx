import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { Toaster } from "./Toaster";
import { apiErrorMessage } from "@/lib/error";

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

  it("sits above the Ask Meridian launcher, never over it", async () => {
    render(<Toaster />);
    act(() => { toast("Saved"); });
    await screen.findByText("Saved");
    const viewport = document.querySelector("[data-sonner-toaster]") as HTMLElement;
    expect(viewport.style.getPropertyValue("--offset-bottom")).toBe("64px");
    expect(viewport.style.getPropertyValue("--offset-right")).toBe("16px");
  });

  it("never gets an empty error message to show", () => {
    expect(apiErrorMessage(new Error(""))).toBe("Could not reach the server.");
    expect(apiErrorMessage(undefined)).toBe("Could not reach the server.");
  });
});
