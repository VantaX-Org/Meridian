import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));
import { screen } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import { resetWorkFixture } from "@/lib/api/v2/fixtures";
import * as analytics from "@/lib/api/v2/analytics";
import * as runs from "@/lib/api/v2/runs";
import * as links from "@/lib/api/v2/links";
import * as mining from "@/lib/api/v2/mining";
import * as issuesApi from "@/lib/api/v2/issues";
import { Atlas } from "../screens/Atlas";
import { Config } from "../screens/Config";
import { FlightDeck } from "../screens/FlightDeck";
import { Insights } from "../screens/Insights";
import { Issues } from "../screens/Issues";
import { Links } from "../screens/Links";
import { Material } from "../screens/Material";
import { Mining } from "../screens/Mining";
import { ReportsCanvas } from "../screens/Reports";
import { ScoreLens } from "../screens/ScoreLens";
import { StatusScreen } from "../screens/Status";
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

const FOLDED: [string, () => JSX.Element, RegExp, string[]][] = [
  ["Config", () => <Config />, /Nothing in SAP is changed/, ["How the system is used", "Changes since the last run"]],
  ["ScoreLens", () => <ScoreLens />, /only reads/, ["Run by run", "Where the score moved", "Config-aware view"]],
  ["Insights", () => <Insights />, /only reads/, ["Money already lost", "Trend over time"]],
  ["FlightDeck", () => <FlightDeck />, /Nothing is changed until you approve/, []],
  ["Links", () => <Links />, /Nothing is linked or unlinked/, ["Link types SAP defines"]],
  ["Material", () => <Material />, /Nothing in SAP is changed/, []],
  ["Issues", () => <Issues />, /Nothing in SAP is changed/, ["Where the issues stand"]],
  ["Mining", () => <Mining />, /until you promote a candidate/, ["Patterns", "Findings by object", "Fields that depend on each other"]],
  ["Atlas", () => <Atlas />, /only reads the latest score/, []],
  ["Reports", () => <ReportsCanvas />, /check the recipients first/, ["Schedules"]],
  ["Status", () => <StatusScreen />, /only reads/, ["Last 30 days"]],
];

describe.each(FOLDED)("%s", (_name, ui, consequence, folds) => {
  it("states the consequence in the guide and keeps secondary detail folded", async () => {
    renderWithQuery(ui());
    await screen.findByTestId("guide", undefined, { timeout: 8000 });
    expect(screen.getAllByText(consequence).length).toBeGreaterThan(0);
    for (const title of folds) {
      const f = (await screen.findAllByTestId("disclose", undefined, { timeout: 8000 })).find((d) => d.textContent?.includes(title)) as HTMLDetailsElement | undefined;
      expect(f, title).toBeTruthy();
      expect(f!.open).toBe(false);
    }
  });
});

describe("error states", () => {
  it("Links says the links could not be read and offers a retry", async () => {
    vi.spyOn(links, "getLinks").mockRejectedValue({ response: { status: 500 } });
    renderWithQuery(<Links />);
    expect(await screen.findByRole("button", { name: /retry|try again/i }, { timeout: 8000 })).toBeTruthy();
  });
  it("Issues offers a retry on a failure", async () => {
    vi.spyOn(issuesApi, "getIssues").mockRejectedValue({ response: { status: 500 } });
    renderWithQuery(<Issues />);
    expect(await screen.findByRole("button", { name: /retry|try again/i }, { timeout: 8000 })).toBeTruthy();
  });
  it("Mining offers a retry on a failure", async () => {
    vi.spyOn(mining, "getMiningOverview").mockRejectedValue({ response: { status: 500 } });
    renderWithQuery(<Mining />);
    expect(await screen.findByRole("button", { name: /retry|try again/i }, { timeout: 8000 })).toBeTruthy();
  });
});
