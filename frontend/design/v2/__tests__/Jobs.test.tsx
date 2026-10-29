import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetRunsFixture } from "@/lib/api/v2/fixtures/runs";
import { firstSentence, jobDoing, openFailures } from "@/lib/v2/jobs";
import type { Job } from "@/types/jobs";
import { Inspector } from "../Inspector";
import { FixtureJobLine, LiveJobLine } from "../shell/JobLine";
import { StatusStrip } from "../shell/StatusStrip";
import { streamJobs } from "@/lib/api/jobs";
import { setUrl } from "./nav-store";

const h = vi.hoisted(() => ({ emit: (() => undefined) as (job: unknown) => void, allowed: new Set<string>(["trigger_sync", "analyse"]) }));

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/lib/api/jobs", () => ({
  getJobs: vi.fn(async () => []),
  getJob: vi.fn(),
  retryJob: vi.fn(),
  streamJobs: vi.fn((onJob: (j: unknown) => void) => {
    h.emit = onJob;
    return () => undefined;
  }),
}));
vi.mock("@/lib/v2/hooks", async (orig) => {
  const m = await orig<typeof import("@/lib/v2/hooks")>();
  return { ...m, useV2Session: () => ({ persona: "basis", label: "SAP Basis", name: "", email: null, fixture: true, can: (a: string) => h.allowed.has(a) }) };
});

function job(over: Partial<Job>): Job {
  return {
    id: "dl-1",
    kind: "extraction",
    status: "running",
    label: "material_master",
    stage: "read",
    stages: [],
    percent: 42,
    rows_done: 0,
    rows_total: 0,
    message: "",
    tables: [],
    error: null,
    result: null,
    started_at: 1_000,
    updated_at: 1_010,
    finished_at: null,
    system_id: "a1b2c3d4-0001-4000-8000-000000000001",
    modules: ["material_master"],
    ...over,
  };
}

beforeEach(() => {
  resetRunsFixture();
  h.allowed = new Set(["trigger_sync", "analyse"]);
  setUrl("/v2?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  window.history.pushState({}, "", "/");
  vi.clearAllMocks();
});

const norm = (el: HTMLElement) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
/** An element read child by child, so adjacent cells and spans do not run together. */
const spaced = (el: Element) => Array.from(el.children).map((c) => (c.textContent ?? "").trim()).filter(Boolean).join(" ");
const streaming = () => waitFor(() => expect(vi.mocked(streamJobs)).toHaveBeenCalled());

describe("job words", () => {
  it("names what a job does in the job line's words, and shortens an error to its first sentence", () => {
    expect(jobDoing(job({}))).toBe("Extracting Material master");
    expect(jobDoing(job({ kind: "analysis", modules: undefined, label: "Analysis | ECC production" }))).toBe("Analysing ECC production");
    expect(jobDoing(job({ modules: ["a_b", "c_d", "e_f", "g_h"] }))).toBe("Extracting 4 objects");
    expect(firstSentence("OData refused credentials (HTTP 401). Check the client id.")).toBe("OData refused credentials (HTTP 401).");
  });

  it("an open failure is the newest failure that no later success of the same kind on the same system replaced", () => {
    const failed = job({ id: "f", status: "failed", started_at: 100, finished_at: 110 });
    const later = job({ id: "ok", status: "completed", started_at: 120, finished_at: 130 });
    const otherSystem = job({ id: "ok2", status: "completed", system_id: "other", finished_at: 500 });
    expect(openFailures([failed, otherSystem]).map((j) => j.id)).toEqual(["f"]);
    expect(openFailures([failed, later])).toEqual([]);
  });
});

describe("the job line, fed by the jobs stream", () => {
  it("is empty until a job runs; then it names the kind, the object and the percent, and links to the job", async () => {
    renderWithQuery(<LiveJobLine />);
    const line = screen.getByTestId("job-line");
    await streaming();
    expect(line).not.toHaveClass("m2-on");
    act(() => h.emit(job({ id: "dl-1", percent: 42 })));
    await waitFor(() => expect(line).toHaveClass("m2-on"));
    expect(norm(line)).toBe("Extracting Material master 42%");
    const link = within(line).getByTestId("job-line-link");
    expect(link).toHaveAttribute("href", expect.stringContaining("open=job%3Adl-1"));
    expect((line.querySelector(".m2-job-bar") as HTMLElement).style.width).toBe("42%");
    act(() => h.emit(job({ id: "dl-1", percent: 80, updated_at: 1_020 })));
    await waitFor(() => expect(norm(line)).toBe("Extracting Material master 80%"));
  });

  it("with two jobs running it shows the newest and counts the other; when they finish the line empties", async () => {
    renderWithQuery(<LiveJobLine />);
    const line = screen.getByTestId("job-line");
    await streaming();
    act(() => h.emit(job({ id: "dl-1", percent: 30, updated_at: 1_000 })));
    act(() => h.emit(job({ id: "an-1", kind: "analysis", modules: undefined, label: "Analysis | ECC production", percent: 10, updated_at: 1_050 })));
    await waitFor(() => expect(norm(line)).toBe("Analysing ECC production and 1 more 10%"));
    act(() => h.emit(job({ id: "an-1", kind: "analysis", status: "completed", modules: undefined, label: "Analysis | ECC production", percent: 100, finished_at: 1_100, updated_at: 1_100 })));
    await waitFor(() => expect(norm(line)).toBe("Extracting Material master 30%"));
    act(() => h.emit(job({ id: "dl-1", status: "completed", percent: 100, finished_at: 1_200, updated_at: 1_200 })));
    await waitFor(() => expect(line).not.toHaveClass("m2-on"));
    expect(norm(line)).toBe("");
  });

  it("in fixture mode a running extraction appears with ?job=running", async () => {
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    window.history.pushState({}, "", "/v2?fixture=1&job=running");
    renderWithQuery(<FixtureJobLine />);
    await waitFor(() => expect(norm(screen.getByTestId("job-line"))).toBe("Extracting Material master 42%"));
  });
});

describe("a failed job in the status strip", () => {
  it("adds one line after the figures, with the first sentence of the error and a way into the job", async () => {
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    renderWithQuery(<StatusStrip />);
    const line = await screen.findByTestId("status-failure");
    expect(norm(line)).toBe("Extraction of Employee central failed: OData refused credentials (HTTP 401). Open");
    expect(within(line).getByRole("link", { name: "Open" })).toHaveAttribute("href", expect.stringContaining("open=job%3Adl-failed-sf"));
    expect(norm(screen.getByTestId("status-strip").querySelector(".m2-status-t") as HTMLElement)).toContain("400,662 records checked");
  });
});

describe("the job inspector", () => {
  beforeEach(() => window.sessionStorage.setItem("mn_v2_fixture", "1"));

  it("shows a failed job's stages, its tables, the error and Retry", async () => {
    setUrl("/v2?fixture=1&open=job:dl-failed-sf");
    renderWithQuery(<Inspector />);
    const dialog = await screen.findByRole("dialog", { name: "Extraction, Employee central" });
    await within(dialog).findByTestId("job-stages");
    expect(norm(dialog.querySelector(".m2-ih-sl") as HTMLElement)).toBe("Failed");
    const stages = within(screen.getByTestId("job-stages")).getAllByRole("listitem");
    expect(stages.map((s) => spaced(s))).toEqual(["Connecting Failed", "Reading tables Waiting", "Storing data Waiting", "Registering version Waiting", "Analysis Waiting"]);
    expect(spaced(within(screen.getByTestId("job-tables")).getAllByRole("row")[1])).toBe("EmpEmployment Failed 0");
    expect(screen.getByTestId("job-error")).toHaveTextContent("OData refused credentials (HTTP 401). Check the client id and secret in the system settings.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  });

  it("Retry starts the job again and answers in the frame with a link to the new job", async () => {
    setUrl("/v2?fixture=1&open=job:dl-failed-sf");
    renderWithQuery(<Inspector />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    const result = await screen.findByTestId("action-result");
    expect(result).toHaveTextContent("Started again");
    expect(within(result).getByRole("link", { name: "Open the job" })).toHaveAttribute("href", expect.stringContaining("open=job%3Adl-retry-"));
  });

  it("Retry is gated by the permission the retry route asks for, and says so", async () => {
    h.allowed = new Set(["view"]);
    setUrl("/v2?fixture=1&open=job:dl-failed-sf");
    renderWithQuery(<Inspector />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(retry).toBeDisabled();
    expect(screen.getByText(/Retry needs the trigger sync permission on this system/)).toBeInTheDocument();
  });

  it("a running job shows its percent, its message and each table with the rows read of the rows expected, and offers no Retry", async () => {
    window.history.pushState({}, "", "/v2?fixture=1&job=running");
    setUrl("/v2?fixture=1&job=running&open=job:dl-e0000000-0000-4000-8000-0000000000e1");
    renderWithQuery(<Inspector />);
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("Reading MARC")).toBeInTheDocument();
    expect(spaced(within(screen.getByTestId("job-tables")).getAllByRole("row")[2])).toBe("MARC Reading 106,584 of 148,230");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("a completed analysis links to its run", async () => {
    setUrl("/v2?fixture=1&open=job:d3229ded-0708-4967-9dfb-1b7f4fada953");
    renderWithQuery(<Inspector />);
    const link = await screen.findByRole("link", { name: "Open the run" });
    expect(link).toHaveAttribute("href", expect.stringContaining("/v2/run/d3229ded-0708-4967-9dfb-1b7f4fada953"));
    expect(screen.getByText("11 m 42 s")).toBeInTheDocument();
  });

  it("a job that is gone says how long jobs are kept", async () => {
    setUrl("/v2?fixture=1&open=job:missing");
    renderWithQuery(<Inspector />);
    expect(await screen.findByText(/no longer in the registry/)).toBeInTheDocument();
  });
});
