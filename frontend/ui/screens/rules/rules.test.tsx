import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/ui/testing/layout-stub";
import AletheiaPanel from "@/ui/kit/AletheiaPanel";
import { AletheiaProvider } from "@/ui/kit";
import { Rules } from "./Rules";
import { Rule } from "./Rule";
import { DryRun } from "./DryRun";
import { Promotion } from "./Promotion";

vi.mock("next/navigation", async () => (await import("@/ui/testing/nav-store")).navigationMock);

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
  window.history.replaceState(null, "", "/rules?fixture=1");
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

  it("a rule page leads with the board: tiles, chart, breakdowns, records and bulk actions", async () => {
    renderWithQuery(withChat(<Rule id="MM142" />));
    expect(await screen.findByRole("link", { name: "Open in clean cycle" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in clean cycle" }).getAttribute("href")).toContain("/work?");
    expect(screen.getByText("Records failing in this run")).toBeTruthy();
    expect(screen.getByText("Pass rate")).toBeTruthy();
    expect(screen.getByText("Value at risk")).toBeTruthy();
    expect(screen.getByText("Proposed fixes ready for auto-cleanse")).toBeTruthy();
    expect(screen.getByText("S/4HANA features blocked until it passes")).toBeTruthy();
    expect(screen.getByText("What the rule checks")).toBeTruthy();
    expect(screen.getByText("Where it fails")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Apply all" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to workbook" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assign" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply 0 fixes" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Records/ })).toBeNull();
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
