import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { fixtureTimeline, resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import { RunTimelineChart, RunTimelineMenu, shortDate, timelineLayout } from "../RunTimeline";
import { getUrl, push, setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const RUNS = fixtureTimeline(undefined, 8).runs; // oldest first
const LATEST = RUNS[7];
const BASELINE = RUNS[5]; // 2 Oct

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetRunsFixture();
  push.mockClear();
  setUrl("/?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("timelineLayout, the date axis", () => {
  it("places the first and last run at the axis ends and every other run in proportion to its date", () => {
    const g = timelineLayout(RUNS, 620, LATEST.id);
    expect(g.points).toHaveLength(8);
    expect(g.points[0].x).toBe(28);
    expect(g.points[7].x).toBe(620 - 28);
    const t = RUNS.map((r) => new Date(r.run_at as string).getTime());
    g.points.forEach((p, i) => {
      const expected = 28 + ((620 - 56) * (t[i] - t[0])) / (t[7] - t[0]);
      expect(p.x).toBeCloseTo(expected, 6);
    });
    // weekly runs: the gaps are near equal, so the axis is not stretched or squeezed anywhere
    const gaps = g.points.slice(1).map((p, i) => p.x - g.points[i].x);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(4);
  });

  it("marks the baseline run and the selected run, and labels both even where the room is short", () => {
    const g = timelineLayout(RUNS, 620, BASELINE.id);
    const base = g.points.filter((p) => p.baseline);
    expect(base.map((p) => p.id)).toEqual([BASELINE.id]);
    expect(g.points.filter((p) => p.selected).map((p) => p.id)).toEqual([BASELINE.id]);
    expect(base[0].label).toBe("2 Oct");
    const cramped = timelineLayout(
      [
        { id: "a", run_at: "2026-08-28T05:00:00Z", baseline: false },
        { id: "b", run_at: "2026-10-16T05:00:00Z", baseline: false },
        { id: "c", run_at: "2026-10-16T05:30:00Z", baseline: true },
      ],
      300,
      "b",
    );
    expect(cramped.points.map((p) => p.label)).toEqual(["28 Aug", "16 Oct", "16 Oct"]);
    const tight = timelineLayout(
      [
        { id: "a", run_at: "2026-08-28T05:00:00Z", baseline: false },
        { id: "b", run_at: "2026-10-16T05:00:00Z", baseline: false },
        { id: "c", run_at: "2026-10-16T05:30:00Z", baseline: false },
      ],
      300,
      "b",
    );
    expect(tight.points[2].label).toBeNull(); // too close to the selected run's label
  });

  it("puts a single run in the middle", () => {
    const g = timelineLayout([{ id: "a", run_at: "2026-10-16T05:17:00Z", baseline: false }], 400, "a");
    expect(g.points[0].x).toBe(200);
  });

  it("writes the date without the year", () => {
    expect(shortDate("2026-10-16T05:17:00Z")).toBe("16 Oct");
  });
});

describe("<RunTimelineChart>", () => {
  it("draws one button per run, the selected one pressed, the baseline marked with the word", () => {
    const onPick = vi.fn();
    renderWithQuery(<RunTimelineChart runs={RUNS} selectedId={LATEST.id} onPick={onPick} />);
    const runs = screen.getAllByRole("button");
    expect(runs).toHaveLength(8);
    expect(runs.filter((r) => r.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(runs[7]).toHaveAccessibleName("Run 16 Oct 2026, 05:17, selected");
    expect(runs[5]).toHaveAccessibleName("Run 2 Oct 2026, 05:09, baseline");
    expect(screen.getByTestId("tl-baseline")).toHaveTextContent("baseline");
    expect(runs[7]).toHaveClass("m2-on");
  });

  it("a click or Enter picks the run; the arrow keys move between runs", () => {
    const onPick = vi.fn();
    renderWithQuery(<RunTimelineChart runs={RUNS} selectedId={LATEST.id} onPick={onPick} />);
    const runs = screen.getAllByRole("button");
    fireEvent.click(runs[2]);
    expect(onPick).toHaveBeenLastCalledWith(RUNS[2].id);
    runs[3].focus();
    fireEvent.keyDown(runs[3], { key: "ArrowRight" });
    expect(runs[4]).toHaveFocus();
    fireEvent.keyDown(runs[4], { key: "Enter" });
    expect(onPick).toHaveBeenLastCalledWith(RUNS[4].id);
  });
});

describe("<RunTimelineMenu>, the run control in the top bar", () => {
  it("names the latest run, opens a dialog with the last 8 runs, and says what choosing does", async () => {
    renderWithQuery(<RunTimelineMenu />);
    const button = await screen.findByRole("button", { name: "Run 16 Oct 2026, 05:17" });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "Runs, 28 Aug 2026 to 16 Oct 2026" });
    expect(within(dialog).getAllByRole("button", { pressed: false })).toHaveLength(7); // the 7 runs not selected
    expect(within(dialog).getAllByRole("button", { pressed: true })).toHaveLength(1);
    expect(within(dialog).getByTestId("tl-selected")).toHaveTextContent("Selected: run 16 Oct 2026, 05:17, 15 objects scored");
    expect(within(dialog).getByTestId("tl-selected")).toHaveTextContent("Choosing a run re-scopes every score on the canvas.");
  });

  it("picking a run sets it in the URL, so Landscape and Object re-scope; the latest clears it", async () => {
    renderWithQuery(<RunTimelineMenu />);
    fireEvent.click(await screen.findByRole("button", { name: /^Run 16 Oct/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Run 2 Oct 2026/ }));
    expect(getUrl()).toContain(`run=${BASELINE.id}`);
    expect(getUrl()).toContain("fixture=1");
    expect(screen.queryByRole("dialog")).toBeNull();
    // with that run chosen the control names it, and choosing the latest again drops the parameter
    expect(await screen.findByRole("button", { name: /^Run 2 Oct 2026/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Run 2 Oct/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /^Run 16 Oct 2026/ }));
    expect(getUrl()).not.toContain("run=");
  });

  it("on a run page, picking a run goes to that run", async () => {
    setUrl(`/run/${LATEST.id}?fixture=1`);
    renderWithQuery(<RunTimelineMenu />);
    fireEvent.click(await screen.findByRole("button", { name: /^Run 16 Oct/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /^Run 9 Oct 2026/ }));
    expect(getUrl()).toContain(`/run/${RUNS[6].id}`);
  });

  it("Compare with… picks a second run (the baseline by default) and opens /run/{a}/vs/{b}, the earlier first", async () => {
    renderWithQuery(<RunTimelineMenu />);
    fireEvent.click(await screen.findByRole("button", { name: /^Run 16 Oct/ }));
    const dialog = await screen.findByRole("dialog");
    const select = within(dialog).getByRole("combobox", { name: "Compare with" });
    await waitFor(() => expect(select).toHaveValue(BASELINE.id));
    expect(within(select).getByRole("option", { name: "2 Oct 2026, 05:09 (baseline)" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Compare with…" }));
    expect(getUrl()).toContain(`/run/${BASELINE.id}/vs/${LATEST.id}`);
    fireEvent.click(await screen.findByRole("button", { name: /^Run 16 Oct/ }));
    const again = within(await screen.findByRole("dialog")).getByRole("combobox", { name: "Compare with" });
    fireEvent.change(again, { target: { value: RUNS[0].id } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Compare with…" }));
    expect(getUrl()).toContain(`/run/${RUNS[0].id}/vs/${LATEST.id}`);
  });

  it("Esc closes it and gives focus back to the button", async () => {
    renderWithQuery(<RunTimelineMenu />);
    const button = await screen.findByRole("button", { name: /^Run 16 Oct/ });
    fireEvent.click(button);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("the scope's system limits the timeline to its runs; a system with none says so", async () => {
    setUrl("/?fixture=1&system=s-4hana-sandbox");
    renderWithQuery(<RunTimelineMenu />);
    const button = await screen.findByRole("button", { name: "No run yet" });
    fireEvent.click(button);
    expect(await screen.findByText(/No run has finished for this scope yet/)).toBeInTheDocument();
  });
});
