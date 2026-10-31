import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { ScoreLens } from "../screens/ScoreLens";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/score");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Score lens", () => {
  it("shows the latest run both ways and the config-aware score", async () => {
    renderWithQuery(<ScoreLens />);
    const banner = await screen.findByTestId("sl-banner");
    expect(banner.textContent).toMatch(/72\.4 under today's weights/);
    expect(banner.textContent).toMatch(/0\.6 points from the weight change/);
    expect(banner.textContent).toMatch(/80\.3/);
  });

  it("colours each module's dimension scores by target and names the capped modules", async () => {
    renderWithQuery(<ScoreLens />);
    const heat = await screen.findByTestId("sl-heat");
    const mm = within(heat).getByRole("row", { name: /Material master/ });
    expect(mm.querySelector('[data-label="Completeness"]')?.getAttribute("data-band")).toBe("3");
    expect(mm.querySelector('[data-label="Uniqueness"]')?.getAttribute("data-band")).toBe("0");
    const ec = within(heat).getByRole("row", { name: /Employee central/i });
    expect(ec.querySelector('[data-label="Timeliness"]')?.hasAttribute("data-band")).toBe(false);
    expect(heat.textContent).toMatch(/capped at 70/);
  });

  it("lists runs newest first and says when the weights were not recorded", async () => {
    renderWithQuery(<ScoreLens />);
    const rows = within(await screen.findByTestId("sl-runs")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    expect(rows[0].textContent).toMatch(/Recorded with the run/);
    expect(rows[4].textContent).toMatch(/default weights assumed/);
  });

  it("gives each module its name beside the code, and the reasons rules do not apply", async () => {
    renderWithQuery(<ScoreLens />);
    const mods = within(await screen.findByTestId("sl-modules")).getAllByRole("row").slice(1);
    expect(mods[0].querySelector("th")?.textContent).toMatch(/business_partner/);
    const aware = await screen.findByTestId("sl-aware");
    expect(await within(aware).findByText("Batch management is not active in any plant")).toBeTruthy();
    expect(within(aware).getByTestId("sl-processes").textContent).toMatch(/Procure to pay/);
  });
});
