import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import AletheiaPanel from "@/ui/kit/AletheiaPanel";
import { AletheiaProvider } from "@/ui/kit";
import { Survivorship } from "./Survivorship";

const labels = { title: "Aletheia", scope: "All objects", close: "Close", inputLabel: "Ask a question", send: "Send", evidence: "Evidence", suggestionsLabel: "Suggested questions", threadLabel: "Conversation" };
const screenWithChat = () => (
  <AletheiaProvider>
    <Survivorship  />
    <AletheiaPanel labels={labels} />
  </AletheiaProvider>
);

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/mdm/survivorship?fixture=1");
});
afterEach(() => undo());

describe("Survivorship", () => {
  it("renders its title and real fixture content without a middle dot", async () => {
    renderWithQuery(screenWithChat());
    expect(await screen.findByRole("heading", { level: 1, name: "Survivorship" })).toBeTruthy();
    await waitFor(() => expect(document.body.textContent ?? "").not.toMatch(/Loading/), { timeout: 4000 });
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
