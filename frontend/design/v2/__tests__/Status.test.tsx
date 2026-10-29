import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as ent from "@/lib/api/v2/enterprise";
import type { StatusPage } from "@/lib/api/v2/enterprise";
import { resetEnterpriseFixture } from "@/lib/api/v2/fixtures";
import { STATUS_REFRESH_MS } from "@/lib/v2/enterprise-queries";
import { setLang } from "@/lib/v2/i18n";
import { dayCells, maintenanceState, overallStatus } from "@/lib/v2/status";
import { StatusScreen } from "../screens/Status";
import { StatusStrip } from "../shell/StatusStrip";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetEnterpriseFixture();
  setLang("en");
  setUrl("/v2/status?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  setLang("en");
  vi.restoreAllMocks();
});

const page = (over: Partial<StatusPage> = {}): StatusPage => ({
  components: [{ name: "API", status: "ok", detail: null, measured_at: "2026-10-20T07:59:00Z" }],
  incidents: [],
  maintenance: null,
  uptime_30d_pct: 100,
  samples: [],
  ...over,
});

describe("status: the pure parts", () => {
  it("folds probes into one cell per day: ok, degraded under half failed, down at half or more, none without probes", () => {
    const at = (d: string, ok: boolean) => ({ at: `${d}T06:00:00Z`, ok });
    const cells = dayCells([at("2026-10-18", true), at("2026-10-18", true), at("2026-10-19", false), at("2026-10-19", true), at("2026-10-19", true), at("2026-10-20", false), at("2026-10-20", true)], 4);
    expect(cells.map((c) => [c.day, c.state])).toEqual([
      ["2026-10-17", "none"],
      ["2026-10-18", "ok"],
      ["2026-10-19", "degraded"],
      ["2026-10-20", "down"],
    ]);
  });

  it("the overall state is the worst component's, and maintenance is ahead, on or over", () => {
    expect(overallStatus([{ name: "a", status: "ok", detail: null, measured_at: "" }, { name: "b", status: "degraded", detail: null, measured_at: "" }])).toBe("degraded");
    expect(overallStatus([{ name: "a", status: "down", detail: null, measured_at: "" }, { name: "b", status: "degraded", detail: null, measured_at: "" }])).toBe("down");
    const m = { from: "2026-10-25T20:00:00Z", to: "2026-10-25T22:00:00Z", note: "" };
    expect(maintenanceState(m, Date.parse("2026-10-24T00:00:00Z"))).toBe("ahead");
    expect(maintenanceState(m, Date.parse("2026-10-25T21:00:00Z"))).toBe("now");
    expect(maintenanceState(m, Date.parse("2026-10-26T00:00:00Z"))).toBe("over");
    expect(maintenanceState(null)).toBeNull();
  });
});

describe("the status page", () => {
  it("shows the overall word, the components, one bar of 30 days, incidents and planned maintenance", async () => {
    renderWithQuery(<StatusScreen />);
    expect(await screen.findByTestId("status-overall")).toHaveTextContent("Degraded Part of the platform is slower or less available than usual.");
    expect(screen.getByRole("heading", { level: 1, name: "Status" })).toBeInTheDocument();
    const table = screen.getByRole("region", { name: "Components and their state" });
    expect(within(table).getAllByRole("row")).toHaveLength(6);
    expect(within(table).getByText("Background workers").closest("tr")).toHaveTextContent("Degraded");
    const bar = screen.getByRole("img", { name: /99\.82% uptime over the last 30 days\. 1 day down, 1 day degraded\./ });
    const cells = bar.querySelectorAll(".m2-upcell");
    expect(cells).toHaveLength(30);
    expect([...cells].filter((c) => c.getAttribute("data-state") === "down")).toHaveLength(1);
    expect([...cells].filter((c) => c.getAttribute("data-state") === "degraded")).toHaveLength(1);
    expect([...cells].filter((c) => c.getAttribute("data-state") === "ok")).toHaveLength(28);
    // A word beside the bar, so the state is never colour alone.
    expect(screen.getByTestId("uptime")).toHaveTextContent("Down");
    expect(screen.getByText("INC-7F3A91")).toBeInTheDocument();
    expect(screen.getByTestId("maintenance")).toHaveTextContent("Planned maintenance");
    expect(screen.getByTestId("maintenance")).toHaveTextContent("Database upgrade.");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });

  it("signed in, it links back to Meridian instead of to sign-in", async () => {
    renderWithQuery(<StatusScreen signedIn />);
    expect(await screen.findByRole("link", { name: "Back to Meridian" })).toHaveAttribute("href", "/v2?fixture=1");
  });

  it("reads the status again every 60 seconds", async () => {
    expect(STATUS_REFRESH_MS).toBe(60_000);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const spy = vi.spyOn(ent, "getStatusPage");
      renderWithQuery(<StatusScreen />);
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("says when every component is operational, with no hue on the bar", async () => {
    vi.spyOn(ent, "getStatusPage").mockResolvedValue(page({ samples: [{ at: "2026-10-20T06:00:00Z", ok: true }] }));
    renderWithQuery(<StatusScreen />);
    expect(await screen.findByTestId("status-overall")).toHaveTextContent("Operational Every part of the platform is working.");
    expect(screen.getByText("No incident in the last 30 days.")).toBeInTheDocument();
    expect(screen.queryByTestId("maintenance")).toBeNull();
    expect(screen.getByTestId("uptime").querySelector(".m2-vm")).toBeNull();
  });

  it("a failed read says so in place, with Retry", async () => {
    vi.spyOn(ent, "getStatusPage").mockRejectedValue(new Error("down"));
    renderWithQuery(<StatusScreen />);
    expect(await screen.findByText("The status could not be read. The server may be restarting.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("reads in German", async () => {
    setLang("de", "de-DE");
    renderWithQuery(<StatusScreen />);
    expect(await screen.findByTestId("status-overall")).toHaveTextContent("Beeinträchtigt");
    expect(screen.getByRole("heading", { name: "Vorfälle" })).toBeInTheDocument();
  });
});

describe("the status strip's health word", () => {
  it("links to the status page with the platform's state in one word", async () => {
    setUrl("/v2?fixture=1");
    renderWithQuery(<StatusStrip />);
    const link = await screen.findByTestId("status-health");
    expect(link).toHaveTextContent("Degraded");
    expect(link).toHaveAttribute("href", "/v2/status?fixture=1");
    expect(link).toHaveAccessibleName("Platform Degraded, open the status page");
  });
});
