import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TimelineRun } from "@/lib/api/v2/runs";
import { kindWord, shortDate, triggerOf } from "../format";
import { RunTimelineChart, timelineLayout } from "../RunTimelineChart";

const run = (id: string, run_at: string, baseline = false): TimelineRun => ({ id, run_at, baseline, label: null, system_id: null, kind: null, objects: {}, records_checked: null, duration_s: null });

describe("run format", () => {
  it("drops the year from the short date", () => {
    expect(shortDate("2026-10-16T10:00:00Z")).not.toMatch(/2026/);
    expect(shortDate("2026-10-16T10:00:00Z")).toMatch(/16/);
  });
  it("names the kind, passes an unknown one through and dashes none", () => {
    expect(kindWord("manual")).toBe("Started by hand");
    expect(kindWord("weird")).toBe("weird");
    expect(kindWord("toString")).toBe("toString");
    expect(kindWord(null)).toBe("—");
  });
  it("finds the trigger from the kind, then the metadata", () => {
    expect(triggerOf("scheduled", { trigger: "manual" })).toBe("scheduled");
    expect(triggerOf(null, { trigger: "recheck" })).toBe("recheck");
    expect(triggerOf(null, { file_name: "x.xlsx" })).toBe("upload");
    expect(triggerOf(null, null)).toBeNull();
  });
});

describe("timelineLayout", () => {
  const runs = [run("a", "2026-10-01T00:00:00Z", true), run("b", "2026-10-02T00:00:00Z"), run("c", "2026-10-31T00:00:00Z")];
  it("places runs by time and hides labels that would touch", () => {
    const g = timelineLayout(runs, 528, "c");
    expect(g.points.map((p) => p.x)).toEqual([28, 28 + 472 / 30, 500]);
    expect(g.points[0].label).not.toBeNull();
    expect(g.points[1].label).toBeNull();
    expect(g.points[2].label).not.toBeNull();
    expect(g.points[2].selected).toBe(true);
  });
  it("centres runs that share one time", () => {
    const g = timelineLayout([run("a", "2026-10-01T00:00:00Z")], 100, null);
    expect(g.points[0].x).toBe(50);
  });
});

describe("RunTimelineChart", () => {
  it("marks the baseline, picks on click and Enter", () => {
    const onPick = vi.fn();
    render(<RunTimelineChart runs={[run("a", "2026-10-01T00:00:00Z", true), run("b", "2026-10-20T00:00:00Z")]} selectedId="b" onPick={onPick} />);
    expect(screen.getByTestId("run-timeline")).toHaveAttribute("aria-label", "Runs on a date axis");
    expect(screen.getAllByTestId("tl-baseline")).toHaveLength(1);
    const buttons = screen.getAllByRole("button");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(buttons[0]);
    fireEvent.keyDown(buttons[1], { key: "Enter" });
    expect(onPick.mock.calls).toEqual([["a"], ["b"]]);
  });
});
