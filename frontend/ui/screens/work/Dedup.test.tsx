import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { Dedup } from "./Dedup";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.history.replaceState(null, "", "/work?fixture=1"); });
afterEach(() => undo());

describe("Dedup", () => {
  it("walks pair, preview, confirm, merge", async () => {
    renderWithQuery(<AletheiaProvider><Dedup /></AletheiaProvider>);
    fireEvent.click(await screen.findByText("0000100231", {}, { timeout: 5000 }));
    expect(await screen.findByText("After the merge")).toBeTruthy();
    const merge = screen.getByRole("button", { name: "Merge these records" }) as HTMLButtonElement;
    expect(merge.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for the merge"), { target: { value: "Same company" } });
    expect(merge.disabled).toBe(false);
    fireEvent.click(merge);
    expect(await screen.findByText(/1 record is merged away/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(await screen.findByText(/is folded into it/)).toBeTruthy();
  });
});
