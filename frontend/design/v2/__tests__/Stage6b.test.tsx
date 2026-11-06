import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as analytics from "@/lib/api/v2/analytics";
import * as runs from "@/lib/api/v2/runs";
import { Value } from "../screens/Value";
import { stubLayout } from "./layout-stub";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);

let undo: () => void = () => undefined;
beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  resetWorkFixture();
  undo = stubLayout();
  setUrl("/");
});
afterEach(() => {
  undo();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const obj = (amount: number | null) => ({ score: 90, raw_score: 90, capped: false, value_at_risk: amount === null ? null : { amount, currency: "ZAR" } });
const run = (id: string, amount: number | null) => ({ id, run_at: null, label: null, system_id: null, baseline: false, kind: "manual", objects: { material_master: obj(amount) }, records_checked: null, duration_s: null });

describe("Value", () => {
  it("shows the ribbon of an object with priced runs", async () => {
    vi.spyOn(runs, "getTimeline").mockResolvedValue({ system_id: null, limit: 8, runs: [run("a", 10), run("b", 30)] });
    renderWithQuery(<Value />);
    const panel = await screen.findByTestId("val-ribbon", undefined, { timeout: 8000 });
    expect(await screen.findByText(/Material/i, undefined, { timeout: 8000 })).toBeTruthy();
    expect(panel.querySelector("svg.m2-spark")).toBeTruthy();
  });
  it("shows a dash with the reason when no run priced an object", async () => {
    vi.spyOn(runs, "getTimeline").mockResolvedValue({ system_id: null, limit: 8, runs: [run("a", null)] });
    renderWithQuery(<Value />);
    expect(await screen.findByText(/No run has priced the failing records/, undefined, { timeout: 8000 })).toBeTruthy();
  });
  it("keeps secondary detail folded and offers one next step", async () => {
    renderWithQuery(<Value />);
    await screen.findByTestId("val-ribbon", undefined, { timeout: 8000 });
    const folds = screen.getAllByTestId("disclose") as HTMLDetailsElement[];
    expect(folds.length).toBeGreaterThanOrEqual(3);
    expect(folds.every((f) => !f.open)).toBe(true);
    expect(screen.getByText(/Nothing is changed/)).toBeTruthy();
  });
  it("says the role cannot read it on 403 and offers retry on a failure", async () => {
    vi.spyOn(analytics, "getValue").mockRejectedValue({ response: { status: 403 } });
    const a = renderWithQuery(<Value />);
    expect(await screen.findByText(/Your role cannot read the value delivered/, undefined, { timeout: 8000 })).toBeTruthy();
    a.unmount();
    vi.spyOn(analytics, "getValue").mockRejectedValue({ response: { status: 500 } });
    renderWithQuery(<Value />);
    expect(await screen.findByText(/could not be read/, undefined, { timeout: 8000 })).toBeTruthy();
  });
});
