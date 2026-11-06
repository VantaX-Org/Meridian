import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { WorkMonitor } from "../screens/WorkMonitor";
import * as rem from "@/lib/api/remediation";
import { setUrl } from "./nav-store";
import { stubLayout } from "./layout-stub";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/work/monitor?fixture=1");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const item = (back: number) =>
  ({
    scope: "s1",
    system_name: "Plant system",
    lineage: "l1",
    baseline: { id: "r1", dqs: 80 },
    latest: { id: "r2", dqs: 78 },
    monitor: { new_records: back, resolved_records: 3, regressed_checks: [], regressed_check_count: 0, batch_id: null },
  }) as unknown as rem.MonitorItem;

describe("WorkMonitor", () => {
  it("shows the steps with the work list as the current one when records fail again", async () => {
    vi.spyOn(rem, "getMonitor").mockResolvedValue({ items: [item(4)] });
    renderWithQuery(<WorkMonitor />);
    const steps = await screen.findByTestId("flow-steps");
    expect(steps.querySelector("[aria-current=step]")?.textContent).toContain("Open the work list");
    expect(screen.getByTestId("consequence").textContent).toContain("changes nothing");
    expect(screen.getByTestId("monitor-primary")).toBeTruthy();
  });

  it("moves to the next-run step and drops the consequence when nothing failed again", async () => {
    vi.spyOn(rem, "getMonitor").mockResolvedValue({ items: [item(0)] });
    renderWithQuery(<WorkMonitor />);
    const steps = await screen.findByTestId("flow-steps");
    expect(steps.querySelector("[aria-current=step]")?.textContent).toContain("Check the next run");
    expect(screen.queryByTestId("consequence")).toBeNull();
    expect(screen.queryByTestId("monitor-primary")).toBeNull();
  });

  it("keeps the weekly trend one click away, after the table", async () => {
    vi.spyOn(rem, "getMonitor").mockResolvedValue({ items: [item(4)] });
    renderWithQuery(<WorkMonitor />);
    const table = await screen.findByTestId("monitor-table");
    const more = screen.getByTestId("more-detail");
    expect(more.hasAttribute("open")).toBe(false);
    expect(table.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says what to do next when there is nothing to monitor", async () => {
    vi.spyOn(rem, "getMonitor").mockResolvedValue({ items: [] });
    renderWithQuery(<WorkMonitor />);
    expect((await screen.findByText(/Nothing to monitor yet/)).textContent).toBeTruthy();
    expect(screen.getByText("Open cleansing")).toBeTruthy();
    expect(screen.queryByTestId("flow-steps")).toBeNull();
  });

  it("shows a retry when the monitor cannot be read", async () => {
    vi.spyOn(rem, "getMonitor").mockRejectedValue(new Error("x"));
    renderWithQuery(<WorkMonitor />);
    expect(await screen.findByText("The monitor could not be read.")).toBeTruthy();
  });
});
