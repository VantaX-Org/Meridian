import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { MatchRulesSection } from "../admin/matchrules";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/admin/matchrules?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("match rules", () => {
  it("lists the rules per object with each field's share of the score, an inactive rule showing a dash", async () => {
    renderWithQuery(<MatchRulesSection />);
    const bp = await screen.findByRole("table", { name: /Match rules for Business partner/i });
    const rows = within(bp).getAllByRole("row").slice(1);
    expect(rows.length).toBe(5);
    const tel = rows.find((r) => within(r).queryByText("TEL_NUMBER"))!;
    expect(within(tel).getByText("—")).toBeInTheDocument();
    expect(within(tel).getByText("Off")).toBeInTheDocument();
    const shares = rows.filter((r) => r !== tel).map((r) => Number(within(r).getAllByRole("cell")[2].textContent!.replace("%", "")));
    expect(Math.abs(shares.reduce((s, n) => s + n, 0) - 100)).toBeLessThanOrEqual(2);
  });

  it("simulates the pending pairs of one object without writing", async () => {
    renderWithQuery(<MatchRulesSection />);
    const bp = await screen.findByRole("table", { name: /Match rules for Business partner/i });
    const block = bp.closest("section") ?? bp.parentElement!.parentElement!;
    fireEvent.click(within(block as HTMLElement).getByRole("button", { name: "Simulate on pending pairs" }));
    expect(await screen.findByTestId("mr-sim")).toBeInTheDocument();
    expect(screen.getByText(/Nothing was written/)).toBeInTheDocument();
  });
});
