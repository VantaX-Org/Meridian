import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import { AletheiaProvider } from "@/ui/kit";
import { getDigest, listDigests } from "@/lib/api/v2/step10";
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

  it("opens the edit form from a fresh read of the digest and saves a new name", async () => {
    const first = (await listDigests()).digests[0];
    renderWithQuery(<AletheiaProvider><Digests /></AletheiaProvider>);
    fireEvent.click((await screen.findAllByRole("row"))[1]);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const name = (await screen.findByLabelText("Name")) as HTMLInputElement;
    expect(name.value).toBe((await getDigest(first.id)).name);
    fireEvent.change(name, { target: { value: "Monday steering digest" } });
    fireEvent.click(screen.getByRole("button", { name: "Save digest" }));
    await waitFor(async () => expect((await getDigest(first.id)).name).toBe("Monday steering digest"));
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
