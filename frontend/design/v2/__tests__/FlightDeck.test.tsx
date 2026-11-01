import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as analytics from "@/lib/api/v2/analytics";
import * as rep from "@/lib/api/v2/reports";
import { FlightDeck } from "../screens/FlightDeck";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T09:00:00Z"));
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("go-live flight deck", () => {
  it("puts every object of the next wave on the runway and opens the what-if on the one picked", async () => {
    renderWithQuery(<FlightDeck />);
    const banner = await screen.findByTestId("flight-deck");
    expect(within(banner).getByText("Wave 1: finance foundations")).toBeInTheDocument();
    const runway = screen.getByTestId("runway");
    expect(await within(runway).findAllByText(/at go-live$/)).toHaveLength(4);
    const rows = runway.querySelectorAll("[data-module]");
    expect([...rows].map((r) => r.getAttribute("data-module"))).toEqual(["fi_gl", "asset_accounting", "controlling", "accounts_payable"]);
    expect(runway.querySelectorAll(".m2-fd-hit")).toHaveLength(4);

    const button = within(rows[3] as HTMLElement).getByRole("button");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByTestId("what-if")).getByRole("heading").textContent).toMatch(/^What if, for /);
  });

  it("shows unavailable, not a guessed line, when a forecast cannot be read", async () => {
    vi.spyOn(analytics, "getForecast").mockRejectedValue(new Error("500"));
    renderWithQuery(<FlightDeck />);
    const runway = await screen.findByTestId("runway");
    expect(await within(runway).findAllByText("Forecast unavailable")).toHaveLength(4);
    expect(runway.querySelectorAll(".m2-fd-fc, .m2-fd-hit")).toHaveLength(0);
    expect(within(screen.getByTestId("flight-deck")).getByText("Cannot forecast go-live yet")).toBeInTheDocument();
  });

  it("asks for a wave when none is planned", async () => {
    vi.spyOn(rep, "getWaves").mockResolvedValue([]);
    renderWithQuery(<FlightDeck />);
    expect(await screen.findByText("Plan a migration wave with a go-live date to see its runway.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan a wave" }).getAttribute("href")).toMatch(/^\/\?view=waves/);
  });

  it("says so when the waves cannot be read", async () => {
    vi.spyOn(rep, "getWaves").mockRejectedValue(new Error("500"));
    renderWithQuery(<FlightDeck />);
    expect(await screen.findByText("The migration waves could not be read.")).toBeInTheDocument();
  });
});
