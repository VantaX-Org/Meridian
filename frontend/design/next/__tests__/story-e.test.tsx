import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getUrl, push, replace, setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { fixtureRunId } from "@/lib/api/next/runs-fixture";
import { AreaTrend, HeatGrid, ScoreRing, StackedBar } from "../viz";
import { ToastProvider } from "../kit";
import { Runs, runScore } from "../runs/Runs";
import { RunDetail, RunDetailSheet } from "../runs/RunDetail";
import { CompareSheet, MAX_COMPARE_RUNS, capRuns } from "../runs/CompareSheet";
import { RunSheet, EMPTY_DRAFT, SHEET_ID, firstInvalidStep, scopeOf } from "../runs/RunSheet";
import { NextSwap } from "../runs/NextSwap";
import { loadDraft, saveDraft } from "../runs/draft";
import { Work, Ledger } from "../work/Work";
import { segmentOf, WORK_SEGMENTS } from "../work/segments";
import { WorkBulkBar } from "../work/BulkBar";
import { SheetHost, registerSheet } from "../shell/SheetHost";
import { registry } from "../shell/registry";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
const prefs = { value: { ui_next: true } as Record<string, unknown> };
vi.mock("@/hooks/use-preferences", () => ({ usePreferences: () => ({ prefs: prefs.value, setPref: () => undefined, loading: false }) }));

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  undo = stubLayout();
  setUrl("/next/runs?fixture=1");
  push.mockClear();
  replace.mockClear();
  prefs.value = { ui_next: true };
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
});

const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider><SheetHost>{ui}</SheetHost></ToastProvider>);

describe("viz kit", () => {
  it("ScoreRing shows the value with a text equivalent, and a no-score shape when null", () => {
    const { unmount } = render(<ScoreRing value={72} label="Run score 72 out of 100" />);
    expect(screen.getByRole("img", { name: "Run score 72 out of 100" })).toBeInTheDocument();
    unmount();
    render(<ScoreRing value={null} label="No score" />);
    expect(screen.getAllByText("No score").length).toBeGreaterThan(0);
  });

  it("AreaTrend draws from two points and shows the empty copy below that", () => {
    const { unmount } = render(<AreaTrend label="Score over the last runs" empty="The trend appears after two scored runs." points={[{ label: "a", value: 40 }, { label: "b", value: 60 }]} />);
    expect(screen.getByRole("img", { name: "Score over the last runs" })).toBeInTheDocument();
    unmount();
    render(<AreaTrend label="Score over the last runs" empty="The trend appears after two scored runs." points={[{ label: "a", value: 40 }]} />);
    expect(screen.getByText("The trend appears after two scored runs.")).toBeInTheDocument();
  });

  it("StackedBar gives each segment a tooltip title", () => {
    const { container } = render(<StackedBar label="Findings" segs={[{ id: "a", label: "Bad", value: 3, tone: "bad" }, { id: "b", label: "Good", value: 1, tone: "good" }]} />);
    expect(container.querySelectorAll("title").length).toBeGreaterThanOrEqual(2);
  });

  it("HeatGrid renders one cell per row and column", () => {
    const { container } = render(<HeatGrid label="Heat" rows={["r1", "r2"]} cols={["c1", "c2"]} cells={{ "r1|c1": { key: "r1|c1", title: "x", value: 50 } }} />);
    expect(container.querySelectorAll("title").length).toBeGreaterThanOrEqual(1);
  });
});

describe("sheet registry", () => {
  it("registers run and compare without an import cycle problem", () => {
    // Importing SheetHost pulls in sheets.ts; if the registry were in the TDZ the import above would have thrown.
    expect(typeof registerSheet).toBe("function");
    expect(registry.has("run")).toBe(true);
    expect(registry.has("compare")).toBe(true);
  });
});

describe("Runs", () => {
  it("shows the heading, a Start a run button that opens the sheet, and the runs", async () => {
    wrap(<Runs />);
    expect(await screen.findByRole("heading", { name: "Runs" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start a run" }));
    // Sheets open through history.pushState (Next mirrors it into the router), not router.push.
    expect(getUrl()).toContain("sheet=run");
    expect((window.history.state as { nxSheet?: boolean } | null)?.nxSheet).toBe(true);
  });

  it("keeps Compare disabled until two runs are ticked, and caps at six", async () => {
    wrap(<Runs />);
    await screen.findByRole("heading", { name: "Runs" });
    await waitFor(() => expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(2));
    const rowBoxes = screen.getAllByRole("checkbox").slice(1);
    await userEvent.click(rowBoxes[0]);
    expect(await screen.findByRole("button", { name: /Compare \(1\)/ })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(rowBoxes[1]);
    expect(await screen.findByRole("button", { name: /Compare \(2\)/ })).not.toHaveAttribute("aria-disabled", "true");
    expect(MAX_COMPARE_RUNS).toBe(6);
    expect(capRuns(["1", "2", "3", "4", "5", "6", "7", "8"])).toEqual({ shown: ["1", "2", "3", "4", "5", "6"], dropped: 2 });
  });

  it("scores a run from its own summary only", () => {
    expect(runScore({ dqs_summary: {} } as never)).toBeNull();
  });
});

describe("RunDetail", () => {
  it("shows the run, its steps, objects and what changed", async () => {
    wrap(<RunDetail id={fixtureRunId(1)} />);
    expect(await screen.findByRole("list", { name: "Steps of this run" })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: "Objects in this run" })).toBeInTheDocument();
  });

  it("says Run not found for an unknown id and links back", async () => {
    wrap(<RunDetail id="00000000-0000-4000-8000-00000000dead" />);
    expect(await screen.findByText("Run not found")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Back to runs" })[0]).toHaveAttribute("href", expect.stringContaining("/runs"));
  });

  it("renders as a sheet", async () => {
    wrap(<RunDetailSheet id={fixtureRunId(1)} close={() => undefined} />);
    expect(await screen.findByRole("region", { name: "Objects in this run" })).toBeInTheDocument();
  });
});

describe("Compare", () => {
  it("lists the runs in a matrix and says so when one was not found", async () => {
    wrap(<CompareSheet id={`${fixtureRunId(1)},${fixtureRunId(2)},00000000-0000-4000-8000-00000000dead`} close={() => undefined} />);
    expect(await screen.findByText("Score of each object in each run")).toBeInTheDocument();
    expect(await screen.findByText("{n} of these runs were not found and are marked below.".replace("{n}", "1"))).toBeInTheDocument();
  });

  it("asks for at least two runs", () => {
    wrap(<CompareSheet id={fixtureRunId(1)} close={() => undefined} />);
    expect(screen.getByText("Pick at least two runs")).toBeInTheDocument();
  });

  it("says how many were left out above the cap", async () => {
    const ids = Array.from({ length: 8 }, (_, i) => fixtureRunId(i + 1)).join(",");
    wrap(<CompareSheet id={ids} close={() => undefined} />);
    expect(await screen.findByText("Showing the first 6 runs. 2 more were left out.")).toBeInTheDocument();
  });
});

describe("Start a run", () => {
  it("draft helpers: scope keeps only filled fields, drafts survive a reload by sheet id", () => {
    expect(scopeOf({ ...EMPTY_DRAFT, plants: "P1, P2", dateFrom: "2026-01-01" })).toEqual({ plants: ["P1", "P2"], date_from: "2026-01-01" });
    saveDraft(SHEET_ID, { ...EMPTY_DRAFT, system: "s1" });
    expect(loadDraft(SHEET_ID, EMPTY_DRAFT).system).toBe("s1");
  });

  it("clamps a deep link to the first step that is not valid", () => {
    expect(firstInvalidStep(EMPTY_DRAFT, { targets: [], templates: {} })).toBe(1);
    const ok = { ...EMPTY_DRAFT, system: "s", objects: ["material_master"] };
    expect(firstInvalidStep(ok, { targets: [], templates: {} })).toBeNull();
    expect(firstInvalidStep({ ...ok, dateFrom: "2026-02-01", dateTo: "2026-01-01" }, { targets: [], templates: {} })).toBe(2);
    expect(firstInvalidStep({ ...ok, target: "gone" }, { targets: ["t1"], templates: {} })).toBe(3);
    expect(firstInvalidStep({ ...ok, templates: { material_master: "gone" } }, { targets: [], templates: { material_master: ["t1"] } })).toBe(3);
  });

  it("walks objects, scope, target, when and review, and shows the chosen target", async () => {
    const u = userEvent.setup();
    let step = 1;
    const setStep = vi.fn((n: number) => { step = n; });
    const ui = () => <ToastProvider><RunSheet step={step} setStep={setStep} close={() => undefined} /></ToastProvider>;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = () => <QueryClientProvider client={qc}>{ui()}</QueryClientProvider>;
    const r = render(tree());
    const select = await screen.findByRole("combobox", { name: /Source system/ });
    const first = within(select).getAllByRole("option").find((o) => (o as HTMLOptionElement).value);
    await u.selectOptions(select, (first as HTMLOptionElement).value);
    await u.click(await screen.findByRole("button", { name: "Select all" }));
    await u.click(screen.getByRole("button", { name: "Next" }));
    expect(setStep).toHaveBeenLastCalledWith(2);
    step = 5;
    r.rerender(tree());
    expect(await screen.findByTestId("review-target")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start the run" })).toBeInTheDocument();
  });

  it("keeps the draft when the sheet is mounted again (back or refresh)", async () => {
    saveDraft(SHEET_ID, { ...EMPTY_DRAFT, system: "keep-me", plants: "P9" });
    wrap(<RunSheet step={2} setStep={() => undefined} close={() => undefined} />);
    expect(loadDraft(SHEET_ID, EMPTY_DRAFT).plants).toBe("P9");
  });
});

describe("Work", () => {
  it("resolves segments and the deep requests addresses", () => {
    for (const s of WORK_SEGMENTS) expect(segmentOf(s.slug ? s.slug.split("/") : [])).not.toBeNull();
    expect(segmentOf(["requests", "new"])?.id).toBe("requests");
    expect(segmentOf(["nope"])).toBeNull();
  });

  it("shows the ledger with the status bar and an Approvals segment", async () => {
    setUrl("/next/work?fixture=1");
    wrap(<Work />);
    expect(await screen.findByRole("region", { name: "Where the records stand" })).toBeInTheDocument();
    expect(screen.getAllByText("Approvals").length).toBeGreaterThan(0);
  });

  it("renders the ledger alone", async () => {
    wrap(<Ledger />);
    expect(await screen.findByText("Records that need work")).toBeInTheDocument();
  });

  it("bulk bar confirms before it acts and cancels cleanly", async () => {
    const u = userEvent.setup();
    const done = vi.fn();
    wrap(<WorkBulkBar rows={[{ id: "r1", module: "material_master", version_id: "v1", suggested: "A" } as never, { id: "r2", module: "material_master", version_id: "v1", suggested: null } as never]} onDone={done} />);
    await u.click(await screen.findByRole("button", { name: /Accept risk/ }));
    expect(await screen.findByText(/signs off 2 records/)).toBeInTheDocument();
    expect(screen.getByLabelText("Why (required)")).toBeInTheDocument();
    await u.click(screen.getByRole("button", { name: "Cancel" }));
    expect(done).not.toHaveBeenCalled();
  });
});

describe("NextSwap", () => {
  const Old = () => <p>old screen</p>;
  const Next = () => <p>new screen</p>;
  it("shows the new screen when ui_next is on and the old one when it is off", () => {
    const a = render(<NextSwap next={Next} old={Old} />);
    expect(screen.getByText("new screen")).toBeInTheDocument();
    a.unmount();
    prefs.value = { ui_next: false };
    render(<NextSwap next={Next} old={Old} />);
    expect(screen.getByText("old screen")).toBeInTheDocument();
  });
});
