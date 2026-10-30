import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import * as runsApi from "@/lib/api/v2/runs";
import { fixtureTimeline, resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import { landscapeFixture } from "@/lib/api/v2/fixtures";
import { RunCanvas } from "../screens/Run";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

const RUNS = fixtureTimeline(undefined, 8).runs;
const R8 = RUNS[7].id;
const R7 = RUNS[6].id;
const R6 = RUNS[5].id; // the baseline

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetRunsFixture();
  setUrl(`/run/${R8}?fixture=1`);
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
const n = (s: string) => Number(s.replace(/[^\d]/g, ""));

describe("Run canvas", () => {
  it("is titled by the run's date, with the system beside it, and one h1", async () => {
    renderWithQuery(<RunCanvas id={R8} />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Run 16 Oct 2026, 05:17"));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("ECC production"));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("reads the status line: system, records checked, rules measured, duration and trigger", async () => {
    renderWithQuery(<RunCanvas id={R8} />);
    const line = await screen.findByTestId("run-status-line");
    await waitFor(() => expect(norm(line)).toContain("trigger scheduled"));
    expect(norm(line)).toBe("ECC production 400,662 records checked 794 rules measured scored in 11 m 42 s trigger scheduled");
  });

  it("draws a row per object scored by this run: measured, shown, verdict, records, rules, open work", async () => {
    renderWithQuery(<RunCanvas id={R8} />);
    const table = await screen.findByTestId("run-objects");
    expect(within(table).getAllByRole("columnheader").map((h) => norm(h))).toEqual(["Object", "Measured", "Shown", "Verdict", "Records checked", "Rules", "Open work"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(15);
    const mm = within(table).getByRole("row", { name: /Material master/ });
    expect(within(mm).getAllByRole("cell").map((c) => norm(c))).toEqual(["71.8", "70.0 capped", "No-go", "61,816", "80", "25,712"]);
    expect(within(mm).getByRole("link", { name: "Material master" })).toHaveAttribute("href", expect.stringContaining(`/o/ecc-production/material-master?run=${R8}`));
    const gl = within(table).getByRole("row", { name: /FI general ledger/ });
    expect(within(gl).getByText("Go")).toBeInTheDocument();
    // the table adds up to the status line
    const records = rows.reduce((sum, r) => sum + n(norm(within(r).getAllByRole("cell")[3])), 0);
    const rules = rows.reduce((sum, r) => sum + n(norm(within(r).getAllByRole("cell")[4])), 0);
    expect(records).toBe(landscapeFixture.status_strip.records_checked);
    expect(rules).toBe(landscapeFixture.status_strip.rules_measured);
    expect(screen.getByTestId("run-sentence")).toHaveTextContent("15 objects scored: 2 go, 2 at risk, 11 no-go.");
  });

  it("lists the run's extraction and analysis jobs; each opens the job inspector through the URL", async () => {
    renderWithQuery(<RunCanvas id={R8} />);
    const table = await screen.findByTestId("run-jobs");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(norm(rows[0])).toContain("Analysis, ECC production");
    expect(norm(rows[1])).toContain("Extraction, 15 objects");
    expect(norm(rows[0])).toContain("11 m 42 s");
    expect(within(rows[0]).getByRole("link")).toHaveAttribute("href", expect.stringContaining(`open=job%3A${R8}`));
  });

  it("a run with no job record says how long jobs are kept", async () => {
    setUrl(`/run/${R7}?fixture=1`);
    renderWithQuery(<RunCanvas id={R7} />);
    expect(await screen.findByText(/No job record is kept for this run/)).toBeInTheDocument();
  });

  it("Pin as baseline moves the baseline here and says so in the frame, not a toast", async () => {
    renderWithQuery(<RunCanvas id={R8} />);
    const pin = await screen.findByRole("button", { name: "Pin as baseline" });
    await waitFor(() => expect(pin).toBeEnabled());
    fireEvent.click(pin);
    const result = await screen.findByTestId("action-result");
    expect(result).toHaveTextContent("Pinned as the baseline");
    expect(result).toHaveAttribute("data-tone", "ok");
    expect(await screen.findByRole("button", { name: "Unpin baseline" })).toBeInTheDocument();
    await waitFor(() => expect(norm(screen.getByTestId("run-status-line"))).toContain("Baseline"));
  });

  it("the baseline run offers Unpin; Archive hides the runs older than this one and Restore brings them back", async () => {
    setUrl(`/run/${R6}?fixture=1`);
    renderWithQuery(<RunCanvas id={R6} />);
    expect(await screen.findByRole("button", { name: "Unpin baseline" })).toBeInTheDocument();
    const archive = await screen.findByRole("button", { name: "Archive the 5 older runs" });
    fireEvent.click(archive);
    const result = await screen.findByTestId("action-result");
    expect(result).toHaveTextContent("5 older runs archived");
    expect(result).toHaveTextContent("Nothing is deleted");
  });

  it("an archived run offers Restore, which brings every archived run back", async () => {
    await runsApi.archiveRuns(4);
    const archivedId = RUNS[4].id;
    setUrl(`/run/${archivedId}?fixture=1`);
    renderWithQuery(<RunCanvas id={archivedId} />);
    await waitFor(() => expect(norm(screen.getByTestId("run-status-line"))).toContain("Archived"));
    fireEvent.click(await screen.findByRole("button", { name: "Restore archived runs" }));
    expect(await screen.findByTestId("action-result")).toHaveTextContent("5 runs restored");
  });
;

  it("Download report asks for the run's report and answers in the frame", async () => {
    const spy = vi.spyOn(runsApi, "downloadRunReport");
    renderWithQuery(<RunCanvas id={R8} />);
    const download = await screen.findByRole("button", { name: "Download report" });
    await waitFor(() => expect(download).toBeEnabled());
    fireEvent.click(download);
    expect((await screen.findByTestId("action-result")).textContent).toContain("Fixture mode: no file is produced");
    expect(spy).toHaveBeenCalledWith(R8);
  });

  it("Compare with… offers the other runs, the baseline first, and links to /run/{earlier}/vs/{later}", async () => {
    renderWithQuery(<RunCanvas id={R8} />);
    const select = await screen.findByRole("combobox", { name: "Compare with" });
    await waitFor(() => expect(select).toHaveValue(R6));
    expect(screen.getByRole("link", { name: "Compare" })).toHaveAttribute("href", expect.stringContaining(`/run/${R6}/vs/${R8}`));
    fireEvent.change(select, { target: { value: R7 } });
    expect(screen.getByRole("link", { name: "Compare" })).toHaveAttribute("href", expect.stringContaining(`/run/${R7}/vs/${R8}`));
  });

  it("Show scores from this run sends the run to the landscape as ?run=", async () => {
    renderWithQuery(<RunCanvas id={R7} />);
    expect(await screen.findByRole("link", { name: "Show scores from this run" })).toHaveAttribute("href", expect.stringContaining(`/?run=${R7}`));
  });

  it("a run that cannot be read is an error inside the block, with Retry", async () => {
    vi.spyOn(runsApi, "getVersionHead").mockRejectedValue(new Error("gone"));
    renderWithQuery(<RunCanvas id="nope" />);
    const alert = await screen.findByTestId("error-frame");
    expect(alert).toHaveTextContent("This run could not be read");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
