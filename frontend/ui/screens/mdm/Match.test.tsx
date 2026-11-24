import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import AletheiaPanel from "@/ui/kit/AletheiaPanel";
import { AletheiaProvider } from "@/ui/kit";
import { Match } from "./Match";

const labels = { title: "Aletheia", scope: "All objects", close: "Close", inputLabel: "Ask a question", send: "Send", evidence: "Evidence", suggestionsLabel: "Suggested questions", threadLabel: "Conversation" };
const screenWithChat = () => (
  <AletheiaProvider>
    <Match  />
    <AletheiaPanel labels={labels} />
  </AletheiaProvider>
);

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/mdm/match?fixture=1");
});
afterEach(() => undo());

describe("Match", () => {
  it("renders its title and real fixture content without a middle dot", async () => {
    renderWithQuery(screenWithChat());
    expect(await screen.findByRole("heading", { level: 1, name: "Match review" })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByRole("row").length).toBeGreaterThan(1), { timeout: 4000 });
    expect(document.body.textContent ?? "").not.toContain(String.fromCharCode(0xb7));
  });

  it("names each pair constraint kind and asks before clearing one", async () => {
    renderWithQuery(screenWithChat());
    fireEvent.click(await screen.findByRole("tab", { name: /Constraints/ }));
    const table = await screen.findByRole("group", { name: "Pair constraints" });
    await waitFor(() => expect(within(table).getAllByText("Cannot link").length).toBe(2));
    expect(within(table).getByText("Must link")).toBeTruthy();
    expect(table.textContent ?? "").not.toContain("do_not_match");
    fireEvent.click(within(table).getAllByRole("button", { name: "Clear" })[0]);
    const dialog = await screen.findByRole("alertdialog", { name: "Clear this pair constraint?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Pair constraints" })).getAllByRole("row").length).toBe(3));
  });

  it("shows the consolidation pack with table, field and action text and the bare survivor number", async () => {
    renderWithQuery(screenWithChat());
    fireEvent.click(await screen.findByRole("tab", { name: /Consolidation pack/ }));
    const table = await screen.findByRole("group", { name: "Consolidation pack" });
    await waitFor(() => expect(within(table).getAllByText("Flag for deletion").length).toBe(3));
    const text = table.textContent ?? "";
    expect(text).toContain("General material data");
    expect(text).toContain("Flag material for deletion at client level");
    expect(text).toContain("Your own status value");
    expect(text).not.toContain("flag_for_deletion");
    const bismt = within(table).getAllByText("Point to the survivor")[0].closest("tr");
    expect(bismt?.textContent ?? "").toMatch(/Old material number\d{18}/);
  });

  it("opens the Aletheia chat from the header", async () => {
    renderWithQuery(screenWithChat());
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "Ask Aletheia" })[0]);
      expect(within(screen.getByRole("dialog")).getByText("Aletheia")).toBeTruthy();
    });
  });
});
