import { screen, waitFor } from "@testing-library/react";
import { vi, describe, it, expect } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as systemObjectsApi from "@/lib/api/system-objects";
import type { TrendPoint, TrendSummary } from "@/lib/api/system-objects";
import { TrendPanel } from "../trend-panel";

const point = (run_at: string, dqs: number): TrendPoint => ({
  version_id: run_at, run_at, label: null, baseline: false, dqs, dimensions: {}, records: 100,
  failing_records: 3, failing_checks: 1, issues_opened: 0, issues_resolved: 0,
  scope: {}, rule_set: null, comparable: true, flags: [],
});

const SUMMARY: TrendSummary = {
  object: "accounts_payable", points: 2, dqs: 82.5, dqs_delta: 2.5, failing_records: 3, failing_records_delta: -1,
  comparable: false, flags: ["rules_changed", "incomplete_extract"],
  vs_baseline: { version_id: "b", pinned: true, dqs_delta: -1.25, failing_records_delta: 0 },
};

describe("TrendPanel", () => {
  it("shows each object's score, change, baseline delta and flags", async () => {
    vi.spyOn(systemObjectsApi, "getTrends").mockResolvedValue({
      summary: [SUMMARY],
      series: { accounts_payable: [point("2026-10-01T00:00:00Z", 80), point("2026-10-08T00:00:00Z", 82.5)] },
    });
    renderWithQuery(<TrendPanel systemId="s1" />);
    await waitFor(() => expect(screen.getByText(/accounts payable/i)).toBeInTheDocument());
    expect(screen.getByText("82.5")).toBeInTheDocument();
    expect(screen.getByText("+2.5")).toBeInTheDocument();
    expect(screen.getByText("-1.3")).toBeInTheDocument();
    expect(screen.getByText("Rules changed")).toBeInTheDocument();
    expect(screen.getByText("Incomplete extract")).toBeInTheDocument();
    expect(systemObjectsApi.getTrends).toHaveBeenCalledWith("s1", undefined, true);
  });

  it("says so when nothing has been analysed", async () => {
    vi.spyOn(systemObjectsApi, "getTrends").mockResolvedValue({ summary: [], series: {} });
    renderWithQuery(<TrendPanel systemId="s1" />);
    await waitFor(() => expect(screen.getByText("No analysed run yet.")).toBeInTheDocument());
  });

  it("shows a retryable error", async () => {
    const spy = vi.spyOn(systemObjectsApi, "getTrends").mockRejectedValue(new Error("network down"));
    renderWithQuery(<TrendPanel systemId="s1" />);
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    spy.mockResolvedValue({ summary: [], series: {} });
    screen.getByRole("button", { name: /retry/i }).click();
    await waitFor(() => expect(screen.getByText("No analysed run yet.")).toBeInTheDocument());
  });
});
