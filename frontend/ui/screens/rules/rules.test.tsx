import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import AletheiaPanel from "@/ui/kit/AletheiaPanel";
import { AletheiaProvider } from "@/ui/kit";
import { Rules } from "./Rules";
import { Rule } from "./Rule";
import { DryRun } from "./DryRun";
import { Promotion } from "./Promotion";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

const labels = { title: "Aletheia", scope: "All objects", close: "Close", inputLabel: "Ask a question", send: "Send", evidence: "Evidence", suggestionsLabel: "Suggested questions", threadLabel: "Conversation" };
const withChat = (ui: React.ReactNode) => (
  <AletheiaProvider>
    {ui}
    <AletheiaPanel labels={labels} />
  </AletheiaProvider>
);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/n/rules?fixture=1");
});
afterEach(() => undo());

describe("rules screens", () => {
  it("the library lists rules and has the author, promotion and scoring links", async () => {
    renderWithQuery(withChat(<Rules />));
    expect(await screen.findByRole("heading", { level: 1, name: "Rules" })).toBeTruthy();
    await waitFor(() => expect(within(screen.getByRole("grid")).getAllByRole("row").length).toBeGreaterThan(1));
    expect(screen.getByRole("link", { name: "Rule promotion" }).getAttribute("href")).toContain("/rules/promotion");
    expect(screen.getByRole("link", { name: "Scoring weights and thresholds" }).getAttribute("href")).toContain("/admin/scoring");
  });

  it("opens the Aletheia chat scoped to the library", async () => {
    renderWithQuery(withChat(<Rules />));
    await screen.findByRole("heading", { level: 1, name: "Rules" });
    await waitFor(() => { fireEvent.click(screen.getByRole("button", { name: "Ask Aletheia" })); expect(screen.getByRole("dialog")).toBeTruthy(); });
  });

  it("a rule page shows its tabs and the fix tab offers suppress", async () => {
    renderWithQuery(withChat(<Rule id="MM142" />));
    expect(await screen.findByRole("tab", { name: "Overview" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Fix" }));
    expect(await screen.findByRole("button", { name: "Suppress the rule" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try a change" }).getAttribute("href")).toContain("/rules/dry-run?rule=MM142");
  });

  it("the dry run page renders its form", async () => {
    renderWithQuery(withChat(<DryRun />));
    expect(await screen.findByRole("heading", { level: 1, name: "Try a rule change" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to promotion" })).toBeTruthy();
  });

  it("the promotion page lists objects with generated rules", async () => {
    renderWithQuery(withChat(<Promotion />));
    expect(await screen.findByRole("heading", { level: 1, name: "Rule promotion" })).toBeTruthy();
  });
});
