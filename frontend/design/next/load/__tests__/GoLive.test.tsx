import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as analytics from "@/lib/api/v2/analytics";
import * as rep from "@/lib/api/v2/reports";
import * as step9 from "@/lib/api/v2/step9";
import * as work from "@/lib/api/v2/work";
import { GoLive } from "../GoLive";
import { setUrl } from "@/design/v2/__tests__/nav-store";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T09:00:00Z"));
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/load/go-live?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("load, go-live", () => {
  it("puts every object of the next wave on the runway and opens the what-if on the one picked", async () => {
    renderWithQuery(<GoLive />);
    const banner = await screen.findByTestId("flight-deck");
    expect(within(banner).getByText("Wave 1: finance foundations")).toBeInTheDocument();
    const runway = screen.getByTestId("runway");
    expect(await within(runway).findAllByText(/at go-live$/)).toHaveLength(4);
    const rows = runway.querySelectorAll("[data-module]");
    expect([...rows].map((r) => r.getAttribute("data-module"))).toEqual(["fi_gl", "asset_accounting", "controlling", "accounts_payable"]);
    expect(runway.querySelectorAll(".nx-ld-fd-hit")).toHaveLength(4);
    const button = within(rows[3] as HTMLElement).getByRole("button");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByTestId("what-if")).getAllByRole("heading")[0].textContent).toMatch(/^What if, for /);
  });

  it("runs the what-if: before and after, top fixes, and a per-record simulation", async () => {
    const row = { module: "asset_accounting", record_key: "100000-0", name: "Crane 7", issues: 2, severity: "critical", checks: ["AA003"], proposed: 0, status: "open", top_message: null, top_field: null };
    vi.spyOn(work, "getWork").mockResolvedValue({ items: [row], next: null } as never);
    renderWithQuery(<GoLive />);
    const runway = await screen.findByTestId("runway");
    await within(runway).findAllByText(/at go-live$/);
    fireEvent.click(within(runway.querySelectorAll("[data-module]")[1] as HTMLElement).getByRole("button"));
    const panel = screen.getByTestId("what-if");
    const boxes = await within(panel).findAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    expect(await within(panel).findByTestId("sim-before")).toBeInTheDocument();
    expect(within(panel).getByTestId("sim-after")).toBeInTheDocument();
    expect(await within(panel).findByTestId("top-fixes")).toBeInTheDocument();
    const records = within(panel).getByTestId("record-sim");
    const picks = await within(records).findAllByRole("checkbox");
    fireEvent.click(picks[picks.length - 1]!);
    fireEvent.click(await within(records).findByRole("button", { name: /^Simulate fixing 1 record$/ }));
    expect(within(records).getByText("Crane 7")).toBeInTheDocument();
    expect(await screen.findByTestId("simulate-dialog")).toHaveTextContent("1 selected record of");
  });

  it("shows the simulation error with a retry, not a dash", async () => {
    vi.spyOn(step9, "simulateFix").mockRejectedValue(new Error("500"));
    renderWithQuery(<GoLive />);
    const runway = await screen.findByTestId("runway");
    await within(runway).findAllByText(/at go-live$/);
    fireEvent.click(within(runway.querySelectorAll("[data-module]")[1] as HTMLElement).getByRole("button"));
    const panel = screen.getByTestId("what-if");
    fireEvent.click((await within(panel).findAllByRole("checkbox"))[0]!);
    expect(await within(panel).findByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });

  it("shows unavailable, not a guessed line, when a forecast cannot be read", async () => {
    vi.spyOn(analytics, "getForecast").mockRejectedValue(new Error("500"));
    renderWithQuery(<GoLive />);
    const runway = await screen.findByTestId("runway");
    expect(await within(runway).findAllByText("Forecast unavailable")).toHaveLength(4);
    expect(runway.querySelectorAll(".nx-ld-fd-fc, .nx-ld-fd-hit")).toHaveLength(0);
  });

  it("asks for a wave when none is planned, through the waves page", async () => {
    vi.spyOn(rep, "getWaves").mockResolvedValue([]);
    renderWithQuery(<GoLive />);
    expect(await screen.findByRole("link", { name: "Plan a wave" })).toHaveAttribute("href", expect.stringMatching(/^\/\?view=waves/));
  });

  it("says so when the waves cannot be read", async () => {
    vi.spyOn(rep, "getWaves").mockRejectedValue({ response: { status: 403 } });
    renderWithQuery(<GoLive />);
    expect(await screen.findByText("The migration waves could not be read.")).toBeInTheDocument();
  });
});
