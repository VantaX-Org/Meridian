import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sheet, clampStep, hasUnsavedSheet } from "../kit";

const steps = [{ id: "pick", label: "Pick", done: true }, { id: "map", label: "Map" }, { id: "load", label: "Load" }];

describe("Sheet steps", () => {
  it("never shows a step past the first one not done", () => {
    expect(clampStep(3, steps)).toBe(2);
    expect(clampStep(1, steps)).toBe(1);
    expect(clampStep(9, [{ done: true }, { done: true }])).toBe(2);
    expect(clampStep(4, undefined)).toBe(1);
  });

  it("moves a link to step 3 back to step 2 when step 2 is not done", () => {
    const onStep = vi.fn();
    render(<Sheet open onClose={() => undefined} title="Load" steps={steps} step={3} onStep={onStep}><p>body</p></Sheet>);
    expect(onStep).toHaveBeenCalledWith(2);
    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument();
  });
});

describe("Sheet with unsaved edits", () => {
  it("asks in the app on browser Back and keeps the sheet and its address", async () => {
    window.history.pushState({ nxSheet: true }, "", "/work?sheet=x:1");
    const onClose = vi.fn();
    render(<Sheet open dirty onClose={onClose} title="Edit"><p>draft</p></Sheet>);
    expect(hasUnsavedSheet()).toBe(true);
    // The guard stops the event, so wait for the dialog rather than for popstate.
    act(() => window.history.back());
    expect(await screen.findByText("Leave without saving?")).toBeInTheDocument();
    expect(window.location.search).toContain("sheet=x");
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Leave" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("asks the browser to confirm a reload or tab close", () => {
    const { unmount } = render(<Sheet open dirty onClose={() => undefined} title="Edit"><p>draft</p></Sheet>);
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    unmount();
    expect(hasUnsavedSheet()).toBe(false);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
  });
});
