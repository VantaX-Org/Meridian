import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { WorkAnalytics } from "../screens/WorkAnalytics";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/work/analytics");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Work analytics", () => {
  it("shows the open issues, the finish date and the burn-down", async () => {
    renderWithQuery(<WorkAnalytics />);
    const banner = await screen.findByTestId("wa-banner");
    expect(banner.textContent).toMatch(/issues open/);
    expect(banner.textContent).toMatch(/clear by/);
    expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("wa-burndown")).toBeInTheDocument();
  });

  it("names the rules the latest run changed and shows a dash for a source with nothing proposed", async () => {
    renderWithQuery(<WorkAnalytics />);
    const change = await screen.findByTestId("wa-run-change");
    expect(await within(change).findByText("MM302")).toBeInTheDocument();
    const proposals = await screen.findByTestId("wa-proposals");
    const row = (await within(proposals).findByText("Simulations")).closest("tr")!;
    expect(row.textContent).toContain("—");
  });
});
