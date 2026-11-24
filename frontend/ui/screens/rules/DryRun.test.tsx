import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider, ToastHost } from "@/ui/kit";
import { DryRun } from "./DryRun";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.history.replaceState(null, "", "/rules/dry-run?fixture=1"); });
afterEach(() => undo());

describe("impact of a rule change", () => {
  it("waits for a rule id, then shows the records failing", async () => {
    renderWithQuery(<AletheiaProvider><ToastHost><DryRun /></ToastHost></AletheiaProvider>);
    const check = (await screen.findByRole("button", { name: "Check the impact" })) as HTMLButtonElement;
    expect(check.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: /^Rule to change/ }), { target: { value: "MM142" } });
    expect(check.disabled).toBe(false);
    fireEvent.click(check);
    expect(await screen.findByText("Records failing")).toBeTruthy();
  });

  it("drafts a rule from words into the definition box", async () => {
    renderWithQuery(<AletheiaProvider><ToastHost><DryRun /></ToastHost></AletheiaProvider>);
    fireEvent.change(await screen.findByRole("textbox", { name: "What should the rule check?" }), { target: { value: "Every material has a base unit" } });
    fireEvent.click(screen.getByRole("button", { name: "Draft the rule" }));
    const box = screen.getByRole("textbox", { name: "Rule definition" }) as HTMLTextAreaElement;
    await vi.waitFor(() => expect(box.value).toContain("ZR000500"));
  });
});
