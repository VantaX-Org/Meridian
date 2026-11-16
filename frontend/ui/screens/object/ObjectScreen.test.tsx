import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ObjectScreen } from "./ObjectScreen";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  undo = stubLayout();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/n/o/ecc-production/material-master?fixture=1");
});
afterEach(() => undo());

describe("ObjectScreen", () => {
  it("shows the header, the score ring and the rule list, and a selected rule opens its tabs", async () => {
    renderWithQuery(<ObjectScreen system="ecc-production" module="material-master" />);
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
    renderWithQuery(<ObjectScreen system="ecc-production" module="material-master" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask Aletheia" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Which rule hurts this object most?" }));
    expect(await within(await screen.findByRole("dialog")).findByRole("link", { name: "Review fixes" })).toBeTruthy();
  });
});
