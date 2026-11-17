import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import AletheiaPanel from "@/ui/kit/AletheiaPanel";
import { AletheiaProvider } from "@/ui/kit";
import { ObjectScreen } from "./ObjectScreen";

const labels = { title: "Aletheia", scope: "All objects", close: "Close", inputLabel: "Ask a question", send: "Send", evidence: "Evidence", suggestionsLabel: "Suggested questions", threadLabel: "Conversation" };
const screenWithChat = () => (
  <AletheiaProvider>
    <ObjectScreen system="ecc-production" module="material-master" />
    <AletheiaPanel labels={labels} />
  </AletheiaProvider>
);

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/o/ecc-production/material-master?fixture=1");
});
afterEach(() => undo());

describe("ObjectScreen", () => {
  it("shows the header, the score ring and the rule list, and a selected rule opens its tabs", async () => {
    renderWithQuery(screenWithChat());
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fix records" })).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Failing rules" });
    const rows = within(list).getAllByRole("button");
    expect(rows.length).toBeGreaterThan(0);
    fireEvent.click(rows[0]);
    expect(await screen.findByRole("tab", { name: "Overview" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Why" }));
    expect(screen.getByRole("link", { name: "Open the rule" }).getAttribute("href")).toContain("/more/rules?rule=");
  });

  it("opens the Aletheia chat and answers a suggested prompt with evidence", async () => {
    renderWithQuery(screenWithChat());
    await screen.findByRole("list", { name: "Failing rules" });
    // the screen can re-mount its header while the run settles, so click until the chat opens
    await waitFor(() => { fireEvent.click(screen.getByRole("button", { name: "Ask Aletheia" })); expect(screen.getByRole("dialog")).toBeTruthy(); });
    // an answer asked while the run is still settling says so, so ask again until the rule data is in
    await waitFor(() => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Which rule hurts this object most?" }));
      expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Review fixes" })).toBeTruthy();
    });
  });

  it("separates the run number from the record count in the subtitle", async () => {
    renderWithQuery(screenWithChat());
    await screen.findByRole("list", { name: "Failing rules" });
    const h = await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(h.parentElement?.querySelector("p")?.textContent ?? "").toMatch(/run [^,]*, \S+ records checked against \d+ rules/));
  });

  it("on a stacked layout a selected rule opens its detail in a bottom sheet, not in the page", async () => {
    const mm = vi.fn().mockImplementation(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal("matchMedia", mm);
    window.matchMedia = mm as unknown as typeof window.matchMedia;
    try {
      renderWithQuery(screenWithChat());
      const list = await screen.findByRole("list", { name: "Failing rules" });
      expect(screen.queryByRole("tab", { name: "Overview" })).toBeNull();
      fireEvent.click(within(list).getAllByRole("button")[0]);
      const dialog = await screen.findByRole("dialog", { name: "Selected rule" });
      expect(within(dialog).getByRole("tab", { name: "Overview" })).toBeTruthy();
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      // @ts-expect-error jsdom has no matchMedia by default
      delete window.matchMedia;
    }
  });
});
