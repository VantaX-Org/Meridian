import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { ratesOf, type RunProgress } from "@/lib/api/next/live-runs";
import { ProgressRing, SegmentedBar, ThroughputSpark } from "../live/LiveCharts";
import { LiveRunCard, etaText, segmentsOf, stepText } from "../live/LiveRunCard";

const getActive = vi.fn<() => Promise<{ runs: RunProgress[] }>>();
vi.mock("@/lib/api/v2/client", async (orig) => ({ ...(await orig<typeof import("@/lib/api/v2/client")>()), v2Get: () => getActive() }));

const run = (over: Partial<RunProgress> = {}): RunProgress => ({
  id: "j1", kind: "extraction", label: "Extraction | Material master", status: "running", state: "running",
  pct: 41.5, determinate: true, stage: "read", stage_index: 1, stage_count: 3,
  stages: [{ id: "connect", label: "Connect", status: "done" }, { id: "read", label: "Read tables", status: "running" }, { id: "save", label: "Save", status: "queued" }],
  step: { unit: "rows", done: 1_250_000, total: 5_000_000, pct: 25 }, parts: [],
  rows: 1_250_000, rows_per_min: 90_000, elapsed_s: 840, idle_s: 2, eta_s: 2520, eta_is_estimate: true,
  message: "", error: null, started_at: 1, updated_at: 2, finished_at: null, queue_position: null,
  system_id: null, version_id: null, modules: ["material_master"], ...over,
});

describe("progress ring", () => {
  it("states its value when known", () => {
    render(<ProgressRing pct={41.5} state="running" label="Extraction" />);
    const bar = screen.getByRole("progressbar", { name: "Extraction" });
    expect(bar).toHaveAttribute("aria-valuenow", "41.5");
    expect(bar).not.toHaveAttribute("aria-busy");
    expect(bar).toHaveTextContent("42%");
  });
  it("is busy with no value when unknown", () => {
    render(<ProgressRing pct={null} state="running" label="Sync" />);
    const bar = screen.getByRole("progressbar", { name: "Sync" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("aria-busy", "true");
    expect(bar).toHaveAttribute("aria-valuetext", "Progress unknown");
  });
  it("settles at 100 in the good tone when completed", () => {
    render(<ProgressRing pct={100} state="completed" label="Done run" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("data-tone", "good");
  });
  it("uses warn and bad tones for stalled and failed", () => {
    const { rerender } = render(<ProgressRing pct={30} state="stalled" label="r" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("data-tone", "warn");
    rerender(<ProgressRing pct={30} state="failed" label="r" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("data-tone", "bad");
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-busy");
  });
});

describe("segments and throughput", () => {
  it("gives each stage its own percent, unknown only where the step has no total", () => {
    expect(segmentsOf(run()).map((s) => s.pct)).toEqual([100, 25, 0]);
    expect(segmentsOf(run({ step: { unit: null, done: 0, total: null, pct: null } }))[1].pct).toBeNull();
  });
  it("uses tables when extraction reads them", () => {
    const r = run({ parts: [{ name: "MARA", state: "done", status: "completed", done: 10, total: 10, pct: 100 }, { name: "MARC", state: "running", status: "running", done: 3, total: null, pct: null }] });
    const s = segmentsOf(r);
    expect(s.map((x) => x.label)).toEqual(["MARA", "MARC"]);
    render(<SegmentedBar segments={s} label="Tables" />);
    expect(screen.getByRole("img", { name: "Tables" })).toBeInTheDocument();
    expect(document.querySelectorAll(".nx-live-seg-busy")).toHaveLength(1);
  });
  it("computes rows per minute between samples and skips repeated times", () => {
    expect(ratesOf([{ t: 0, rows: 0 }, { t: 30, rows: 1000 }, { t: 30, rows: 1000 }, { t: 60, rows: 1500 }])).toEqual([2000, 1000]);
  });
  it("says it needs more samples before drawing a line", () => {
    render(<ThroughputSpark rates={[5]} label="Throughput" />);
    expect(screen.getByText("Rate appears after a few updates")).toBeInTheDocument();
  });
  it("draws the line with a text summary in compact numbers", () => {
    render(<ThroughputSpark rates={[120_000, 1_500_000]} label="Throughput" />);
    expect(screen.getByRole("img", { name: /now 1.5M rows a minute/ })).toBeInTheDocument();
  });
});

describe("run card", () => {
  it("shows step, compact records, elapsed and the labelled estimate", () => {
    render(<LiveRunCard run={run()} rates={[]} onOpen={() => undefined} />);
    expect(screen.getByText("Read tables: 1.3M of 5M rows")).toBeInTheDocument();
    expect(screen.getByText("1.3M")).toBeInTheDocument();
    expect(screen.getByText(/\(estimate\)/)).toBeInTheDocument();
  });
  it("hides the estimate when there is none", () => {
    expect(etaText(run({ eta_s: null }))).toBeNull();
    render(<LiveRunCard run={run({ eta_s: null })} rates={[]} onOpen={() => undefined} />);
    expect(screen.queryByText(/estimate/)).toBeNull();
  });
  it("says where a queued run waits", () => {
    expect(stepText(run({ status: "queued", state: "queued", queue_position: 2 }))).toBe("Waiting, position 2");
  });
});

describe("live runs section", () => {
  it("renders nothing when there are no runs", async () => {
    getActive.mockResolvedValue({ runs: [] });
    const { LiveRuns } = await import("../live/LiveRuns");
    renderWithQuery(<LiveRuns />);
    await waitFor(() => expect(getActive).toHaveBeenCalled());
    expect(screen.queryByTestId("live-runs")).toBeNull();
  });
  it("lists many runs and opens the detail with a table of tables", async () => {
    const parts = [{ name: "MARA", state: "done" as const, status: "completed", done: 10, total: 10, pct: 100 }];
    getActive.mockResolvedValue({ runs: [run({ parts }), run({ id: "j2", kind: "analysis", pct: null, determinate: false }), run({ id: "j3", status: "failed", state: "failed", error: "Connection lost" })] });
    const { LiveRuns } = await import("../live/LiveRuns");
    renderWithQuery(<LiveRuns />);
    expect(await screen.findAllByTestId("live-run-card")).toHaveLength(3);
    await userEvent.click(screen.getAllByRole("button", { name: "Details" })[0]);
    expect(await screen.findByRole("table")).toHaveTextContent("MARA");
  });
});
