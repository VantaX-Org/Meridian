import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
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

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

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

  it("opens the Aletheia chat from the header", async () => {
    renderWithQuery(screenWithChat());
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => {
      fireEvent.click(screen.getAllByRole("button", { name: "Ask Aletheia" })[0]);
      expect(within(screen.getByRole("dialog")).getByText("Aletheia")).toBeTruthy();
    });
  });
});
