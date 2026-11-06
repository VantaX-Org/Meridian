import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithQuery } from "@/__tests__/render";
import type { Timeline, TimelineRun } from "@/lib/api/v2/runs";
import { fixtureResponse } from "@/lib/api/v2/fixtures";
import type { Landscape } from "@/lib/api/v2/types";
import { ObjectTrend } from "../ObjectTrend";
import { CodeWithText, InactiveChip, OldRunBand, PrimaryAction } from "../RunParts";
import { worstMovers, HomeHeadlines } from "../screens/HomeStrips";
import { ObjectsCanvas } from "../screens/Objects";
import { OverviewTab } from "../screens/object/OverviewTab";
import { setUrl } from "./nav-store";

vi.mock("next/navigation", async () => (await import("./nav-store")).navigationMock);
vi.mock("@/context/auth-context", () => ({ useAuth: () => ({ user: null, logout: () => undefined }) }));

beforeEach(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
  setUrl("/?fixture=1");
});
afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const runs = () => fixtureResponse<Timeline>("/runs/timeline", {}).runs;
const MOD = "material_master";

describe("ObjectTrend", () => {
  it("draws an inline ribbon and a header ribbon that name the object, the runs and the scores", () => {
    const { container } = renderWithQuery(
      <>
        <ObjectTrend size="inline" runs={runs()} module={MOD} system="ECC production" object="Material master" testId="i" />
        <ObjectTrend size="header" runs={runs()} module={MOD} system="ECC production" object="Material master" testId="h" />
      </>,
    );
    const svgs = container.querySelectorAll("svg.m2-ot");
    expect(svgs).toHaveLength(2);
    expect(svgs[0].getAttribute("width")).toBe("120");
    expect(svgs[1].getAttribute("width")).toBe("320");
    expect(svgs[0].getAttribute("aria-label")).toMatch(/Material master: 8 runs, measured/);
  });

  it("says so when an object has one run, at every size, and draws no chart", () => {
    const one = [runs()[7]];
    const { container } = renderWithQuery(
      <>
        <ObjectTrend size="inline" runs={one} module={MOD} system="ECC production" object="Material master" />
        <ObjectTrend size="card" runs={one} module={MOD} system="ECC production" object="Material master" />
      </>,
    );
    expect(container.querySelector("svg.m2-ot")).toBeNull();
    expect(screen.getByText("1 run")).toBeInTheDocument();
    expect(screen.getByText(/has one scored run so far, ECC production run \d+, measured 71\.8\. The trend chart starts at the second run\./)).toBeInTheDocument();
  });

  it("says so when no run scored the object", () => {
    renderWithQuery(<ObjectTrend size="card" runs={[]} module={MOD} system="ECC production" object="Material master" />);
    expect(screen.getByText(/has no scored run yet/)).toBeInTheDocument();
  });
});

describe("run parts", () => {
  it("OldRunBand names the shown run, says actions are off and offers the current run", () => {
    renderWithQuery(<OldRunBand shown={{ run_number: 3, run_at: "2026-10-02T05:00:00Z", status: "complete" }} system="ECC production" latest={{ id: "x", run_number: 5 }} />);
    const band = screen.getByTestId("old-run-band");
    expect(band).toHaveTextContent("ECC production run 3");
    expect(band).toHaveTextContent("Open the current run to act");
    expect(within(band).getByRole("button", { name: "Open the current run (ECC production run 5)" })).toBeInTheDocument();
  });

  it("PrimaryAction shows the action and its reason; InactiveChip explains itself; CodeWithText shows both", () => {
    renderWithQuery(
      <>
        <PrimaryAction action={<a href="/x">Do it</a>} why="Because." />
        <InactiveChip />
        <CodeWithText code="MM003" text="Base unit present" />
      </>,
    );
    expect(screen.getByTestId("primary-action")).toHaveTextContent("Do it");
    expect(screen.getByTestId("primary-action")).toHaveTextContent("Because.");
    expect(screen.getByText("Inactive")).toHaveAttribute("title", expect.stringContaining("switched off"));
    expect(screen.getByText(/Base unit present/)).toBeInTheDocument();
    expect(screen.getByText(/MM003/)).toBeInTheDocument();
  });
});

describe("worstMovers", () => {
  const sys = { id: "s", name: "ECC production" } as never;
  const r = (id: string, n: number, score: number): TimelineRun => ({ id, run_number: n, run_at: `2026-10-0${n}T00:00:00Z`, objects: { [MOD]: { score, raw_score: score } } }) as never;

  it("keeps only objects that fell between their two newest scored runs, worst first", () => {
    const out = worstMovers([sys], [[r("a", 1, 80), r("b", 2, 75)]], (m) => m);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ module: MOD, from: 80, to: 75, delta: -5 });
    expect(worstMovers([sys], [[r("a", 1, 70), r("b", 2, 75)]], (m) => m)).toEqual([]);
  });

  it("skips a system with no timeline yet and an object with one run", () => {
    expect(worstMovers([sys], [undefined], (m) => m)).toEqual([]);
    expect(worstMovers([sys], [[r("a", 1, 80)]], (m) => m)).toEqual([]);
  });
});

describe("Home headlines, Objects board and Overview tab (fixture)", () => {
  const landscape = () => fixtureResponse<Landscape>("/landscape", {});

  it("Home shows a strip per system with the three columns, and no run picker", async () => {
    renderWithQuery(<HomeHeadlines L={landscape()} />);
    expect((await screen.findAllByTestId("home-strip")).length).toBeGreaterThan(0);
    expect(screen.getByTestId("home-movers")).toBeInTheDocument();
    expect(screen.getByTestId("home-fixqueue")).toBeInTheDocument();
    expect(screen.getByTestId("home-verified")).toHaveTextContent(/Unverified/);
    expect(screen.queryByRole("button", { name: /Run 1/ })).toBeNull();
  });

  it("Home never renders an empty link for a cross-system finding, which has no rule name", async () => {
    renderWithQuery(<HomeHeadlines L={landscape()} />);
    const across = await within(screen.getByTestId("home-verified")).findByRole("link", { name: /more than one connected system/ });
    expect(across.getAttribute("href")).toMatch(/\/golden.*#across-systems$/);
    for (const a of within(screen.getByTestId("home-verified")).getAllByRole("link")) expect(a.textContent?.trim()).not.toBe("");
  });

  it("the Objects board lists a section per system with a row per object, each linking to its object", async () => {
    setUrl("/objects?fixture=1");
    renderWithQuery(<ObjectsCanvas />);
    expect((await screen.findAllByTestId("objects-system")).length).toBeGreaterThan(0);
    const rows = screen.getAllByTestId("objects-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(within(rows[0]).getAllByRole("link")[0].getAttribute("href")).toMatch(/\/o\//);
  });

  it("the Objects board prints each score once, from the ruler", async () => {
    setUrl("/objects?fixture=1");
    renderWithQuery(<ObjectsCanvas />);
    await screen.findAllByTestId("objects-system");
    for (const row of screen.getAllByTestId("objects-row")) {
      const score = within(row).getByTestId("ruler-score").textContent ?? "";
      expect(row.querySelector(".m2-ob-score b")).toBeNull();
      expect(score).not.toBe("");
    }
  });

  it("the Overview tab shows the score-over-runs chart with a sentence on how to read it", async () => {
    setUrl("/o/ecc-production/material-master?fixture=1");
    renderWithQuery(<OverviewTab system="ecc-production" module="material-master" />);
    const sec = await screen.findByTestId("overview-trend");
    expect(within(sec).getByText(/Each point is one finished run of this object/)).toBeInTheDocument();
    expect(within(sec).getByRole("link", { name: "Open the Trend tab" })).toHaveAttribute("href", expect.stringContaining("/trend"));
  });
});
