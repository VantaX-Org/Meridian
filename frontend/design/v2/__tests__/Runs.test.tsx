import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { fixtureTimeline, resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import { landscapeFixture } from "@/lib/api/v2/fixtures";
import { RunsCanvas, runStatus, rulesOf, scoreRange } from "../screens/Runs";
import { getUrl, push, setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const RUNS = fixtureTimeline(undefined, 8).runs;
const S4 = landscapeFixture.systems[1];

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetRunsFixture();
  push.mockClear();
  setUrl("/runs?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
/** A row read cell by cell, so adjacent cells do not run together. */
const cells = (el: HTMLElement) => Array.from(el.children).map((c) => norm(c as HTMLElement)).join(" ");

describe("helpers", () => {
  it("reads status as a mark and a word, and the score range and rule count from the run's summary", () => {
    expect(runStatus("complete")).toEqual({ word: "Complete", mark: "go" });
    expect(runStatus("agents_failed")).toEqual({ word: "Failed", mark: "no-go" });
    expect(runStatus("pending").word).toBe("Queued");
    const v = { dqs_summary: { a: { composite_score: 70, total_checks: 10 }, b: { composite_score: 93.4, total_checks: 5 }, c: { composite_score: null } } } as never;
    expect(scoreRange(v)).toEqual([70, 93.4]);
    expect(rulesOf(v)).toBe(15);
    expect(scoreRange({ dqs_summary: null } as never)).toBeNull();
  });
});

describe("Runs canvas", () => {
  it("has the title, the baseline in the banner, the view switch beside the filters and the timeline at full width", async () => {
    renderWithQuery(<RunsCanvas />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Runs");
    expect(await screen.findByText(/Finished on 16 Oct 2026/)).toBeInTheDocument();
    expect(screen.getByTestId("runs-banner")).toHaveTextContent(/baseline 2 Oct 2026/);
    expect(screen.queryByText(/The timeline shows the last/)).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Runs views" });
    expect(nav.parentElement).toHaveClass("m2-rfilters");
    // One group per system, each counting its own rows: eight finished runs on ECC, the failed one on S/4HANA.
    const groups = await screen.findAllByTestId("runs-group");
    expect(groups.map((g) => within(g).getAllByTestId("run-row").length)).toEqual([8, 1]);
    expect(within(groups[0]).getByTestId("runs-count")).toHaveTextContent("8 runs");
    expect(within(groups[1]).getByTestId("runs-count")).toHaveTextContent("1 run, 1 failed");
    const chart = await screen.findByTestId("run-timeline");
    expect(within(chart).getAllByRole("button")).toHaveLength(8);
    expect(within(chart).getByTestId("tl-baseline")).toBeInTheDocument();
  });

  it("choosing a run on the timeline opens that run", async () => {
    renderWithQuery(<RunsCanvas />);
    const chart = await screen.findByTestId("run-timeline");
    fireEvent.click(within(chart).getAllByRole("button")[2]);
    expect(getUrl()).toContain(`/run/${RUNS[2].id}`);
  });

  it("tabulates each system's runs: name and date, status, records, time, objects, scores, compare with previous", async () => {
    renderWithQuery(<RunsCanvas />);
    const [ecc, s4] = await screen.findAllByTestId("runs-group");
    const table = within(ecc).getByTestId("runs-table");
    expect(within(table).getAllByRole("columnheader").map((h) => norm(h))).toEqual(["Run", "Status", "Records checked", "Took", "Objects scored", "Scores, out of 100", "Compare"]);
    const rows = await within(table).findAllByTestId("run-row");
    await waitFor(() => expect(norm(rows[0])).toContain("ECC production run"));
    expect(rows).toHaveLength(8);
    expect(cells(rows[0])).toContain("16 Oct 2026");
    expect(cells(rows[0])).toContain("400,662");
    expect(cells(rows[0])).toContain("70.0 to 93.4");
    expect(cells(rows[0])).toContain("11 m 42 s");
    expect(within(rows[0]).getByTestId("run-chip").closest("a")).toHaveAttribute("href", expect.stringContaining(`/run/${RUNS[7].id}`));
    // Compare pairs a run only with the run before it on the same system; the oldest says it is first.
    expect(within(rows[0]).getByTestId("compare-previous")).toHaveAttribute("href", expect.stringContaining(`/run/${RUNS[6].id}/vs/${RUNS[7].id}`));
    expect(within(rows[7]).queryByTestId("compare-previous")).toBeNull();
    expect(rows[7]).toHaveTextContent("First run");
    const baseline = rows.find((r) => /Baseline/.test(norm(r))) as HTMLElement;
    expect(norm(baseline)).toContain("2 Oct 2026");
    const failed = within(s4).getByTestId("run-row");
    expect(cells(failed)).toContain("S/4HANA sandbox");
    expect(cells(failed)).toContain("Failed");
    expect(within(failed).getAllByText("—").length).toBeGreaterThan(2);
  });

  it("filters by system and by status", async () => {
    renderWithQuery(<RunsCanvas />);
    await screen.findAllByTestId("run-row");
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "failed" } });
    expect(screen.getAllByTestId("run-row")).toHaveLength(1);
    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("combobox", { name: "System" }), { target: { value: S4.id } });
    expect(screen.getAllByTestId("run-row")).toHaveLength(1);
    fireEvent.change(screen.getByRole("combobox", { name: "System" }), { target: { value: landscapeFixture.systems[0].id } });
    expect(screen.getAllByTestId("run-row")).toHaveLength(8);
    fireEvent.change(screen.getByRole("combobox", { name: "System" }), { target: { value: landscapeFixture.systems[2].id } });
    expect(screen.getByText(/No run matches these filters\./)).toBeInTheDocument();
  });

  it("Start a run analyses the newest stored extraction of a system and links the job it started", async () => {
    renderWithQuery(<RunsCanvas />);
    const start = await screen.findByRole("button", { name: "Start a run" });
    fireEvent.click(start);
    const panel = await screen.findByTestId("start-run");
    const select = within(panel).getByRole("combobox", { name: "System" });
    await waitFor(() => expect(select).toHaveValue(S4.id)); // the one extracted but not analysed comes first
    const go = within(panel).getByRole("button", { name: "Analyse S/4HANA sandbox" });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(go);
    const result = await within(panel).findByTestId("action-result");
    expect(result).toHaveTextContent("Analysis started");
    expect(within(result).getByRole("link", { name: "Open the job" })).toHaveAttribute("href", expect.stringContaining("open=job%3As4-extract"));
  });

  it("Start a run links to extracting fresh data from the chosen system", async () => {
    renderWithQuery(<RunsCanvas />);
    fireEvent.click(await screen.findByRole("button", { name: "Start a run" }));
    const panel = await screen.findByTestId("start-run");
    const link = await within(panel).findByTestId("start-run-extract");
    await waitFor(() => expect(link).toHaveAttribute("href", expect.stringContaining(`/s/${S4.id}?open=system%3A${S4.id}`)));
  });

  it("a run with nothing to show says so", async () => {
    setUrl("/runs?fixture=1&system=successfactors");
    renderWithQuery(<RunsCanvas />);
    expect(await screen.findByText("Runs appear here once a system has been extracted and analysed.")).toBeInTheDocument();
  });
});

describe("Runs canvas, the Jobs view", () => {
  beforeEach(() => setUrl("/runs?fixture=1&view=jobs"));

  it("shows every job with its kind, object, system, state, progress, start and duration", async () => {
    renderWithQuery(<RunsCanvas />);
    const table = await screen.findByTestId("jobs-table");
    const rows = within(table).getAllByTestId("job-row");
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => norm(within(r).getAllByRole("rowheader")[0]))).toEqual(["Extraction", "Analysis", "Extraction", "Configuration load"]);
    expect(cells(rows[0])).toContain("Employee central");
    expect(norm(rows[0])).toContain("Failed");
    expect(norm(rows[1])).toContain("11 m 42 s");
    expect(norm(rows[1])).toContain("100%");
    expect(screen.getByRole("link", { name: /^Jobs/ })).toHaveAttribute("aria-current", "page");
  });

  it("filters by kind and state; a row opens the job inspector through the URL", async () => {
    renderWithQuery(<RunsCanvas />);
    await screen.findByTestId("jobs-table");
    fireEvent.change(screen.getByRole("combobox", { name: "Kind" }), { target: { value: "analysis" } });
    expect(screen.getAllByTestId("job-row")).toHaveLength(1);
    fireEvent.change(screen.getByRole("combobox", { name: "Kind" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("combobox", { name: "State" }), { target: { value: "failed" } });
    const rows = screen.getAllByTestId("job-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByRole("link", { name: "Extraction" })).toHaveAttribute("href", expect.stringContaining("open=job%3Adl-failed-sf"));
    expect(screen.getByRole("option", { name: "Process discovery" })).toBeInTheDocument();
  });
});
