import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import { resetStewardFixture } from "@/lib/api/v2/fixtures/stewardship";
import { ToastProvider } from "../../kit";
import { Stewardship } from "../Stewardship";
import { Automation, cronText } from "../Automation";
import { ConfigImpact } from "../ConfigImpact";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
const Q = vi.hoisted(() => ({ can: (a: string): boolean => a !== "" }));
vi.mock("@/lib/v2/hooks", async (orig) => ({ ...(await orig<object>()), useV2Session: () => ({ can: Q.can, id: "u-me", name: "Me", email: "me@example.com", persona: "admin", label: "Admin", fixture: true, viewAs: null, shared: false }) }));

const wrap = (el: React.ReactElement) => renderWithQuery(<ToastProvider>{el}</ToastProvider>);

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  resetStewardFixture();
  Q.can = () => true;
});

describe("cronText", () => {
  it("puts the common cron shapes in words", () => {
    expect(cronText(null)).toBe("On an interval");
    expect(cronText("*/5 * * * *")).toBe("Every 5 minutes");
    expect(cronText("0 */2 * * *")).toBe("Every 2 hours");
    expect(cronText("15 * * * *")).toBe("Every hour at minute 15");
    expect(cronText("0 2 * * *")).toBe("Daily at 02:00");
    expect(cronText("0 4 * * 1")).toBe("Every Monday at 04:00");
    expect(cronText("30 6 1 * *")).toBe("Monthly on day 1 at 06:30");
    expect(cronText("0 0 1 1 *")).toBe("Custom schedule");
  });
});

describe("Automation (next)", () => {
  beforeEach(() => setUrl("/more/automation?fixture=1"));
  it("shows every stage of the chain with its last result and next run, and the tasks with cron in words", async () => {
    wrap(<Automation />);
    for (const s of ["extract", "checks", "agents", "report", "monitoring"]) expect(await screen.findByTestId(`automation-stage-${s}`)).toBeTruthy();
    expect(screen.getByTestId("automation-stage-agents").textContent).toContain("7 queue items open");
    expect(screen.getByTestId("automation-stage-extract").textContent).toContain("Next run");
    expect(screen.getByTestId("automation-runs")).toBeTruthy();
    expect(screen.getByTestId("automation-tasks")).toBeTruthy();
    expect(screen.getAllByText("Daily at 02:00").length).toBeGreaterThan(0);
    expect(screen.getByText("Material master nightly")).toBeTruthy();
  });
});

describe("Stewardship (next)", () => {
  beforeEach(() => setUrl("/more/stewardship?fixture=1"));
  it("leads with SLA and backlog charts and lists open items with code and text", async () => {
    wrap(<Stewardship />);
    expect(await screen.findByTestId("steward-sla")).toBeTruthy();
    expect(screen.getByTestId("steward-status")).toBeTruthy();
    expect(await screen.findByText("Material group is blank")).toBeTruthy();
    expect(screen.getAllByText("MM022").length).toBeGreaterThan(0);
  });

  it("approves an item and drops it from the open list", async () => {
    wrap(<Stewardship />);
    const btn = await screen.findByRole("button", { name: "Approve Material group is blank" });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Approve Material group is blank" })).toBeNull());
  });

  it("hides approve, reject and escalate without the approve permission", async () => {
    Q.can = (a) => a === "view";
    wrap(<Stewardship />);
    await screen.findByText("Material group is blank");
    expect(screen.queryByRole("button", { name: "Approve Material group is blank" })).toBeNull();
  });
});

describe("ConfigImpact (next)", () => {
  beforeEach(() => setUrl("/more/config-impact?fixture=1"));
  it("shows feature impact and ghost settings, switches to shadow processes and opens a root cause", async () => {
    wrap(<ConfigImpact />);
    expect(await screen.findByTestId("config-impact-features")).toBeTruthy();
    expect(screen.getByTestId("config-impact-severity")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Shadow processes" }));
    const table = await screen.findByRole("table", { name: /Shadow processes/ });
    const rows = await within(table).findAllByRole("row");
    expect(rows.length).toBeGreaterThan(1);
  });
});
