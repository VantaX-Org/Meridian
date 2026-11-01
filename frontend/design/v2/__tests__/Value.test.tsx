import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { Value } from "../screens/Value";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/value");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Value delivered", () => {
  it("leads with the return and lists each loss with its description, largest risk first", async () => {
    renderWithQuery(<Value />);
    const banner = await screen.findByTestId("val-banner");
    expect(banner.textContent).toMatch(/Returns 6\.9 times its cost/);
    const rows = within(await screen.findByTestId("val-impact")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.querySelector("th")?.textContent)).toEqual(["Duplicate payments", "Inventory write-offs", "Compliance penalties", "Blocked invoices", "Missed warranty claims"]);
    expect(rows[0].textContent).toMatch(/payments made twice/);
  });

  it("lists the recorded months newest first", async () => {
    renderWithQuery(<Value />);
    const rows = within(await screen.findByTestId("val-months")).getAllByRole("row").slice(1);
    expect(rows[0].querySelector("th")?.textContent).toBe("2026-09");
    expect(rows).toHaveLength(6);
  });

  it("lists the steps behind a KPI and puts an unguarded process step first", async () => {
    renderWithQuery(<Value />);
    const panel = await screen.findByTestId("val-guards");
    const pick = await within(panel).findByRole("combobox", { name: "KPI or process" });
    fireEvent.change(pick, { target: { value: "kpi:dpo" } });
    await waitFor(() => expect(within(panel).getByTestId("val-guards-sum").textContent).toBe("Every one of the 3 steps has a rule guarding it."));
    expect(within(panel).getAllByRole("row").slice(1)[0].querySelector("th")?.textContent).toContain("Payment Parameters");
    expect(panel.textContent).toContain("MIRO");
    fireEvent.change(pick, { target: { value: "process:PM" } });
    await waitFor(() => expect(within(panel).getByTestId("val-guards-sum").textContent).toBe("1 step has no rule guarding it, of 9."));
    const first = within(panel).getAllByRole("row")[1];
    expect(first.querySelector("th")?.textContent).toContain("Priority");
    expect(first.textContent).toContain("None");
  });
});
