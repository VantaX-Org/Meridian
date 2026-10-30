import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as ent from "@/lib/api/v2/enterprise";
import type { StatusPage } from "@/lib/api/v2/enterprise";
import { resetEnterpriseFixture } from "@/lib/api/v2/fixtures";
import { STATUS_REFRESH_MS } from "@/lib/v2/enterprise-queries";
import { setLang } from "@/lib/v2/i18n";
import { currentMaintenance, dayCells } from "@/lib/v2/status";
import { StatusScreen } from "../screens/Status";
import { StatusStrip } from "../shell/StatusStrip";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetEnterpriseFixture();
  setLang("en");
  setUrl("/status?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  setLang("en");
  vi.restoreAllMocks();
});

const page = (over: Partial<StatusPage> = {}): StatusPage => ({
  status: "operational",
  generated_at: "2026-10-20T08:00:00+00:00",
  components: [{ id: "api", label: "API", status: "up", latency_ms: 3, detail: null, data: {} }],
  incidents: [],
  maintenance: [],
  uptime: { days: 30, sample_minutes: 5, overall_pct: 100, slots: 1, components: [{ id: "api", label: "API", samples: 1, uptime_pct: 100 }], by_day: [{ date: "2026-10-20", slots: 1, uptime_pct: 100 }] },
  ...over,
});

describe("status: the pure parts", () => {
  it("lays the server's per-day uptime on the last days: ok at 100%, degraded above half, down at half or less, none without samples", () => {
    const up = page().uptime;
    const cells = dayCells({ ...up, by_day: [{ date: "2026-10-18", slots: 288, uptime_pct: 100 }, { date: "2026-10-19", slots: 288, uptime_pct: 93.75 }, { date: "2026-10-20", slots: 97, uptime_pct: 44.444 }] }, "2026-10-20T08:00:00+00:00", 4);
    expect(cells.map((c) => [c.day, c.state])).toEqual([
      ["2026-10-17", "none"],
      ["2026-10-18", "ok"],
      ["2026-10-19", "degraded"],
      ["2026-10-20", "down"],
    ]);
    expect(cells[0].uptimePct).toBeNull();
  });

  it("shows the window in progress first, else the next one", () => {
    const w = (title: string, in_progress: boolean) => ({ title, starts_at: "2026-10-25T20:00:00+00:00", ends_at: "2026-10-25T22:00:00+00:00", detail: null, in_progress });
    expect(currentMaintenance([w("a", false), w("b", true)])?.title).toBe("b");
    expect(currentMaintenance([w("a", false), w("b", false)])?.title).toBe("a");
    expect(currentMaintenance([])).toBeNull();
  });
});

describe("the status page", () => {
  it("shows the server's overall word, the components, one bar of 30 days, the server errors and planned maintenance", async () => {
    renderWithQuery(<StatusScreen />);
    expect(await screen.findByTestId("status-overall")).toHaveTextContent("Degraded Part of the platform is slower or less available than usual.");
    expect(screen.getByRole("heading", { level: 1, name: "Status" })).toBeInTheDocument();
    const table = screen.getByRole("region", { name: "Components and their state" });
    expect(within(table).getAllByRole("row")).toHaveLength(7);
    expect(within(table).getByText("Background workers").closest("tr")).toHaveTextContent("Degraded140 tasks waiting41 ms97.89%");
    // What the server does not send is a dash: no latency for an unconfigured component, no uptime for it either.
    expect(within(table).getByText("Local AI model").closest("tr")).toHaveTextContent("Not configured———");
    const bar = screen.getByRole("img", { name: /97\.89% uptime over the last 30 days\. 1 day down, 1 day degraded\./ });
    const cells = bar.querySelectorAll(".m2-upcell");
    expect(cells).toHaveLength(30);
    expect([...cells].filter((c) => c.getAttribute("data-state") === "down")).toHaveLength(1);
    expect([...cells].filter((c) => c.getAttribute("data-state") === "degraded")).toHaveLength(1);
    expect([...cells].filter((c) => c.getAttribute("data-state") === "ok")).toHaveLength(28);
    // A word beside the bar, so the state is never colour alone.
    expect(screen.getByTestId("uptime")).toHaveTextContent("Down");
    expect(screen.getByText("ERR-7F3A91")).toBeInTheDocument();
    expect(screen.getByText("GET /api/v1/landscape")).toBeInTheDocument();
    expect(screen.getByTestId("maintenance")).toHaveTextContent("Planned maintenance");
    expect(screen.getByTestId("maintenance")).toHaveTextContent("Database upgrade");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });

  it("an outage is the server's word, not a fold of the components", async () => {
    vi.spyOn(ent, "getStatusPage").mockResolvedValue(page({ status: "outage", components: [{ id: "db", label: "Database", status: "down", latency_ms: null, detail: "no answer within 3 s", data: {} }] }));
    renderWithQuery(<StatusScreen />);
    expect(await screen.findByTestId("status-overall")).toHaveTextContent("Outage A core part of the platform is down.");
  });

  it("signed in, it links back to Meridian instead of to sign-in", async () => {
    renderWithQuery(<StatusScreen signedIn />);
    expect(await screen.findByRole("link", { name: "Back to Meridian" })).toHaveAttribute("href", "/?fixture=1");
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
    vi.spyOn(ent, "getStatusPage").mockResolvedValue(page());
    renderWithQuery(<StatusScreen />);
    expect(await screen.findByTestId("status-overall")).toHaveTextContent("Operational Every part of the platform is working.");
    expect(screen.getByText("No server error in the last 24 hours.")).toBeInTheDocument();
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
    expect(screen.getByRole("heading", { name: "Serverfehler, letzte 24 Stunden" })).toBeInTheDocument();
  });
});

describe("the status strip's health word", () => {
  it("links to the status page with the platform's state in one word", async () => {
    setUrl("/?fixture=1");
    renderWithQuery(<StatusStrip />);
    const link = await screen.findByTestId("status-health");
    expect(link).toHaveTextContent("Degraded");
    expect(link).toHaveAttribute("href", "/status?fixture=1");
    expect(link).toHaveAccessibleName("Platform Degraded, open the status page");
  });
});
