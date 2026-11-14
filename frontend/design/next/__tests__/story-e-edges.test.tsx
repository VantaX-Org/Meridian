import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithQuery } from "@/__tests__/render";
import { setUrl } from "@/design/v2/__tests__/nav-store";
import { stubLayout } from "@/design/v2/__tests__/layout-stub";
import { ToastProvider } from "../kit";
import { Runs } from "../runs/Runs";
import { RunDetail } from "../runs/RunDetail";
import { RunSheet } from "../runs/RunSheet";
import { SheetHost } from "../shell/SheetHost";

vi.mock("next/navigation", async () => (await import("@/design/v2/__tests__/nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
vi.mock("@/hooks/use-preferences", () => ({ usePreferences: () => ({ prefs: { ui_next: true }, setPref: () => undefined, loading: false }) }));

type Answer = (path: string) => unknown;
const net = { answer: (() => { throw new Error("no net"); }) as Answer };
vi.mock("@/lib/api/v2/client", async (orig) => {
  const real = await orig<typeof import("@/lib/api/v2/client")>();
  return {
    ...real,
    v2Get: (path: string, ...rest: unknown[]) => (window.sessionStorage.getItem("mn_v2_fixture") === "1"
      ? (real.v2Get as (...a: unknown[]) => Promise<unknown>)(path, ...rest)
      : Promise.resolve().then(() => net.answer(path))),
  };
});

const head = (over: Record<string, unknown> = {}) => ({
  id: "r1", run_at: "2026-01-02T00:00:00Z", label: null, run_number: 7, status: "complete", parent_version_id: null,
  dqs_summary: { material_master: { composite_score: 81, total_checks: 10 } }, metadata: { system_id: "s1", modules: ["material_master"] },
  system_name: "Primary system", ...over,
});
const forbidden = () => Object.assign(new Error("no"), { response: { status: 403 } });
const wrap = (ui: React.ReactElement) => renderWithQuery(<ToastProvider><SheetHost>{ui}</SheetHost></ToastProvider>);

const fx = (u: string) => { window.history.pushState({}, "", u); setUrl(u); };
let undo: () => void = () => undefined;
beforeEach(() => { undo = stubLayout(); fx("/next/runs"); window.sessionStorage.clear(); net.answer = () => { throw new Error("no net"); }; });
afterEach(() => undo());

describe("Runs edge states", () => {
  it("empty: says there is no run yet and offers Start a run", async () => {
    net.answer = (p) => { if (p === "/versions") return { versions: [], total: 0 }; throw new Error("x"); };
    wrap(<Runs />);
    expect(await screen.findByText("No run yet")).toBeInTheDocument();
  });

  it("loading: shows the table skeleton before data", () => {
    net.answer = () => new Promise(() => undefined);
    wrap(<Runs />);
    expect(screen.queryByText("No run yet")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Runs" })).toBeInTheDocument();
  });

  it("permission denied (403): says you cannot see runs", async () => {
    net.answer = (p) => { if (p === "/versions") throw forbidden(); throw new Error("x"); };
    wrap(<Runs />);
    expect(await screen.findByText("You cannot see runs")).toBeInTheDocument();
  });

  it("failed load: shows an error with a retry", async () => {
    net.answer = () => { throw new Error("boom"); };
    wrap(<Runs />);
    expect(await screen.findByRole("button", { name: /Try again|Retry/ })).toBeInTheDocument();
  });

  it("very large counts: the total is shown grouped", async () => {
    net.answer = (p) => { if (p === "/versions") return { versions: [head()], total: 1234567 }; throw new Error("x"); };
    wrap(<Runs />);
    expect((await screen.findAllByText(/1[,\s\u00a0\u202f]234[,\s\u00a0\u202f]567/)).length).toBeGreaterThan(0);
  });

  it("long names: the run link is truncated with the full name as a tooltip", async () => {
    const long = "A".repeat(140);
    net.answer = (p) => { if (p === "/versions") return { versions: [head({ system_name: long })], total: 1 }; throw new Error("x"); };
    wrap(<Runs />);
    const link = await screen.findByRole("link", { name: new RegExp(long) });
    expect(link).toHaveAttribute("title", expect.stringContaining(long));
    expect(link.className).toContain("nx-rn-trunc");
  });

  it("partial data: a run with no score shows a not-scored word, not a number", async () => {
    net.answer = (p) => { if (p === "/versions") return { versions: [head({ dqs_summary: {} })], total: 1 }; throw new Error("x"); };
    wrap(<Runs />);
    expect((await screen.findAllByText(/Not scored|No score/)).length).toBeGreaterThan(0);
  });

  it("role without analyse: Start a run is disabled with its reason", async () => {
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    fx("/next/runs?fixture=1&role=viewer");
    wrap(<Runs />);
    const b = await screen.findByRole("button", { name: "Start a run" });
    expect(b).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Your role cannot start a run.")).toBeInTheDocument();
  });
});

describe("RunDetail edge states", () => {
  it("failed run: shows an error state with a retry", async () => {
    net.answer = (p) => { if (p.startsWith("/versions/")) return head({ status: "failed", dqs_summary: {} }); throw new Error("x"); };
    wrap(<RunDetail id="r1" />);
    expect(await screen.findByText("This run failed before it was fully scored.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Try again|Retry/ }).length).toBeGreaterThan(0);
  });

  it("run in progress: says scores appear as each object finishes", async () => {
    net.answer = (p) => { if (p.startsWith("/versions/")) return head({ status: "running", dqs_summary: {} }); throw new Error("x"); };
    wrap(<RunDetail id="r1" />);
    expect(await screen.findByText("This run is still in progress. Scores appear as each object finishes.")).toBeInTheDocument();
  });

  it("permission denied (403): says you cannot see this run", async () => {
    net.answer = () => { throw forbidden(); };
    wrap(<RunDetail id="r1" />);
    expect(await screen.findByText("You cannot see this run")).toBeInTheDocument();
  });

  it("long run name: heading keeps the full name in a tooltip", async () => {
    const long = "B".repeat(150);
    net.answer = (p) => { if (p.startsWith("/versions/")) return head({ system_name: long }); throw new Error("x"); };
    wrap(<RunDetail id="r1" />);
    const h = await screen.findByRole("heading", { level: 2 });
    expect(h.getAttribute("title")).toContain(long);
  });
});

describe("Start a run edge states", () => {
  it("permission denied: a role without analyse sees why, not the stepper", async () => {
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    fx("/next/runs?fixture=1&role=viewer");
    wrap(<RunSheet step={1} setStep={() => undefined} close={() => undefined} />);
    expect(await screen.findByText("Your role cannot start a run")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
  });

  it("deep link to step 5 with nothing chosen clamps back to the first invalid step", async () => {
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    fx("/next/runs?fixture=1");
    const setStep = vi.fn();
    wrap(<RunSheet step={5} setStep={setStep} close={() => undefined} />);
    await waitFor(() => expect(setStep).toHaveBeenCalledWith(1));
  });

  it("double submit: the confirm button starts one run only", async () => {
    const u = userEvent.setup();
    const calls: string[] = [];
    window.sessionStorage.setItem("mn_v2_fixture", "1");
    fx("/next/runs?fixture=1");
    const mod = await import("@/lib/api/v2/admin");
    const spy = vi.spyOn(mod, "startExtraction").mockImplementation(async () => { calls.push("x"); await new Promise((r) => setTimeout(r, 50)); return { job_id: "j", status: "queued" } as never; });
    const { saveDraft } = await import("../runs/draft");
    const { SHEET_ID, EMPTY_DRAFT } = await import("../runs/RunSheet");
    saveDraft(SHEET_ID, { ...EMPTY_DRAFT, system: "sys-fixture", objects: ["material_master"] } as never);
    wrap(<RunSheet step={5} setStep={() => undefined} close={() => undefined} />);
    const go = await screen.findByRole("button", { name: "Start the run" });
    await u.dblClick(go);
    await waitFor(() => expect(calls.length).toBe(1));
    await new Promise((r) => setTimeout(r, 120));
    expect(calls.length).toBe(1);
    spy.mockRestore();
  });
});
