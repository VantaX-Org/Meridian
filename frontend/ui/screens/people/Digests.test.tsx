import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { Digests } from "./Digests";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); window.history.replaceState(null, "", "/people?fixture=1"); });
afterEach(() => undo());

describe("Digests edit", () => {
  it("locks the audience, which PATCH /digests/{id} does not accept", async () => {
    renderWithQuery(<AletheiaProvider><Digests /></AletheiaProvider>);
    fireEvent.click((await screen.findAllByRole("row"))[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const sel = (await screen.findByLabelText("Audience")) as HTMLSelectElement;
    expect(sel.disabled).toBe(true);
  });
});

describe("Digests detail", () => {
  it("reads the digest again for last sent and next run", async () => {
    renderWithQuery(<AletheiaProvider><Digests /></AletheiaProvider>);
    fireEvent.click((await screen.findAllByRole("row"))[1]);
    expect((await screen.findAllByText("Last sent")).length).toBeGreaterThan(0);
    expect(screen.queryByText("The latest times could not be read")).toBeNull();
  });
});
